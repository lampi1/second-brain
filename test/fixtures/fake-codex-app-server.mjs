#!/usr/bin/env node
// A fake `codex [-c k=v …] app-server` for tests (ADR 0060): JSON-RPC over stdio, one JSON per line, WITHOUT the
// "jsonrpc" field (as the app-server docs say it goes on the wire), with the shapes of the protocol's generated
// TypeScript schema (codex-rs/app-server-protocol/schema/typescript/v2, read 16/10): initialize → {userAgent, codexHome,
// platformFamily, platformOs}; account/read; model/list {data}; skills/extraRoots/set; thread/start|resume → {thread,
// model, …}; turn/start → {turn} then turn/started, item/started|completed, deltas, thread/tokenUsage/updated,
// turn/completed {turn:{id, status, error}}; turn/steer {expectedTurnId} → {turnId}; turn/interrupt → the turn completes
// "interrupted"; server requests item/commandExecution/requestApproval, item/fileChange/requestApproval (→ {decision}),
// item/tool/requestUserInput (→ {answers}) and serverRequest/resolved. No model, no network, no OpenAI account: the
// app's tests and e2e use ONLY this (the real engine is refused under tests: chats/cli.ts engineAllowed).
// What a prompt does is chosen by words in it:
//   perm → a command that asks approval ("Comando eseguito" / "Comando rifiutato") · edit → a file change that asks
//   approval, with a diff (grant → the same with grantRoot = the cwd) · ask → requestUserInput (one question, two options) → "Hai scelto <answer>"
//   slow → streams "tick" until interrupted, or until a steer arrives ("Ricevuto: <steer text>")
//   mcp → an mcpToolCall item · plan → turn/plan/updated twice · fail → a failed turn · unauth → a failed turn with
//   codexErrorInfo "unauthorized" · crash → stderr + exit 3 · unknown → an unknown notification and item type (drift)
//   anything else → reasoning, then "Ciao da Codex" streamed in chunks.
// Env: FAKE_CODEX_LOG (one JSON line per start {argv, env key present}, per message from the app), FAKE_CODEX_NO_AUTH=1
// (account/read: no account, auth required, CODEX_API_KEY in the env or not; a turn then fails "unauthorized"; the
// app never logs in for the user, so account/login/start is unknown here),
// FAKE_CODEX_DELAY (ms between chunks), FAKE_CODEX_RESUME_FAIL=1, FAKE_CODEX_TURN_START_DELAY (ms before turn/start is
// answered and the turn starts: a Stop sent in that window has no turn id yet).
import crypto from 'node:crypto';
import fs from 'node:fs';
import readline from 'node:readline';

const argv = process.argv.slice(2);
if (argv.includes('--version')) { process.stdout.write('codex-cli 0.0.0-fake\n'); process.exit(0); }
const log = obj => { if (process.env.FAKE_CODEX_LOG) fs.appendFileSync(process.env.FAKE_CODEX_LOG, `${JSON.stringify({ pid: process.pid, ...obj })}\n`); };
log({ argv, cwd: process.cwd(), key: !!process.env.CODEX_API_KEY });
if (argv.at(-1) !== 'app-server') { process.stderr.write('fake: only `app-server` is supported\n'); process.exit(2); }

const DELAY = Number(process.env.FAKE_CODEX_DELAY ?? 5);
const out = m => process.stdout.write(`${JSON.stringify(m)}\n`);
const notify = (method, params) => out({ method, params });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let seq = 1000;
const waiting = new Map(); // our request id → resolve
const ask = (method, params) => new Promise(resolve => { const id = seq++; waiting.set(id, resolve); out({ id, method, params }); });
const uuid = () => crypto.randomUUID();

let threadId = null;
let model = 'gpt-fake-codex';
let turn = null; // { id, interrupted, steer: string|null }
let loggedIn = process.env.FAKE_CODEX_NO_AUTH !== '1';
const usage = { totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 };

function addUsage(input, output) {
  const last = { totalTokens: input + output, inputTokens: input, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: output, reasoningOutputTokens: 0 };
  for (const k of Object.keys(usage)) usage[k] += last[k];
  notify('thread/tokenUsage/updated', { threadId, turnId: turn?.id, tokenUsage: { total: { ...usage }, last, modelContextWindow: 272000 } });
}

async function stream(itemId, method, text) {
  for (const chunk of text.match(/.{1,6}/gs) ?? []) { notify(method, { threadId, turnId: turn.id, itemId, delta: chunk }); await sleep(DELAY); }
}

