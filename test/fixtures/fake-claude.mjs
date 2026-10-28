#!/usr/bin/env node
// A fake `claude` CLI for tests: speaks the same stream-json control protocol as Claude Code in
// `-p --input-format stream-json --output-format stream-json` mode, with no model and no network.
// Used by test/unit/chats/*.test.ts (ClaudeSession, ChatManager) and test/e2e/chats.spec.ts (SB_CLAUDE_PATH).
// What a turn does is chosen by words in the user's message:
//   ask → AskUserQuestion via can_use_tool, waits for the answer (asksn: a yes/no one, Sì / No) · bash → Bash permission (with a rule suggestion)
//   locked → Bash permission with suppress_always_allow_rule · mode → Edit permission with a setMode suggestion
//   readgate → a Read permission: "Letto a.txt" when allowed, "Lettura negata: <message>" when refused
//     (readgate=<path> reads that path, relative to the cwd, instead of a.txt)
//   planexit → an ExitPlanMode permission (the plan to approve): "Piano approvato" or "Piano rifiutato: <message>"
//   edit → an auto-allowed Edit with a structuredPatch result · slow → streams until interrupted
//   think → streams a reasoning block ("Penso di usare la libreria vecchia. Passo 1. …", FAKE_CLAUDE_SLOW_TICKS steps) until
//   interrupted, then the answer
//   (FAKE_CLAUDE_SLOW_TICKS deltas, default 200; FAKE_CLAUDE_STAMP=1 ends each word with @<Date.now()> so
//   scripts/bench-perf.mjs can measure CLI → screen)
//   stream → 24 text deltas (FAKE_CLAUDE_DELAY apart) before the final answer
//   later → after the result, the CLI starts another turn on its own (like a task notification)
//   background → a task (task_bg) starts in the turn, ends after it (FAKE_CLAUDE_TASK_MS); + paused / resumed (task_started
//     again) / revived (task_updated to running again) · sendmessage → an ended agent resumed by SendMessage, only its
//     result says so (+ structured: also tool_use_result; + stopped: success false) · waitqa → the answer ends with
//     "Aspetto la QA sui controlli A, B e C…"
//   meter → assistant messages with API usage (one repeated per block, one from a subagent), the session's running cost
//     goes up by 0.05 mid-turn (get_usage shows it), then a 1.5 s pause before the answer; meter die → exits after the pause
//   garbage → prints non-JSON lines first · crash → stderr + exit 3 · expired → error result with total cost 0
//   big → get_context_usage reports 250000 of 1M from then on (default 1234; the window is the app's --settings
//     env CLAUDE_CODE_AUTO_COMPACT_WINDOW when it passes one)
//   a cold continuation ([second-brain · continuazione] …) → "Continuo dal passaggio: <the user's part>"
//   the app's hand-off request (<<<PASSAGGIO) → a hand-off between the markers (FAKE_CLAUDE_HANDOFF=off: plain text)
//   "Riprendi un lavoro…" (a chat continuing another) → "Ripreso dal passaggio…"; both ignore the words above
//   mcpcall <server> <tool> <json> (anywhere on a line, JSON to its end) → a real MCP tools/call to that --mcp-config server,
//     asked for with can_use_tool unless --allowedTools has mcp__<server>__<tool>; the answer is "Fatto: <tool>" or "Errore: …"
//   skillgate <name> → a Skill permission for <name> (the answer's JSON, updatedInput included, is the tool's output)
//   pretool <Tool>… [@agent] → asks the PreToolUse hook callback the app registered at initialize, once per tool
//   orphan → starts a child with its own child that outlive this process (FAKE_CLAUDE_LOG gets {orphan: pid} twice)
// FAKE_CLAUDE_INIT_DELAY=<ms> delays the initialize reply (a slow start-up); every FAKE_CLAUDE_LOG line has at: Date.now().
//   anything else → streams "Ciao dal motore".
// Like the real CLI (2.1.282, probed): results carry queued_turn_count; with CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1
// it emits system/session_state_changed running/idle (FAKE_CLAUDE_NO_STATE_EVENTS=1 turns that off, as in older CLIs);
// the initialize control_response carries pending_permission_requests on its envelope (FAKE_CLAUDE_INHERITED=1 puts
// one inherited Bash prompt there). It writes a transcript to $CLAUDE_CONFIG_DIR/projects/<cwd slug>/<session>.jsonl
// (none with --no-session-persistence)
// and logs to $FAKE_CLAUDE_LOG one JSON line per start ({argv}), per control request ({control}) and per user
// message ({user: session_id, blocks: content block types, images as image:<source type>:<media type>:<base64 length>}). `--version` and `auth status` answer at once. Every turn emits a `rate_limit_event`;
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
// --allowedTools (comma list) and the --mcp-config servers (inline JSON or a file), for "mcpcall"
const allowedTools = new Set((opt('--allowedTools') ?? '').split(',').map(x => x.trim()).filter(Boolean));
const mcpServers = (() => {
  const v = opt('--mcp-config');
  if (!v) return {};
  try { return JSON.parse(v.trim().startsWith('{') ? v : fs.readFileSync(v, 'utf8')).mcpServers ?? {}; } catch { return {}; }
})();
// a minimal MCP client over HTTP (what the real CLI does with an http server of --mcp-config)
async function mcpCall(name, tool, args) {
  const srv = mcpServers[name];
  if (!srv?.url) return { ok: false, text: `no MCP server ${name}` };
  const post = async (body, sid) => {
    const res = await fetch(srv.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(srv.headers ?? {}), ...(sid ? { 'mcp-session-id': sid } : {}) }, body: JSON.stringify(body) });
    return { sid: res.headers.get('mcp-session-id'), json: await res.json() };
  };
  try {
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'fake-claude', version: '0' } } });
    const r = (await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args } }, init.sid)).json;
    const text = r.error ? r.error.message : (r.result?.content ?? []).map(c => c.text ?? '').join('\n');
    return { ok: !r.error && !r.result?.isError, text };
  } catch (e) { return { ok: false, text: String(e?.message ?? e) }; }
}
const resumeId = opt('--resume');
let sessionId = argv.includes('--fork-session') ? crypto.randomUUID() : resumeId ?? opt('--session-id') ?? crypto.randomUUID();
// no --permission-mode: the user's settings.json decides (FAKE_CLAUDE_SETTINGS_MODE stands for its defaultMode)
let permissionMode = opt('--permission-mode') ?? process.env.FAKE_CLAUDE_SETTINGS_MODE ?? 'default';
let model = opt('--model') ?? 'claude-fake-1';
// the compaction window the app passes per process (inline --settings env, ADR 0031): get_context_usage reports it
const compactWindow = (() => { try { return Number(JSON.parse(opt('--settings') ?? '{}')?.env?.CLAUDE_CODE_AUTO_COMPACT_WINDOW) || null; } catch { return null; } })();
const stateEvents = process.env.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS === '1' && process.env.FAKE_CLAUDE_NO_STATE_EVENTS !== '1';
const logLine = obj => { if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify({ pid: process.pid, at: Date.now(), ...obj })}\n`); };
logLine({ argv, cwd: process.cwd(), stateEventsEnv: process.env.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS ?? null });

const home = process.env.CLAUDE_CONFIG_DIR;
const slug = () => process.cwd().replace(/[^A-Za-z0-9]/g, '-');
// like the real CLI: --no-session-persistence writes no transcript
const transcript = () => (home && !argv.includes('--no-session-persistence') ? path.join(home, 'projects', slug(), `${sessionId}.jsonl`) : null);
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
let preToolHook = null; // the callback id the app registered for PreToolUse at initialize (hooks), like the Agent SDK
let n = 0;
const queue = [];
let busy = false;
let ended = false;
let spent = 0; // the running turn's cost so far, as the real CLI's tracker has it after each API response
let ctxTokens = 1234; // get_context_usage; "big" in a message → 250000 (over the default 200k threshold)
const FAKE_HANDOFF = 'Ecco il passaggio.\n<<<PASSAGGIO\n## Stato\nFatto il fix finto, test verdi.\n## File e worktree\n- a.txt\n## Decisioni prese\n- niente refactor\n## Provato e scartato\n- la cache: inutile\n## Prossimo passo\nAprire la PR.\nPASSAGGIO>>>';

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
  let words = 0;
  for (let p of parts) {
    if (turn?.aborted) break;
    // bench text: a stamp per word and a paragraph every 40 words, like a real answer
    if (process.env.FAKE_CLAUDE_STAMP === '1') p = p.replace(/ $/, `@${Date.now()}${words++ % 40 === 39 ? '\n\n' : ' '}`);
    said += p;
    out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: p } }, parent_tool_use_id: null, session_id: sessionId });
    await sleep(Number(process.env.FAKE_CLAUDE_DELAY ?? 5));
  }
  out({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 }, parent_tool_use_id: null, session_id: sessionId });
  if (turn?.aborted) return;
  assistant([{ type: 'text', text: said || text }], id);
}
/** A reasoning block streamed piece by piece (thinking_delta), cut by an interrupt like the real CLI; then the whole
 *  block in its assistant message (no signature here: the app never sends it back). */
async function streamThinking(parts) {
  const id = `msg_${++n}`;
  out({ type: 'stream_event', event: { type: 'message_start', message: { id, role: 'assistant', content: [] } }, parent_tool_use_id: null, session_id: sessionId });
  out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }, parent_tool_use_id: null, session_id: sessionId });
  let said = '';
  for (const p of parts) {
    if (turn?.aborted) break;
    said += p;
    out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: p } }, parent_tool_use_id: null, session_id: sessionId });
    await sleep(Number(process.env.FAKE_CLAUDE_DELAY ?? 5));
  }
  out({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 }, parent_tool_use_id: null, session_id: sessionId });
  if (turn?.aborted) return;
  assistant([{ type: 'thinking', thinking: said }], id);
}
function ask(toolName, input, toolUseId, extra = {}) {
  const request_id = `req_${++n}`;
  out({ type: 'control_request', request_id, request: { subtype: 'can_use_tool', tool_name: toolName, input, tool_use_id: toolUseId, ...extra } });
  turn.waitingId = request_id;
  return new Promise(resolve => waiters.set(request_id, resolve)).finally(() => { if (turn) turn.waitingId = null; });
}
function result(final, aborted, t0) {
  cost = Math.round((cost + 0.01) * 1e6) / 1e6;
  spent = 0;
  record({ type: 'cost-state', totalCostUSD: cost });
  out({ type: 'result', subtype: aborted ? 'error_during_execution' : 'success', is_error: aborted, duration_ms: Date.now() - t0, num_turns: 1, total_cost_usd: cost, usage: { input_tokens: 10, cache_creation_input_tokens: 200, cache_read_input_tokens: 3000, output_tokens: 40 }, result: aborted ? '' : final, errors: [], queued_turn_count: queue.length, session_id: sessionId, uuid: crypto.randomUUID() });
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
  // the role text the app puts before an Orchestrator's first message and its "[app estimate · …]" line are not the user's: their words trigger nothing
  text = text.replace(/\[Role supplied by the app: [^\]\n]*\][\s\S]*?End role\]\n*/, '').replace(/\n*\[app estimate · [^\]\n]*\][^\n]*$/, '');
  // the fixed rules of a delegation contract (shared/delegation.ts delegationPrompt) are the app's: their words ("ask") trigger nothing
  text = text.replace(/^(When the output is ready|An ambiguity in this contract|If the user writes to you here)[^\n]*$/gm, '');
  // the MCP calls are taken out first: their JSON's words ("tasks", "summary") trigger nothing
  const mcpCalls = [...text.matchAll(/mcpcall (\S+) (\S+) (\{.*\})\s*$/gm)];
  text = text.replace(/mcpcall (\S+) (\S+) (\{.*\})\s*$/gm, '');
  // like the real CLI on a claude.ai login: plan windows as utilization 0-1, resets in unix seconds
  out({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour', utilization: 0.25, resetsAt: Math.floor(Date.now() / 1000) + 3600 }, session_id: sessionId, uuid: crypto.randomUUID() });
  if (/\bbig\b/.test(text)) ctxTokens = 250000;
  // the app's hand-off request and the first message of a chat that continues another: answered as such, whatever words
  // they contain (FAKE_CLAUDE_HANDOFF=off: an answer without the markers, so the app falls back to its own note)
  const handoffAsk = text.includes('<<<PASSAGGIO'), resumed = text.startsWith('Riprendi un lavoro') || text.includes('\n\nRiprendi un lavoro');
  // a cold continuation's first message (ADR 0031): the note, then the user's own message after the separator
  const cold = text.startsWith('[second-brain · continuazione]');
  if (handoffAsk || resumed || cold) {
    const reply = cold ? `Continuo dal passaggio: ${text.slice(text.indexOf('\n--- messaggio ---\n') + 19)}`
      : !handoffAsk ? 'Ripreso dal passaggio di consegne: verifico lo stato reale.'
      : process.env.FAKE_CLAUDE_HANDOFF === 'off' ? 'Non so scrivere passaggi.' : FAKE_HANDOFF;
    await streamText(reply, [reply.slice(0, 10), reply.slice(10)]);
    result(reply, false, t0);
    turn = null;
    return;
  }
  // the built-in /compact (as the real CLI: a compact_boundary with the sizes, then a success result)
  if (text.startsWith('/compact')) {
    const pre = ctxTokens;
    ctxTokens = 30000;
    out({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'manual', pre_tokens: pre, post_tokens: ctxTokens }, session_id: sessionId, uuid: crypto.randomUUID() });
    result('', false, t0);
    turn = null;
    return;
  }
  if (/crash/.test(text)) { process.stderr.write('fatal: fake crash for tests\n'); process.exit(3); }
  if (/expired/.test(text)) {
    // like an expired login: an error result whose running total reads 0
    out({ type: 'result', subtype: 'success', is_error: true, duration_ms: 1, num_turns: 0, total_cost_usd: 0, result: 'Invalid API key · Please run /login', errors: [], queued_turn_count: queue.length, session_id: sessionId, uuid: crypto.randomUUID() });
    turn = null;
    return;
  }
  if (/garbage/.test(text)) { process.stdout.write('this is not json\n{"broken": \n[1,2]\n"str"\n'); }
  let final = 'Ciao dal motore';
  if (/waitqa/.test(text)) final = 'Fatto il fix.\nAspetto la QA sui controlli A, B e C…';
  if (/\b(?:ask|asksn)\b/.test(text) && !turn.aborted) {
    const input = /\basksn\b/.test(text)
      ? { questions: [{ question: 'Lo pubblico?', header: 'Pubblica', options: [{ label: 'Sì (consigliato)' }, { label: 'No' }], multiSelect: false }] }
      : { questions: [{ question: 'Che colore?', header: 'Colore', options: [{ label: 'Blu', description: 'il mare' }, { label: 'Rosso' }], multiSelect: false }] };
    assistant([{ type: 'tool_use', id: 'toolu_ask', name: 'AskUserQuestion', input }]);
    const r = await ask('AskUserQuestion', input, 'toolu_ask');
    if (r?.behavior === 'allow') { toolResult('toolu_ask', `Risposte: ${JSON.stringify(r.updatedInput?.answers ?? {})}`); final = `Hai scelto ${Object.values(r.updatedInput?.answers ?? {}).join(', ')}`; }
    else if (r) { toolResult('toolu_ask', `Nessuna risposta: ${r.message}`, true); final = 'Va bene, niente domanda.'; }
    else toolResult('toolu_ask', '[Request interrupted by user for tool use]', true);
  }
  const rule = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test' }], behavior: 'allow', destination: 'localSettings' }];
  // pretool <Tool> [<Tool>…] [@agent] → asks the app's PreToolUse hook callback for each tool (like the real CLI before a
  // tool runs; @agent = from a sub-agent, agent_id set) and answers "Hook: <tool>=ok|deny:<reason>; …"
  const pre = text.match(/pretool ((?:\S+ ?)+)/);
  if (pre && preToolHook && !turn.aborted) {
    const words = (pre[1] ?? '').trim().split(/\s+/), agent = words.includes('@agent');
    const said = [];
    for (const tool of words.filter(w => w !== '@agent')) {
      const request_id = `req_${++n}`, tool_use_id = `toolu_pre_${n}`;
      out({ type: 'control_request', request_id, request: { subtype: 'hook_callback', callback_id: preToolHook, tool_use_id, input: { session_id: sessionId, transcript_path: '', cwd: process.cwd(), permission_mode: permissionMode, hook_event_name: 'PreToolUse', tool_name: tool, tool_input: {}, tool_use_id, ...(agent ? { agent_id: 'a_sub' } : {}) } } });
      const r = await new Promise(resolve => waiters.set(request_id, resolve));
      const h = r?.hookSpecificOutput;
      said.push(`${tool}=${h?.permissionDecision === 'deny' ? `deny:${h.permissionDecisionReason}` : 'ok'}`);
    }
    final = `Hook: ${said.join('; ')}`;
  }
  // skillgate <name> → a Skill permission for that name: "Skill caricata <response JSON>" when allowed (the app may patch its input)
  const sk = text.match(/skillgate (\S+)/);
  if (sk && !turn.aborted) final = await permissionTurn('Skill', { skill: sk[1], args: 'x' }, 'toolu_skill', {}, 'Skill caricata') ?? final;
  if (/bash/.test(text) && !turn.aborted) {
    final = await permissionTurn('Bash', { command: 'npm test', description: 'Run the tests' }, 'toolu_bash', { permission_suggestions: rule, decision_reason: '\u001b[1mcomando non in allow list\u001b[0m' }, '3 passed') ?? final;
  }
  // elicit / elicitform → an MCP server asks the user through the CLI (#148): "Elicitation <response JSON>"
  if (/elicit/.test(text) && !turn.aborted) {
    const request_id = `req_${++n}`, form = /elicitform/.test(text);
    out({ type: 'control_request', request_id, request: { subtype: 'elicitation', mcp_server_name: 'wiz', message: 'Confermi la pubblicazione?', mode: 'form',
      requested_schema: /elicitformmulti/.test(text) ? { type: 'object', properties: { count: { type: 'integer', minimum: 1, maximum: 3 }, name: { type: 'string' } }, required: ['count', 'name'] }
        : form ? { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } : { type: 'object', properties: {} } } });
    turn.waitingId = request_id;
    const r = await new Promise(resolve => waiters.set(request_id, resolve)).finally(() => { if (turn) turn.waitingId = null; });
    final = `Elicitation ${JSON.stringify(r ?? null)}`;
  }
  if (/readgate/.test(text) && !turn.aborted) {
    const file = path.resolve(process.cwd(), /readgate=(\S+)/.exec(text)?.[1] ?? 'a.txt');
    assistant([{ type: 'tool_use', id: 'toolu_read', name: 'Read', input: { file_path: file } }]);
    const r = await ask('Read', { file_path: file }, 'toolu_read');
    if (r?.behavior === 'allow') { toolResult('toolu_read', 'contenuto di a.txt'); final = 'Letto a.txt'; }
    else if (r) { toolResult('toolu_read', `Permission denied: ${r.message}`, true); final = `Lettura negata: ${r.message}`; }
  }
  if (/planexit/.test(text) && !turn.aborted) {
    const input = { plan: '1. leggi, 2. rispondi' };
    assistant([{ type: 'tool_use', id: 'toolu_plan', name: 'ExitPlanMode', input }]);
    const r = await ask('ExitPlanMode', input, 'toolu_plan');
    if (r?.behavior === 'allow') { toolResult('toolu_plan', 'ok'); final = 'Piano approvato'; }
    else if (r) { toolResult('toolu_plan', r.message, true); final = `Piano rifiutato: ${r.message}`; }
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
  if (/toolwait/.test(text) && !turn.aborted) {
    // a long tool call (a build, a test suite): the chat shows a running tool for FAKE_CLAUDE_TOOL_MS (bench --working)
    assistant([{ type: 'tool_use', id: 'toolu_wait', name: 'Bash', input: { command: 'npm test', description: 'Run the tests' } }]);
    await sleep(Number(process.env.FAKE_CLAUDE_TOOL_MS ?? 120000));
    toolResult('toolu_wait', '3 passed');
  }
  if (/stream/.test(text) && !turn.aborted) {
    // a longer answer streamed word by word (FAKE_CLAUDE_DELAY between deltas), then the turn goes on
    await streamText('', Array.from({ length: 24 }, (_, i) => `parola${i} `));
  }
  if (/meter/.test(text) && !turn.aborted) {
    const usage = (o) => ({ input_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 1000, output_tokens: o });
    const msg = (id, content, u, parent = null) => out({ type: 'assistant', message: { id, model, role: 'assistant', content, usage: u }, parent_tool_use_id: parent, session_id: sessionId, uuid: crypto.randomUUID() });
    msg('msg_m1', [{ type: 'thinking', thinking: 'penso' }], usage(10));
    msg('msg_m1', [{ type: 'text', text: 'misuro' }], usage(20)); // the same response, one more block: counted once
    msg('msg_sub', [{ type: 'text', text: 'dal subagente' }], usage(20), 'toolu_task');
    spent = 0.05;
    await sleep(1500);
    if (/die/.test(text)) { process.stderr.write('fatal: fake crash mid-turn\n'); process.exit(3); }
  }
  if (/orphan/.test(text)) {
    // a background command that outlives this CLI (a dev app, a hook, an MCP server the real CLI leaves running):
    // a child that starts its own child, both 5 min long, never ended by this process; the app must reap both
    const keep = 'setTimeout(() => {}, 300000)';
    const script = `const g = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(keep)}], { stdio: 'ignore', windowsHide: true });`
      + ` if (process.env.FAKE_CLAUDE_LOG) require('node:fs').appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ pid: process.pid, orphan: g.pid }) + '\\n'); ${keep};`;
    const o = spawn(process.execPath, ['-e', script], { detached: process.platform === 'win32', stdio: 'ignore', windowsHide: true });
    o.unref();
    logLine({ orphan: o.pid });
  }
  if (/think/.test(text) && !turn.aborted) {
    // reasoning streamed until interrupted (FAKE_CLAUDE_SLOW_TICKS sentences): "Correggi il pensiero" selects one of them
    const ticks = Number(process.env.FAKE_CLAUDE_SLOW_TICKS ?? 200);
    await streamThinking(['Penso di usare la libreria vecchia. ', ...Array.from({ length: ticks }, (_, i) => `Passo ${i + 1}. `)]);
  }
  // "mcpcall <server> <tool> <json to the end of the line>": a real MCP tools/call over HTTP to a server of --mcp-config,
  // asked for with can_use_tool unless --allowedTools pre-approves mcp__<server>__<tool> (like the real CLI)
  if (!/slow/.test(text)) for (const [, server, tool, args] of mcpCalls) {
    if (turn.aborted) break;
    const name = `mcp__${server}__${tool}`, id = `toolu_mcp_${++n}`;
    let input;
    try { input = JSON.parse(args); } catch { final = `Errore: JSON non valido per ${tool}`; continue; }
    assistant([{ type: 'tool_use', id, name, input }]);
    if (!allowedTools.has(name)) {
      const r = await ask(name, input, id);
      if (r?.behavior !== 'allow') { toolResult(id, r ? `Permission denied: ${r.message}` : '[Request interrupted by user for tool use]', true); final = `Negato: ${tool}`; continue; }
    }
    const r = await mcpCall(server, tool, input);
    logLine({ mcpcall: { server, tool, ok: r.ok, text: r.text } });
    toolResult(id, r.text, !r.ok);
    final = r.ok ? `Fatto: ${tool}` : `Errore: ${r.text}`;
  }
  if (/slow/.test(text)) {
    // a child of the CLI (a Bash tool, an MCP server): outside our parent's job, like claude.exe's own children;
    // it ends by itself after FAKE_CLAUDE_CHILD_MS (40 s) and with a normal exit of this process, never later
    const life = Number(process.env.FAKE_CLAUDE_CHILD_MS ?? 40000);
    const gc = spawn(process.execPath, ['-e', `setTimeout(() => {}, ${life})`], { detached: process.platform === 'win32', stdio: 'ignore', windowsHide: true });
    gc.unref();
    process.on('exit', () => { try { gc.kill(); } catch { /* gone */ } });
    logLine({ grandchild: gc.pid });
    await streamText('', Array.from({ length: Number(process.env.FAKE_CLAUDE_SLOW_TICKS ?? 200) }, () => 'tick '));
  }
  else if (!turn.aborted) await streamText(final, [final.slice(0, 4), final.slice(4)]);
  const aborted = turn.aborted;
  if (aborted) out({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] }, parent_tool_use_id: null, session_id: sessionId });
  // like run_in_background: a task starts in this turn and ends after the turn (FAKE_CLAUDE_TASK_MS), with a notification
  // "sendmessage": an agent that ended is resumed by SendMessage in this turn; only the tool's result says it runs again
  // (CLI 2.1.283's text and structured result), its notification ends it after the turn
  if (/sendmessage/.test(text) && !turn.aborted) {
    out({ type: 'system', subtype: 'task_started', task_id: 'a26420c62ff6f065f', tool_use_id: 'toolu_agent', description: 'QA', task_type: 'local_agent', session_id: sessionId });
    out({ type: 'system', subtype: 'task_notification', task_id: 'a26420c62ff6f065f', status: 'completed', output_file: '', summary: 'ok', session_id: sessionId });
    assistant([{ type: 'tool_use', id: 'toolu_send', name: 'SendMessage', input: { to: 'a26420c62ff6f065f', message: 'riprova' } }]);
    const stopped = /stopped/.test(text);
    const res = stopped ? { success: false, message: 'Agent a26420c62ff6f065f was stopped by the user and will not be resumed.' } : { success: true, message: 'Resuming agent a26420c', resumedAgentId: 'a26420c62ff6f065f' };
    toolResult('toolu_send', [{ type: 'text', text: JSON.stringify(res) }], false, /structured/.test(text) ? res : undefined);
    if (!stopped) setTimeout(() => out({ type: 'system', subtype: 'task_notification', task_id: 'a26420c62ff6f065f', status: 'completed', output_file: '', summary: 'ok', session_id: sessionId }), Number(process.env.FAKE_CLAUDE_TASK_MS ?? 400));
  }
  if (/background/.test(text)) out({ type: 'system', subtype: 'task_started', task_id: 'task_bg', tool_use_id: 'toolu_bg', description: 'npm test', task_type: 'local_bash', session_id: sessionId });
  // "subagent": an Agent tool launched with run_in_background (CLI 2.1.28x: the tool_use, its task_started, the result
  // that acknowledges the launch), ended after the turn by its task_notification (FAKE_CLAUDE_TASK_MS; "subagent fails"
  // ends it failed; "subagent twice" launches two)
  if (/subagent/.test(text) && !turn.aborted) {
    const launch = (id, description) => {
      assistant([{ type: 'tool_use', id: `toolu_${id}`, name: 'Agent', input: { description, prompt: `${description} e riferisci`, subagent_type: 'Explore', run_in_background: true } }]);
      out({ type: 'system', subtype: 'task_started', task_id: id, tool_use_id: `toolu_${id}`, description, task_type: 'local_agent', session_id: sessionId });
      toolResult(`toolu_${id}`, [{ type: 'text', text: `Async agent launched successfully.\nagentId: ${id}\noutput_file: ${id}.output` }]);
      setTimeout(() => out({ type: 'system', subtype: 'task_notification', task_id: id, status: /subagent fails/.test(text) ? 'failed' : 'completed', output_file: '', summary: 'ok', session_id: sessionId }), Number(process.env.FAKE_CLAUDE_TASK_MS ?? 400));
    };
    launch('task_sub', 'Esplora il repo');
    if (/subagent twice/.test(text)) launch('task_sub2', 'Controlla i test');
  }
  result(final, aborted, t0);
  turn = null;
  if (/background/.test(text)) {
    // "paused": the task pauses and resumes before it ends (a workflow), and an update without a status follows its end
    const upd = (patch, ms) => setTimeout(() => out({ type: 'system', subtype: 'task_updated', task_id: 'task_bg', patch, session_id: sessionId }), ms);
    if (/paused/.test(text)) { upd({ status: 'paused' }, 50); upd({ status: 'running' }, 150); upd({ description: 'npm test (done)' }, Number(process.env.FAKE_CLAUDE_TASK_MS ?? 400) + 100); }
    const ms = Number(process.env.FAKE_CLAUDE_TASK_MS ?? 400);
    const note = at => setTimeout(() => out({ type: 'system', subtype: 'task_notification', task_id: 'task_bg', status: 'completed', output_file: '', summary: 'ok', session_id: sessionId }), at);
    note(ms);
    // "resumed": SendMessage to the finished agent starts it again under the same task id (CLI 2.1.283), then it ends
    if (/resumed/.test(text)) { setTimeout(() => out({ type: 'system', subtype: 'task_started', task_id: 'task_bg', tool_use_id: 'toolu_send', description: 'npm test', task_type: 'local_agent', session_id: sessionId }), ms + 200); note(ms * 3); }
    // "revived": the resumed agent comes back as a task_updated to running, no task_started (the chats of 2026-10-16)
    if (/revived/.test(text)) { upd({ status: 'running' }, ms + 200); note(ms * 3); }
  }
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
      preToolHook = req.hooks?.PreToolUse?.[0]?.hookCallbackIds?.[0] ?? null;
      const pending = process.env.FAKE_CLAUDE_INHERITED === '1' ? [inherited] : [];
      if (pending.length) waiters.set('req_inherited', r => { out({ type: 'assistant', message: { id: `msg_${++n}`, role: 'assistant', content: [{ type: 'text', text: `inherited: ${r?.behavior}` }] }, parent_tool_use_id: null, session_id: sessionId }); });
      // like Claude Code 2.1.282: the pending lists ride on the envelope, beside `response`
      // like 2.1.282: the chat's "/" commands with description and argument hint; skills carry "(user)"/"(project)"
      const commands = [
        { name: 'spiega', description: 'Spiega un argomento a domande (user)', argumentHint: '<argomento>' },
        { name: 'compact', description: 'Compatta il contesto della chat', argumentHint: '' },
        { name: 'wiz:scan (MCP)', description: 'an MCP prompt: its name has a space, not typeable', argumentHint: '' },
      ];
      const reply = () => ok({ commands, agents: [], models: [], account: {}, output_style: 'default', available_output_styles: [], claude_code_version: '0.0.0-fake' }, { pending_permission_requests: pending, pending_user_dialog_requests: [] });
      // FAKE_CLAUDE_INIT_DELAY: a slow start-up (the real CLI answers after 10-25 s)
      if (process.env.FAKE_CLAUDE_INIT_DELAY) { setTimeout(reply, Number(process.env.FAKE_CLAUDE_INIT_DELAY)); return; }
      return reply();
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
    case 'get_context_usage': {
      const max = compactWindow ?? (ctxTokens > 200000 ? 1000000 : 200000);
      return ok({ categories: [], totalTokens: ctxTokens, maxTokens: max, rawMaxTokens: max, percentage: Math.round((ctxTokens / max) * 100000) / 1000 });
    }
    case 'get_usage': return ok({ session: { total_cost_usd: Math.round((cost + spent) * 1e6) / 1e6 }, rate_limits: { five_hour: { utilization: 25, resets_at: new Date(Date.now() + 3600e3).toISOString() }, seven_day: { utilization: 40, resets_at: new Date(Date.now() + 5 * 864e5).toISOString() } } });
    default: return out({ type: 'control_response', response: { subtype: 'error', request_id: id, error: `Unsupported control request subtype: ${req.subtype}` } });
  }
}

// FAKE_CLAUDE_HOLD_PIPES=<ms>: a leftover that inherited this CLI's stdout/stderr and outlives it (a background command
// started with inherited handles): the CLI exits, but the host's 'close' waits for the pipes
if (process.env.FAKE_CLAUDE_HOLD_PIPES) {
  const h = spawn(process.execPath, ['-e', `setTimeout(() => {}, ${Number(process.env.FAKE_CLAUDE_HOLD_PIPES)})`], { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true, detached: true });
  h.unref();
  logLine({ holder: h.pid });
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
    const c = m.message?.content;
    // the content block types and image media types, so tests see what a message carried (pasted screenshots)
    logLine({ user: m.session_id, blocks: Array.isArray(c) ? c.map(b => (b.type === 'image' ? `image:${b.source?.type}:${b.source?.media_type}:${(b.source?.data ?? '').length}` : b.type)) : ['string'] });
    queue.push(Array.isArray(c) ? c.map(b => b.text ?? '').join('\n') : String(c ?? ''));
    void pump();
  }
});
rl.on('close', () => { ended = true; if (!busy) { logLine({ exit: 'stdin closed' }); process.exit(0); } });
