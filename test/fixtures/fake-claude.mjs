#!/usr/bin/env node
// A fake `claude` CLI for tests: speaks the same stream-json control protocol as Claude Code in
// `-p --input-format stream-json --output-format stream-json` mode, with no model and no network.
// Used by test/unit/chats/*.test.ts (ClaudeSession, ChatManager) and test/e2e/chats.spec.ts (SB_CLAUDE_PATH).
// What a turn does is chosen by words in the user's message:
//   ask → AskUserQuestion via can_use_tool, waits for the answer · bash → Bash permission (with a rule suggestion)
//   locked → Bash permission with suppress_always_allow_rule · mode → Edit permission with a setMode suggestion
//   edit → an auto-allowed Edit with a structuredPatch result · slow → streams until interrupted
//   stream → 24 text deltas (FAKE_CLAUDE_DELAY apart) before the final answer
//   later → after the result, the CLI starts another turn on its own (like a task notification)
//   garbage → prints non-JSON lines first · crash → stderr + exit 3 · expired → error result with total cost 0
//   anything else → streams "Ciao dal motore".
// Like the real CLI (2.1.282, probed): results carry queued_turn_count; with CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1
// it emits system/session_state_changed running/idle (FAKE_CLAUDE_NO_STATE_EVENTS=1 turns that off, as in older CLIs);
// the initialize control_response carries pending_permission_requests on its envelope (FAKE_CLAUDE_INHERITED=1 puts
// one inherited Bash prompt there). It writes a transcript to $CLAUDE_CONFIG_DIR/projects/<cwd slug>/<session>.jsonl
// and logs to $FAKE_CLAUDE_LOG one JSON line per start ({argv}), per control request ({control}) and per user
// message ({user: session_id}). `--version` and `auth status` answer at once. Every turn emits a `rate_limit_event`;
// the get_usage control answers with plan windows (rate_limits.five_hour / seven_day).
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const argv = process.argv.slice(2);
if (argv[0] === '--version') { process.stdout.write('0.0.0-fake (Claude Code)\n'); process.exit(0); }
if (argv[0] === 'auth' && argv[1] === 'status') { process.stdout.write('{"loggedIn":true,"authMethod":"fake"}\n'); process.exit(0); }
const opt = f => {
  const eq = argv.find(a => a.startsWith(`${f}=`));
  if (eq) return eq.slice(f.length + 1);
  return argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined;
};
const resumeId = opt('--resume');
let sessionId = argv.includes('--fork-session') ? crypto.randomUUID() : resumeId ?? opt('--session-id') ?? crypto.randomUUID();
// no --permission-mode: the user's settings.json decides (FAKE_CLAUDE_SETTINGS_MODE stands for its defaultMode)
let permissionMode = opt('--permission-mode') ?? process.env.FAKE_CLAUDE_SETTINGS_MODE ?? 'default';
let model = opt('--model') ?? 'claude-fake-1';
const stateEvents = process.env.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS === '1' && process.env.FAKE_CLAUDE_NO_STATE_EVENTS !== '1';
const logLine = obj => { if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify({ pid: process.pid, ...obj })}\n`); };
logLine({ argv, cwd: process.cwd(), stateEventsEnv: process.env.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS ?? null });

const home = process.env.CLAUDE_CONFIG_DIR;
const slug = () => process.cwd().replace(/[^A-Za-z0-9]/g, '-');
const transcript = () => (home ? path.join(home, 'projects', slug(), `${sessionId}.jsonl`) : null);
function record(obj) {
  const f = transcript();
  if (!f) return;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.appendFileSync(f, `${JSON.stringify({ ...obj, sessionId, cwd: process.cwd(), timestamp: new Date().toISOString(), uuid: crypto.randomUUID(), isSidechain: false })}\n`);
}
// the real CLI restores the session's spend on resume
let cost = 0;
if (resumeId && home) {
  try {
    for (const l of fs.readFileSync(path.join(home, 'projects', slug(), `${resumeId}.jsonl`), 'utf8').split('\n')) {
      try { const m = JSON.parse(l); if (m.type === 'cost-state') cost = m.totalCostUSD; } catch { /* skip */ }
    }
  } catch { /* new */ }
}

// like a CLI busy in a long tool: the host going away (closed pipes) does not end the turn; only a kill does
process.stdout.on('error', () => {});
const out = obj => process.stdout.write(`${JSON.stringify(obj)}\n`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const state = s => { if (stateEvents) out({ type: 'system', subtype: 'session_state_changed', state: s, session_id: sessionId, uuid: crypto.randomUUID() }); };
const waiters = new Map(); // request_id → resolve(response)
let turn = null; // { aborted, waitingId }
let inited = false;
let n = 0;
const queue = [];
let busy = false;
let ended = false;

function assistant(content, id = `msg_${++n}`) {
  out({ type: 'assistant', message: { id, role: 'assistant', content }, parent_tool_use_id: null, session_id: sessionId, uuid: crypto.randomUUID() });
  record({ type: 'assistant', message: { id, role: 'assistant', content } });
}
function toolResult(toolUseId, content, isError = false, toolUseResult) {
  const message = { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content, ...(isError ? { is_error: true } : {}) }] };
  out({ type: 'user', message, parent_tool_use_id: null, session_id: sessionId, uuid: crypto.randomUUID(), ...(toolUseResult ? { tool_use_result: toolUseResult } : {}) });
  record({ type: 'user', message, ...(toolUseResult ? { toolUseResult } : {}) });
}
async function streamText(text, parts) {
  const id = `msg_${++n}`;
  out({ type: 'stream_event', event: { type: 'message_start', message: { id, role: 'assistant', content: [] } }, parent_tool_use_id: null, session_id: sessionId });
  out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, parent_tool_use_id: null, session_id: sessionId });
  let said = '';
  for (const p of parts) {
    if (turn?.aborted) break;
    said += p;
    out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: p } }, parent_tool_use_id: null, session_id: sessionId });
    await sleep(Number(process.env.FAKE_CLAUDE_DELAY ?? 5));
  }
  out({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 }, parent_tool_use_id: null, session_id: sessionId });
  if (turn?.aborted) return;
  assistant([{ type: 'text', text: said || text }], id);
}
function ask(toolName, input, toolUseId, extra = {}) {
  const request_id = `req_${++n}`;
  out({ type: 'control_request', request_id, request: { subtype: 'can_use_tool', tool_name: toolName, input, tool_use_id: toolUseId, ...extra } });
  turn.waitingId = request_id;
  return new Promise(resolve => waiters.set(request_id, resolve)).finally(() => { if (turn) turn.waitingId = null; });
}
function result(final, aborted, t0) {
  cost = Math.round((cost + 0.01) * 1e6) / 1e6;
  record({ type: 'cost-state', totalCostUSD: cost });
  out({ type: 'result', subtype: aborted ? 'error_during_execution' : 'success', is_error: aborted, duration_ms: Date.now() - t0, num_turns: 1, total_cost_usd: cost, result: aborted ? '' : final, errors: [], queued_turn_count: queue.length, session_id: sessionId, uuid: crypto.randomUUID() });
}

async function permissionTurn(tool, input, id, extra, okText) {
  assistant([{ type: 'tool_use', id, name: tool, input }]);
  const r = await ask(tool, input, id, extra);
  if (r?.behavior === 'allow') {
    for (const u of r.updatedPermissions ?? []) if (u.type === 'setMode') { permissionMode = u.mode; out({ type: 'system', subtype: 'status', status: null, permissionMode, session_id: sessionId }); }
    toolResult(id, `${okText} ${JSON.stringify(r)}`);
    return 'Test verdi.';
  }
  if (r) { toolResult(id, `Permission denied: ${r.message}`, true); return 'Ok, non lo eseguo.'; }
  toolResult(id, '[Request interrupted by user for tool use]', true);
  return null;
}

async function runTurn(text) {
  turn = { aborted: false, waitingId: null };
  const t0 = Date.now();
  state('running');
  if (!inited) {
    inited = true;
    out({ type: 'system', subtype: 'init', session_id: sessionId, model, permissionMode, cwd: process.cwd(), tools: ['Bash', 'Edit', 'AskUserQuestion'], mcp_servers: [{ name: 'broken', status: 'failed' }], claude_code_version: '0.0.0-fake', effort: opt('--effort') ?? null });
  }
  record({ type: 'user', message: { role: 'user', content: text } });
  // like the real CLI on a claude.ai login: plan windows as utilization 0-1, resets in unix seconds
  out({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour', utilization: 0.25, resetsAt: Math.floor(Date.now() / 1000) + 3600 }, session_id: sessionId, uuid: crypto.randomUUID() });
  if (/crash/.test(text)) { process.stderr.write('fatal: fake crash for tests\n'); process.exit(3); }
  if (/expired/.test(text)) {
    // like an expired login: an error result whose running total reads 0
    out({ type: 'result', subtype: 'success', is_error: true, duration_ms: 1, num_turns: 0, total_cost_usd: 0, result: 'Invalid API key · Please run /login', errors: [], queued_turn_count: queue.length, session_id: sessionId, uuid: crypto.randomUUID() });
    turn = null;
    return;
  }
  if (/garbage/.test(text)) { process.stdout.write('this is not json\n{"broken": \n[1,2]\n"str"\n'); }
  let final = 'Ciao dal motore';
  if (/ask/.test(text) && !turn.aborted) {
    const input = { questions: [{ question: 'Che colore?', header: 'Colore', options: [{ label: 'Blu', description: 'il mare' }, { label: 'Rosso' }], multiSelect: false }] };
    assistant([{ type: 'tool_use', id: 'toolu_ask', name: 'AskUserQuestion', input }]);
    const r = await ask('AskUserQuestion', input, 'toolu_ask');
    if (r?.behavior === 'allow') { toolResult('toolu_ask', `Risposte: ${JSON.stringify(r.updatedInput?.answers ?? {})}`); final = `Hai scelto ${Object.values(r.updatedInput?.answers ?? {}).join(', ')}`; }
    else if (r) { toolResult('toolu_ask', `Nessuna risposta: ${r.message}`, true); final = 'Va bene, niente domanda.'; }
    else toolResult('toolu_ask', '[Request interrupted by user for tool use]', true);
  }
  const rule = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test' }], behavior: 'allow', destination: 'localSettings' }];
  if (/bash/.test(text) && !turn.aborted) {
    final = await permissionTurn('Bash', { command: 'npm test', description: 'Run the tests' }, 'toolu_bash', { permission_suggestions: rule, decision_reason: '\u001b[1mcomando non in allow list\u001b[0m' }, '3 passed') ?? final;
  }
  if (/locked/.test(text) && !turn.aborted) {
    final = await permissionTurn('Bash', { command: 'git push' }, 'toolu_locked', { permission_suggestions: rule, suppress_always_allow_rule: true }, 'pushed') ?? final;
  }
  if (/mode/.test(text) && !turn.aborted) {
    final = await permissionTurn('Edit', { file_path: path.join(process.cwd(), 'm.txt'), old_string: 'a', new_string: 'b' }, 'toolu_mode', { permission_suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }] }, 'edited') ?? final;
  }
  if (/edit/.test(text) && !turn.aborted) {
    const file = path.join(process.cwd(), 'a.txt');
    assistant([{ type: 'tool_use', id: 'toolu_edit', name: 'Edit', input: { file_path: file, old_string: 'a\nb\nc', new_string: 'a\nB\nc\nd' } }]);
    toolResult('toolu_edit', 'The file a.txt has been updated.', false, { filePath: file, structuredPatch: [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 4, lines: [' a', '-b', '+B', ' c', '+d'] }] });
  }
  if (/stream/.test(text) && !turn.aborted) {
    // a longer answer streamed word by word (FAKE_CLAUDE_DELAY between deltas), then the turn goes on
    await streamText('', Array.from({ length: 24 }, (_, i) => `parola${i} `));
  }
  if (/slow/.test(text)) {
    // a child of the CLI (a Bash tool, an MCP server): outside our parent's job, like claude.exe's own children;
    // it ends by itself after 40 s and with a normal exit of this process, never later
    const gc = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 40000)'], { detached: true, stdio: 'ignore', windowsHide: true });
    gc.unref();
    process.on('exit', () => { try { gc.kill(); } catch { /* gone */ } });
    logLine({ grandchild: gc.pid });
    await streamText('', Array.from({ length: 200 }, () => 'tick '));
  }
  else if (!turn.aborted) await streamText(final, [final.slice(0, 4), final.slice(4)]);
  const aborted = turn.aborted;
  if (aborted) out({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] }, parent_tool_use_id: null, session_id: sessionId });
  result(final, aborted, t0);
  turn = null;
  if (/later/.test(text)) {
    // the CLI picks up a task notification by itself: no user message, a whole new turn
    setTimeout(async () => {
      turn = { aborted: false, waitingId: null };
      busy = true;
      state('running');
      await streamText('Notifica elaborata', ['Notifica ', 'elaborata']);
      await sleep(150);
      result('Notifica elaborata', false, Date.now());
      turn = null;
      busy = false;
      state('idle');
      if (queue.length) void pump();
    }, Number(process.env.FAKE_CLAUDE_LATER_MS ?? 150));
  }
}

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) await runTurn(queue.shift());
  busy = false;
  state('idle');
  if (ended) process.exit(0);
}

const inherited = { type: 'control_request', request_id: 'req_inherited', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' }, tool_use_id: 'toolu_inherited' } };
function control(id, req) {
  logLine({ control: req.subtype, request: req });
  const ok = (response, envelope = {}) => out({ type: 'control_response', response: { subtype: 'success', request_id: id, ...(response ? { response } : {}), ...envelope } });
  switch (req.subtype) {
    case 'initialize': {
      const pending = process.env.FAKE_CLAUDE_INHERITED === '1' ? [inherited] : [];
      if (pending.length) waiters.set('req_inherited', r => { out({ type: 'assistant', message: { id: `msg_${++n}`, role: 'assistant', content: [{ type: 'text', text: `inherited: ${r?.behavior}` }] }, parent_tool_use_id: null, session_id: sessionId }); });
      // like Claude Code 2.1.282: the pending lists ride on the envelope, beside `response`
      return ok({ commands: [], agents: [], models: [], account: {}, output_style: 'default', available_output_styles: [], claude_code_version: '0.0.0-fake' }, { pending_permission_requests: pending, pending_user_dialog_requests: [] });
    }
    case 'interrupt':
      if (turn) {
        turn.aborted = true;
        if (turn.waitingId) { const w = waiters.get(turn.waitingId); out({ type: 'control_cancel_request', request_id: turn.waitingId }); waiters.delete(turn.waitingId); w?.(null); }
      }
      return ok({ still_queued: [] });
    case 'set_model': model = req.model ?? 'claude-fake-1'; return ok();
    case 'set_permission_mode': permissionMode = req.mode; out({ type: 'system', subtype: 'status', status: null, permissionMode, session_id: sessionId }); return ok({ mode: req.mode });
    case 'apply_flag_settings': return ok();
    case 'rename_session': record({ type: 'custom-title', customTitle: req.title }); return ok();
    case 'get_context_usage': return ok({ categories: [], totalTokens: 1234, maxTokens: 200000, rawMaxTokens: 200000, percentage: 0.617 });
    case 'get_usage': return ok({ session: { total_cost_usd: cost }, rate_limits: { five_hour: { utilization: 25, resets_at: new Date(Date.now() + 3600e3).toISOString() }, seven_day: { utilization: 40, resets_at: new Date(Date.now() + 5 * 864e5).toISOString() } } });
    default: return out({ type: 'control_response', response: { subtype: 'error', request_id: id, error: `Unsupported control request subtype: ${req.subtype}` } });
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', line => {
  if (!line.trim()) return;
  let m;
  try { m = JSON.parse(line); } catch { process.stderr.write(`bad input line: ${line}\n`); return; }
  if (m.type === 'control_request') return control(m.request_id, m.request ?? {});
  if (m.type === 'control_response') {
    const w = waiters.get(m.response?.request_id);
    if (w) { waiters.delete(m.response.request_id); w(m.response.response); }
    return;
  }
  if (m.type === 'user') {
    logLine({ user: m.session_id });
    const c = m.message?.content;
    queue.push(Array.isArray(c) ? c.map(b => b.text ?? '').join('\n') : String(c ?? ''));
    void pump();
  }
});
rl.on('close', () => { ended = true; if (!busy) { logLine({ exit: 'stdin closed' }); process.exit(0); } });
