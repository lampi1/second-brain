#!/usr/bin/env node
// A fake Cursor CLI in ACP mode (`agent [--model X] acp`) for tests: JSON-RPC 2.0, one JSON per line on stdio, with
// the shapes of Cursor CLI 2026.07.23's own ACP code (initialize result with loadSession + http MCP + cursor_login,
// session/new → {sessionId, modes, models}, session/request_permission with allow-once / allow-always / reject-once,
// cursor/ask_question {toolCallId, title, questions[{id, prompt, options[{id,label}], allowMultiple}]} → outcome
// answered/skipped/cancelled, cursor/create_plan → accepted/rejected/cancelled, session/cancel → stopReason cancelled).
// No model, no network, no Cursor credits: the app's tests and e2e use ONLY this (the real engine is refused).
// What a prompt does is chosen by words in it:
//   perm → a shell tool call that asks permission (allow-always offered) · locked → the same without allow-always
//   ask → cursor/ask_question (one single-choice and one multi-choice question) · plan → cursor/create_plan
//   edit → an edit tool call with a diff · todo → a plan update · slow → streams until cancelled
//   stream → thought + 24 text chunks, then a read tool call pending → in_progress → completed
//   extensions → cursor/update_todos and cursor/task sent as requests (as the real CLI does)
//   usage → the prompt result carries usage tokens · garbage → non-JSON lines · crash → stderr + exit 3
//   anything else → a thought, then "Ciao dal motore" streamed in chunks.
// Env: FAKE_CURSOR_LOG (one JSON line per start {argv}, per request {method, params}, per answer {answer}),
// FAKE_CURSOR_NO_AUTH=1 (not logged in: session/new fails -32000), FAKE_CURSOR_NO_LOAD=1 (no loadSession),
// FAKE_CURSOR_DELAY (ms between chunks).
import crypto from 'node:crypto';
import fs from 'node:fs';
import readline from 'node:readline';

const argv = process.argv.slice(2);
if (argv.includes('--version') || argv.includes('-v')) { process.stdout.write('2026.07.23-fake000\n'); process.exit(0); }
const log = obj => { if (process.env.FAKE_CURSOR_LOG) fs.appendFileSync(process.env.FAKE_CURSOR_LOG, `${JSON.stringify({ pid: process.pid, ...obj })}\n`); };
log({ argv, cwd: process.cwd(), configDir: process.env.CURSOR_CONFIG_DIR ?? null });
// like the real CLI (handleInitialModel → updateConfig): a --model is written into the config folder it runs with
if (process.env.CURSOR_CONFIG_DIR && argv.includes('--model')) {
  const f = `${process.env.CURSOR_CONFIG_DIR}/cli-config.json`;
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* none yet */ }
  fs.writeFileSync(f, JSON.stringify({ ...cfg, model: { modelId: argv[argv.indexOf('--model') + 1] }, hasChangedDefaultModel: true }));
}
if (argv.at(-1) !== 'acp') { process.stderr.write('fake: only `acp` is supported\n'); process.exit(2); }
const mi = argv.indexOf('--model');
let model = mi >= 0 ? argv[mi + 1] : 'auto';
let mode = 'agent';