async function message(text) {
  const id = `msg_${uuid()}`;
  const item = { type: 'agentMessage', id, text: '' };
  notify('item/started', { item, threadId, turnId: turn.id });
  await stream(id, 'item/agentMessage/delta', text);
  notify('item/completed', { item: { ...item, text }, threadId, turnId: turn.id });
}

function complete(status, error = null) {
  const t = turn;
  turn = null;
  notify('turn/completed', { threadId, turn: { id: t.id, items: [], status, error } });
}

async function runTurn(text) {
  const t = turn;
  notify('turn/started', { threadId, turn: { id: t.id, items: [], status: 'inProgress', error: null } });
  if (!loggedIn) return complete('failed', { message: 'unexpected status 401 Unauthorized: no API key', codexErrorInfo: 'unauthorized', additionalDetails: null });
  if (/\bcrash\b/.test(text)) { process.stderr.write('fake codex: crash requested\n'); process.exit(3); }
  if (/\bunauth\b/.test(text)) return complete('failed', { message: 'unexpected status 401 Unauthorized', codexErrorInfo: 'unauthorized', additionalDetails: null });
  if (/\bfail\b/.test(text)) {
    notify('error', { error: { message: 'stream disconnected', codexErrorInfo: null, additionalDetails: null }, willRetry: true, threadId, turnId: t.id });
    return complete('failed', { message: 'Il modello finto ha fallito', codexErrorInfo: null, additionalDetails: null });
  }
  if (/\bunknown\b/.test(text)) {
    notify('thread/fakeFuture/updated', { threadId, x: 1 });
    notify('item/completed', { item: { type: 'fakeFutureItem', id: 'f1' }, threadId, turnId: t.id });
  }
  if (/\bslow\b/.test(text)) {
    const id = `msg_${uuid()}`;
    notify('item/started', { item: { type: 'agentMessage', id, text: '' }, threadId, turnId: t.id });
    while (!t.interrupted && !t.steer) { notify('item/agentMessage/delta', { threadId, turnId: t.id, itemId: id, delta: 'tick ' }); await sleep(40); }
    notify('item/completed', { item: { type: 'agentMessage', id, text: 'tick' }, threadId, turnId: t.id });
    if (t.interrupted) return complete('interrupted');
    await message(`Ricevuto: ${t.steer}`);
    addUsage(100, 10);
    return complete('completed');
  }
  if (/\belicitation\b/.test(text)) {
    const params = { threadId, turnId: t.id, serverName: 'second_brain_app', mode: 'form',
      message: 'Consenti a Second Brain di leggere le chat?',
      requestedSchema: { type: 'object', properties: {} },
      _meta: { codex_approval_kind: 'tool_approval', persist: ['session', 'always'], tool_description: 'Elenca le chat visibili.',
        tool_params: { since: '2h' }, tool_params_display: [{ name: 'since', value: '2h', display_name: 'Intervallo' }] },
      ...JSON.parse(process.env.FAKE_CODEX_ELICITATION ?? '{}') };
    notify('item/started', { threadId, turnId: t.id, item: { type: 'mcpToolCall', id: 'elicitation-tool', server: 'second_brain_app', tool: 'app_chats', arguments: { since: '2h' }, status: 'inProgress' } });
    const reply = ask('mcpServer/elicitation/request', params);
    const requestId = seq - 1;
    if (/\b(resolved|completed)\b/.test(text)) {
      await sleep(80);
      if (/\bresolved\b/.test(text)) {
        notify('serverRequest/resolved', { threadId, requestId });
        notify('serverRequest/resolved', { threadId, requestId });
      }
      waiting.delete(requestId);
      return complete('completed');
    }
    const r = await reply;
    log({ answer: r });
    notify('serverRequest/resolved', { threadId, requestId });
    if (t.interrupted || r.action === 'cancel') return;
    await message(r.error ? 'Elicitation non supportata dal client' : `MCP: ${r.action}`);
    return complete('completed');
  }
  if (/\bperm\b/.test(text)) {
    const item = { type: 'commandExecution', id: 'cmd1', command: 'npm test', cwd: process.cwd(), processId: null, status: 'inProgress', commandActions: [], aggregatedOutput: null, exitCode: null, durationMs: null };
    notify('item/started', { item, threadId, turnId: t.id });
    const r = await ask('item/commandExecution/requestApproval', { threadId, turnId: t.id, itemId: 'cmd1', reason: 'fuori dalla sandbox', command: 'npm test', cwd: process.cwd() });
    log({ answer: r });
    notify('serverRequest/resolved', { threadId, requestId: seq - 1 });
    if (r.decision === 'cancel') return; // the interrupt completes the turn
    const ok = r.decision === 'accept' || r.decision === 'acceptForSession';
    if (ok) notify('item/commandExecution/outputDelta', { threadId, turnId: t.id, itemId: 'cmd1', delta: 'tutti i test passano\n' });
    notify('item/completed', { item: { ...item, status: ok ? 'completed' : 'declined', aggregatedOutput: ok ? 'tutti i test passano\n' : null, exitCode: ok ? 0 : null, durationMs: 12 }, threadId, turnId: t.id });
    await message(ok ? 'Comando eseguito' : 'Comando rifiutato');
    addUsage(200, 20);
    return complete('completed');
  }
  if (/\b(edit|grant)\b/.test(text)) {
    const diff = '--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n-vecchio\n+nuovo\n+riga\n';
    const item = { type: 'fileChange', id: 'fc1', changes: [{ path: `${process.cwd()}/a.txt`, kind: { type: 'update', move_path: null }, diff }], status: 'inProgress' };
    notify('item/started', { item, threadId, turnId: t.id });
    const r = await ask('item/fileChange/requestApproval', { threadId, turnId: t.id, itemId: 'fc1', reason: null, grantRoot: /\bgrant\b/.test(text) ? process.cwd() : null });
    log({ answer: r });
    if (r.decision === 'cancel') return;
    const ok = r.decision === 'accept' || r.decision === 'acceptForSession';
    notify('item/completed', { item: { ...item, status: ok ? 'completed' : 'declined' }, threadId, turnId: t.id });
    await message(ok ? 'File modificato' : 'Modifica rifiutata');
    return complete('completed');
  }
  if (/\bask\b/.test(text)) {
    const r = await ask('item/tool/requestUserInput', { threadId, turnId: t.id, itemId: 'q1', questions: [{ id: 'colore', header: 'Colore', question: 'Che colore preferisci?', isOther: true, isSecret: false, options: [{ label: 'Rosso', description: 'caldo' }, { label: 'Blu', description: 'freddo' }] }] });
    log({ answer: r });
    if (t.interrupted) return;
    await message(`Hai scelto ${r.answers?.colore?.answers?.join(', ') || 'niente'}`);
    return complete('completed');
  }
  if (/\bmcp\b/.test(text)) {
    const item = { type: 'mcpToolCall', id: 'mcp1', server: 'second-brain', tool: 'tabs_list', status: 'inProgress', arguments: {}, result: null, error: null, durationMs: null };
    notify('item/started', { item, threadId, turnId: t.id });
    notify('item/completed', { item: { ...item, status: 'completed', result: { content: [{ type: 'text', text: 'nessuna scheda' }], structuredContent: null } }, threadId, turnId: t.id });
    await message('Fatto con MCP');
    return complete('completed');
  }
  if (/\bplan\b/.test(text)) {
    notify('turn/plan/updated', { threadId, turnId: t.id, explanation: null, plan: [{ step: 'Leggi', status: 'inProgress' }, { step: 'Scrivi', status: 'pending' }] });
    await sleep(DELAY);
    notify('turn/plan/updated', { threadId, turnId: t.id, explanation: null, plan: [{ step: 'Leggi', status: 'completed' }, { step: 'Scrivi', status: 'completed' }] });
    await message('Piano fatto');
    return complete('completed');
  }
  const rid = `rs_${uuid()}`;
  notify('item/started', { item: { type: 'reasoning', id: rid, summary: [], content: [] }, threadId, turnId: t.id });
  await stream(rid, 'item/reasoning/summaryTextDelta', 'Penso a cosa rispondere.');
  notify('item/completed', { item: { type: 'reasoning', id: rid, summary: ['Penso a cosa rispondere.'], content: [] }, threadId, turnId: t.id });
  await message('Ciao da Codex');
  addUsage(1200, 30);
  complete('completed');
}