process.stdout.on('error', () => {});
const out = obj => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...obj })}\n`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const delay = () => sleep(Number(process.env.FAKE_CURSOR_DELAY ?? 5));
const sessions = new Set();
const waiting = new Map(); // our request id → resolve(result)
let seq = 1000;
let turn = null; // { cancelled }

const update = (sessionId, u) => out({ method: 'session/update', params: { sessionId, update: u } });
const say = async (sessionId, kind, parts) => { for (const p of parts) { if (turn?.cancelled) return; update(sessionId, { sessionUpdate: kind, content: { type: 'text', text: p } }); await delay(); } };
function ask(method, params) {
  const id = ++seq;
  out({ id, method, params });
  return new Promise(resolve => waiting.set(id, resolve));
}
const modelsState = () => ({ currentModelId: model, availableModels: [{ modelId: 'auto', name: 'Auto' }, { modelId: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' }, { modelId: 'claude-sonnet-5.5', name: 'Sonnet 5.5' }] });
const modesState = () => ({ currentModeId: mode, availableModes: [{ id: 'agent', name: 'Agent' }, { id: 'plan', name: 'Plan' }, { id: 'ask', name: 'Ask' }] });
const opt = (optionId, name, kind) => ({ optionId, name, kind });

async function prompt(id, p) {
  const sid = p.sessionId;
  const text = (p.prompt ?? []).map(b => b.text ?? '').join('\n');
  turn = { cancelled: false };
  if (/crash/.test(text)) { process.stderr.write('fatal: fake cursor crash\n'); process.exit(3); }
  if (/garbage/.test(text)) process.stdout.write('not json at all\n{"jsonrpc":\n');
  let final = 'Ciao dal motore';
  if (/perm|locked/.test(text)) {
    const tc = { toolCallId: 'tc_shell', title: '`npm test`', kind: 'execute', status: 'pending', rawInput: { command: 'npm test' } };
    update(sid, { sessionUpdate: 'tool_call', ...tc });
    const options = [opt('allow-once', 'Allow once', 'allow_once'), ...(/locked/.test(text) ? [] : [opt('allow-always', 'Allow `npm test` always', 'allow_always')]), opt('reject-once', 'Reject', 'reject_once')];
    const r = await ask('session/request_permission', { sessionId: sid, toolCall: { toolCallId: tc.toolCallId, title: 'Run `npm test`', kind: 'execute', status: 'pending', content: [{ type: 'content', content: { type: 'text', text: 'Esegue i test' } }] }, options });
    log({ answer: r });
    const o = r?.outcome ?? {};
    if (o.outcome === 'selected' && o.optionId.startsWith('allow')) {
      update(sid, { sessionUpdate: 'tool_call_update', toolCallId: tc.toolCallId, status: 'in_progress' });
      update(sid, { sessionUpdate: 'tool_call_update', toolCallId: tc.toolCallId, status: 'completed', content: [{ type: 'content', content: { type: 'text', text: `3 passed (${o.optionId})` } }] });
      final = 'Test verdi.';
    } else {
      update(sid, { sessionUpdate: 'tool_call_update', toolCallId: tc.toolCallId, status: 'failed', content: [{ type: 'content', content: { type: 'text', text: `rejected: ${o.outcome}` } }] });
      final = o.outcome === 'cancelled' ? '' : 'Ok, non lo eseguo.';
    }
  }
  if (/ask/.test(text) && !turn.cancelled) {
    const r = await ask('cursor/ask_question', { toolCallId: 'tc_ask', title: 'Due domande', questions: [
      { id: 'q_color', prompt: 'Che colore?', options: [{ id: 'o_blue', label: 'Blu' }, { id: 'o_red', label: 'Rosso' }], allowMultiple: false },
      { id: 'q_files', prompt: 'Quali file?', options: [{ id: 'f_a', label: 'a.ts' }, { id: 'f_b', label: 'b.ts' }, { id: 'f_c', label: 'c.ts' }], allowMultiple: true },
    ] });
    log({ answer: r });
    const o = r?.outcome ?? {};
    final = o.outcome === 'answered' ? `Risposte: ${o.answers.map(a => `${a.questionId}=${a.selectedOptionIds.join(',')}`).join('; ')}` : `Domande: ${o.outcome}${o.reason ? ` (${o.reason})` : ''}`;
  }
  if (/plan/.test(text) && !turn.cancelled) {
    const r = await ask('cursor/create_plan', { toolCallId: 'tc_plan', name: 'Piano di prova', overview: 'Due passi', plan: '# Piano\n1. Leggi\n2. Scrivi', todos: [{ id: 't1', content: 'Leggi', status: 'pending' }, { id: 't2', content: 'Scrivi', status: 'pending' }] });
    log({ answer: r });
    final = `Piano: ${r?.outcome?.outcome}${r?.outcome?.reason ? ` (${r.outcome.reason})` : ''}`;
  }
  if (/edit/.test(text) && !turn.cancelled) {
    update(sid, { sessionUpdate: 'tool_call', toolCallId: 'tc_edit', title: 'Edit a.txt', kind: 'edit', status: 'in_progress', locations: [{ path: `${process.cwd()}/a.txt` }] });
    update(sid, { sessionUpdate: 'tool_call_update', toolCallId: 'tc_edit', status: 'completed', content: [{ type: 'diff', path: `${process.cwd()}/a.txt`, oldText: 'a\nb\nc', newText: 'a\nB\nc\nd' }] });
  }
  if (/todo/.test(text)) update(sid, { sessionUpdate: 'plan', entries: [{ content: 'Leggi', priority: 'high', status: 'completed' }, { content: 'Scrivi', priority: 'medium', status: 'in_progress' }] });
  if (/extensions/.test(text) && !turn.cancelled) {
    // like the real CLI: these "non-blocking" extensions travel as requests (extMethod) and wait for an answer
    const a = await ask('cursor/update_todos', { toolCallId: 'tc_todos', todos: [{ id: 't1', content: 'Leggi', status: 'completed' }, { id: 't2', content: 'Scrivi', status: 'in_progress' }], merge: false });
    log({ answer: { outcome: { method: 'cursor/update_todos', result: a } } });
    const b = await ask('cursor/task', { toolCallId: 'tc_task', description: 'Esplora il repo', prompt: 'trova i test', subagentType: 'explore' });
    log({ answer: { outcome: { method: 'cursor/task', result: b } } });
  }
  if (/stream/.test(text) && !turn.cancelled) {
    await say(sid, 'agent_thought_chunk', Array.from({ length: 8 }, (_, i) => `idea${i} `));
    await say(sid, 'agent_message_chunk', Array.from({ length: 24 }, (_, i) => `parola${i} `));
    update(sid, { sessionUpdate: 'tool_call', toolCallId: 'tc_after', title: 'Read b.txt', kind: 'read', status: 'pending' });
    await delay();
    update(sid, { sessionUpdate: 'tool_call_update', toolCallId: 'tc_after', status: 'in_progress' });
    await delay();
    update(sid, { sessionUpdate: 'tool_call_update', toolCallId: 'tc_after', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'letto' } }] });
  }
  if (/slow/.test(text)) await say(sid, 'agent_message_chunk', Array.from({ length: 300 }, () => 'tick '));
  else if (!turn.cancelled && final) {
    await say(sid, 'agent_thought_chunk', ['Penso ', 'un attimo']);
    await say(sid, 'agent_message_chunk', [final.slice(0, 4), final.slice(4)]);
  }
  const cancelled = turn.cancelled;
  turn = null;
  const usage = /usage/.test(text) ? { inputTokens: 1000, outputTokens: 500, cachedReadTokens: 2000, cachedWriteTokens: 0, totalTokens: 3500 } : undefined;
  out({ id, result: { stopReason: cancelled ? 'cancelled' : 'end_turn', ...(usage ? { usage } : {}) } });
}

function request(id, method, p) {
  log({ method, params: p });
  switch (method) {
    case 'initialize':
      return out({ id, result: { protocolVersion: 1, agentCapabilities: { loadSession: process.env.FAKE_CURSOR_NO_LOAD !== '1', mcpCapabilities: { http: true, sse: true }, promptCapabilities: { audio: false, embeddedContext: false, image: true }, sessionCapabilities: { list: {} } }, authMethods: [{ id: 'cursor_login', name: 'Cursor Login', description: "Authenticate using existing Cursor login credentials. Run 'agent login' first if not logged in." }] } });
    case 'authenticate': return out({ id, error: { code: -32602, message: 'fake: authenticate must never be called by second-brain' } });
    case 'session/new': {
      if (process.env.FAKE_CURSOR_NO_AUTH === '1') return out({ id, error: { code: -32000, message: "Authentication required. Please run 'agent login' first, then call authenticate() with methodId 'cursor_login'." } });
      const sessionId = crypto.randomUUID();
      sessions.add(sessionId);
      return out({ id, result: { sessionId, modes: modesState(), models: modelsState() } });
    }
    case 'session/load': {
      sessions.add(p.sessionId);
      // like the real agent: the past is replayed as updates before the answer
      update(p.sessionId, { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'vecchia domanda' } });
      update(p.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'vecchia risposta' } });
      return out({ id, result: { modes: modesState(), models: modelsState() } });
    }
    // the real one writes the user's global CLI config (cli-config.json): second-brain must never call it
    case 'session/set_model': return out({ id, error: { code: -32602, message: 'fake: session/set_model must never be called by second-brain' } });
    case 'session/set_mode': mode = p.modeId; update(p.sessionId, { sessionUpdate: 'current_mode_update', currentModeId: mode }); return out({ id, result: {} });
    case 'session/prompt':
      if (!sessions.has(p.sessionId)) return out({ id, error: { code: -32602, message: `unknown session ${p.sessionId}` } });
      return void prompt(id, p);
    default: return out({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', line => {
  if (!line.trim()) return;
  let m;
  try { m = JSON.parse(line); } catch { process.stderr.write(`bad line: ${line}\n`); return; }
  if (m.method && m.id !== undefined) return request(m.id, m.method, m.params ?? {});
  if (m.method === 'session/cancel') { log({ method: 'session/cancel', params: m.params }); if (turn) turn.cancelled = true; return; }
  if (m.method) return log({ method: m.method, params: m.params });
  if (m.id !== undefined && waiting.has(m.id)) { const w = waiting.get(m.id); waiting.delete(m.id); w(m.result ?? null); }
});
rl.on('close', () => { log({ exit: 'stdin closed' }); process.exit(0); });