function onRequest(id, method, p) {
  const ok = result => out({ id, result });
  const err = (code, message) => out({ id, error: { code, message } });
  // Official JSON v2 ThreadStartParams/TurnStartParams read 2026-10-17. These are wire enums, not SandboxPolicy tags.
  if (['thread/start', 'thread/resume', 'turn/start'].includes(method) && p.approvalPolicy != null && !['untrusted', 'on-request', 'never'].includes(p.approvalPolicy)) return err(-32602, 'invalid approvalPolicy wire enum');
  if (['thread/start', 'thread/resume'].includes(method) && p.sandbox != null && !['read-only', 'workspace-write', 'danger-full-access'].includes(p.sandbox)) return err(-32602, 'invalid sandbox wire enum');
  switch (method) {
    case 'initialize': return ok({ userAgent: 'codex_cli_rs/0.0.0-fake (Windows 10.0.26100; x86_64) fake', codexHome: 'C:/fake/.codex', platformFamily: 'windows', platformOs: 'windows' });
    case 'account/read': return ok(!loggedIn ? { account: null, requiresOpenaiAuth: true } : { account: { type: 'chatgpt', email: 'x@example.com', planType: 'plus' }, requiresOpenaiAuth: true });
    case 'model/list': return ok({ data: [{ id: 'gpt-fake-codex', model: 'gpt-fake-codex', displayName: 'GPT Fake Codex', hidden: false, isDefault: true }, { id: 'gpt-hidden', model: 'gpt-hidden', displayName: 'Hidden', hidden: true, isDefault: false }], nextCursor: null });
    case 'skills/extraRoots/set': return ok({});
    case 'thread/start': case 'thread/resume': {
      if (method === 'thread/resume' && process.env.FAKE_CODEX_RESUME_FAIL === '1') return err(-32600, `thread not found: ${p.threadId}`);
      threadId = method === 'thread/resume' ? p.threadId : uuid();
      if (p.model) model = p.model;
      const turns = method === 'thread/resume' ? [{ id: 't0', status: 'completed', error: null, items: [{ type: 'userMessage', id: 'u0', content: [{ type: 'text', text: 'domanda di prima', text_elements: [] }] }, { type: 'agentMessage', id: 'a0', text: 'risposta di prima' }] }] : [];
      return ok({ thread: { id: threadId, preview: '', modelProvider: 'openai', createdAt: 0, updatedAt: 0, cliVersion: '0.0.0-fake', turns }, model, modelProvider: 'openai', cwd: p.cwd ?? process.cwd(), approvalPolicy: p.approvalPolicy ?? 'on-request', sandbox: { type: 'workspaceWrite' }, reasoningEffort: process.env.FAKE_CODEX_DEFAULT_EFFORT ?? null });
    }
    case 'turn/start': {
      if (turn) return err(-32600, 'a turn is already running');
      if (p.model) model = p.model;
      turn = { id: `turn_${uuid()}`, interrupted: false, steer: null };
      const t = turn;
      const text = (p.input ?? []).filter(i => i.type === 'text').map(i => i.text).join('\n').replace(/\[Orchestrator role supplied by the app\][\s\S]*?\[End Orchestrator role\]\n*/, ''); // the app's Orchestrator role text triggers nothing
      const go = () => { ok({ turn: { id: t.id, items: [], status: 'inProgress', error: null } }); void runTurn(text); };
      const wait = Number(process.env.FAKE_CODEX_TURN_START_DELAY ?? 0);
      if (wait > 0) setTimeout(go, wait); else go();
      return;
    }
    case 'turn/steer': {
      if (!turn || turn.id !== p.expectedTurnId) return err(-32600, 'no active turn to steer');
      turn.steer = (p.input ?? []).filter(i => i.type === 'text').map(i => i.text).join('\n');
      return ok({ turnId: turn.id });
    }
    case 'turn/interrupt': {
      if (turn && turn.id === p.turnId) {
        turn.interrupted = true;
        const t = turn;
        ok({});
        // a turn blocked on a request ends here (the app answered cancel)
        setTimeout(() => { if (turn === t) complete('interrupted'); }, 60);
        return;
      }
      return ok({});
    }
    default: return err(-32601, `unknown method ${method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', raw => {
  let m;
  try { m = JSON.parse(raw); } catch { return; }
  log({ msg: m });
  if (m.method && m.id !== undefined) return onRequest(m.id, m.method, m.params ?? {});
  if (m.method) return; // notifications (initialized)
  const w = waiting.get(m.id);
  if (w) { waiting.delete(m.id); w(m.error ? { error: m.error } : m.result ?? {}); }
});
rl.on('close', () => process.exit(0));
