// CodexSession against the fake app-server (test/fixtures/fake-codex-app-server.mjs): the handshake and its fields
// (no "jsonrpc" field sent), thread start / resume (with replay, and a failed resume that opens a new thread), streaming
// reasoning and answer, tokens and context, approvals (accept / acceptForSession / decline / cancel on Stop), questions,
// steer mid-turn, interrupt, failed and unauthorized turns, a crash, drift on unknown shapes, the API key only in the
// engine's env, the read-only refusal, the test guard, and the helpers. No real Codex ever runs here (ADR 0060).
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CodexSession, codexAuthHelp, codexEffort, codexKey, diffCounts, redactArgs, type CodexOptions } from '../../../src/main/chats/codex';
import { recSink, tmp, waitFor, type RecSink } from './helpers';

const FAKE_CODEX = path.resolve(import.meta.dirname, '..', '..', 'fixtures', 'fake-codex-app-server.mjs');
const BASE = { engineId: 'codex', label: 'Codex', command: 'codex', args: ['app-server'], loginCommand: 'codex login' } satisfies Partial<CodexOptions>;

interface Line { pid: number; argv?: string[]; key?: boolean; msg?: Record<string, unknown> & { method?: string; params?: Record<string, unknown> }; answer?: Record<string, unknown> }
const readLog = (file: string): Line[] => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as Line) : []);
const sent = (file: string, method: string) => readLog(file).filter(l => l.msg?.method === method).map(l => l.msg!);

const open: CodexSession[] = [];
function start(extra: Partial<CodexOptions> = {}): { s: CodexSession; sink: RecSink; cwd: string; logFile: string } {
  const cwd = tmp('cwd');
  const logFile = path.join(tmp('log'), 'codex.jsonl');
  const sink = recSink();
  const s = new CodexSession({ ...BASE, chatId: 'c_codex', cwd, pathOverride: FAKE_CODEX, ...extra, env: { FAKE_CODEX_LOG: logFile, FAKE_CODEX_DELAY: '1', ...extra.env } }, sink);
  open.push(s);
  s.start();
  return { s, sink, cwd, logFile };
}
const results = (sink: RecSink) => [...sink.items.values()].filter(i => i.kind === 'result');
const texts = (sink: RecSink, kind: 'assistant' | 'system' | 'thinking') => [...sink.items.values()].filter(i => i.kind === kind).map(i => (i as { text: string }).text);
const idleAfter = (sink: RecSink, n: number) => waitFor(() => results(sink).length >= n && sink.patch.state === 'idle', `result ${n} and idle`);

afterEach(async () => { await Promise.all(open.splice(0).map(s => s.close(500))); });

describe('helpers', () => {
  it('maps effort, keys, diffs, login help, redacts the MCP urls', () => {
    expect(codexEffort('max')).toBe('xhigh');
    expect(codexEffort('low')).toBe('low');
    expect(codexEffort(null)).toBeNull();
    expect(codexKey({ id: 1, result: {} }, 'thread/start')).toBe('result/thread/start');
    expect(codexKey({ id: 1, method: 'item/fileChange/requestApproval', params: {} })).toBe('request/item/fileChange/requestApproval');
    expect(codexKey({ method: 'item/completed', params: { item: { type: 'agentMessage' } } })).toBe('notify/item/completed/agentMessage');
    expect(diffCounts('--- a/x\n+++ b/x\n@@\n-a\n+b\n+c\n')).toEqual({ added: 2, removed: 1 });
    expect(codexAuthHelp('Codex', 'codex login')).toContain('`codex login`');
    expect(codexAuthHelp('Codex', null)).toContain('Impostazioni → Motori');
    expect(redactArgs(['-c', 'mcp_servers.second-brain.url=http://127.0.0.1:1/mcp/x/token', '-c', 'sandbox_mode=read-only'])).toEqual(['-c', 'mcp_servers.second-brain.url=<url>', '-c', 'sandbox_mode=read-only']);
  });
});

describe('CodexSession', () => {
  it('keeps the reported session default separate from the explicitly submitted turn effort', async () => {
    const { s, sink, logFile } = start({ effort: 'medium', env: { FAKE_CODEX_DEFAULT_EFFORT: 'high' } });
    await s.ready;
    expect(sink.patch.effortSessionDefault).toBe('high');
    expect(sink.patch.effortSubmitted).toBeUndefined();
    s.send('First'); await idleAfter(sink, 1);
    expect(sink.patch.effortSessionDefault).toBe('high');
    expect(sink.patch.effortSubmitted).toBe('medium');
    expect(sent(logFile, 'turn/start')[0]?.params?.effort).toBe('medium');
  });
  it('applies and revokes repository autonomy on later turns without restarting or answering pending approvals', async () => {
    let autonomous = true;
    const { s, sink, logFile, cwd } = start({ executionPolicy: () => ({ approvalPolicy: autonomous ? 'never' : 'on-request', sandbox: 'workspace-write', writableRoots: autonomous ? [cwd] : [] }) });
    await s.ready;
    const pid = s.pid;
    expect(sent(logFile, 'thread/start')[0]?.params).toMatchObject({ approvalPolicy: 'never', sandbox: 'workspace-write' });
    s.send('uno');
    await idleAfter(sink, 1);
    expect(sent(logFile, 'turn/start')[0]?.params).toMatchObject({ approvalPolicy: 'never', sandboxPolicy: { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true } });
    autonomous = false;
    s.send('due');
    await idleAfter(sink, 2);
    expect(sent(logFile, 'turn/start')[1]?.params).toMatchObject({ approvalPolicy: 'on-request', sandboxPolicy: { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: false } });
    expect(s.pid).toBe(pid);
    expect(sink.pendings).toHaveLength(0);
  });

  it('read-only overrides an autonomy callback and never grants writable roots', async () => {
    const { s, sink, logFile } = start({ readOnly: true, executionPolicy: () => ({ approvalPolicy: 'never', sandbox: 'workspace-write', writableRoots: ['C:/unselected'] }) });
    await s.ready;
    s.send('uno');
    await idleAfter(sink, 1);
    expect(sent(logFile, 'thread/start')[0]?.params).toMatchObject({ approvalPolicy: 'on-request', sandbox: 'read-only' });
    expect(sent(logFile, 'turn/start')[0]?.params).toMatchObject({ approvalPolicy: 'on-request', sandboxPolicy: { type: 'readOnly' } });
  });

  it('an approval emitted by the server still waits for the user in scoped autonomy', async () => {
    const { s, sink, logFile } = start({ executionPolicy: () => ({ approvalPolicy: 'never', sandbox: 'workspace-write', writableRoots: [] }) });
    await s.ready;
    s.send('perm');
    const pending = await waitFor(() => sink.pendings[0], 'server approval in scoped mode');
    expect(sink.patch.state).toBe('waiting');
    expect(sink.resolvedIds).toHaveLength(0);
    expect(readLog(logFile).filter(l => l.answer)).toHaveLength(0);
    s.answer(pending.id, { kind: 'permission', allow: false });
    await idleAfter(sink, 1);
    expect(readLog(logFile).find(l => l.answer)?.answer).toEqual({ decision: 'decline' });
  });

  it('starts a thread, streams reasoning and answer, reports tokens and context', async () => {
    const { s, sink, logFile } = start({ model: 'gpt-x', effort: 'max', configArgs: ['-c', 'approval_policy=on-request'], developerInstructions: 'Regole del cervello', skillRoots: ['C:/b/skills'] });
    await s.ready;
    expect(sink.patch.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.sessionId).toBe(sink.patch.sessionId);
    expect(sink.patch.version).toBe('0.0.0-fake');
    expect(sink.modelLists.at(-1)).toEqual([{ id: 'gpt-fake-codex', name: 'GPT Fake Codex' }]);
    s.send('ciao');
    await idleAfter(sink, 1);
    expect(texts(sink, 'assistant')).toEqual(['Ciao da Codex']);
    expect(texts(sink, 'thinking')).toEqual(['Penso a cosa rispondere.']);
    const assistant = sink.last('assistant');
    expect(assistant && 'streaming' in assistant && assistant.streaming).toBe(false);
    expect(sink.patch.lastText).toBe('Ciao da Codex');
    expect(sink.patch.contextTokens).toBe(1230);
    expect(sink.patch.contextMaxTokens).toBe(272000);
    expect(await s.contextUsage()).toMatchObject({ totalTokens: 1230, maxTokens: 272000 });
    expect(sink.patch.turnTokens).toEqual({ input: 1200, cacheRead: 0, cacheWrite: 0, output: 30 });
    expect(sink.patch.costKnown).toBe(false);
    const log = readLog(logFile);
    expect(log[0]?.argv).toEqual(['-c', 'approval_policy=on-request', 'app-server']);
    expect(log.every(l => !l.msg || !('jsonrpc' in l.msg))).toBe(true);
    const init = sent(logFile, 'initialize')[0]!.params as { clientInfo: { name: string } };
    expect(init.clientInfo.name).toBe('second_brain');
    expect(sent(logFile, 'initialized')).toHaveLength(1);
    expect(sent(logFile, 'skills/extraRoots/set')[0]?.params).toEqual({ extraRoots: ['C:/b/skills'] });
    expect(sent(logFile, 'thread/start')[0]?.params).toMatchObject({ model: 'gpt-x', approvalPolicy: 'on-request', sandbox: 'workspace-write', developerInstructions: 'Regole del cervello' });
    expect(sent(logFile, 'turn/start')[0]?.params).toMatchObject({ model: 'gpt-x', effort: 'xhigh', input: [{ type: 'text', text: 'ciao', text_elements: [] }] });
  });

  it('second turn: tokens are the delta of the thread totals; model and effort change for the next turn', async () => {
    const { s, sink, logFile } = start();
    s.send('uno');
    await idleAfter(sink, 1);
    await s.setModel('gpt-other');
    await s.setEffort('low');
    s.send('due');
    await idleAfter(sink, 2);
    expect(sink.patch.turnTokens).toEqual({ input: 1200, cacheRead: 0, cacheWrite: 0, output: 30 });
    expect(sent(logFile, 'turn/start')[1]?.params).toMatchObject({ model: 'gpt-other', effort: 'low' });
    await expect(s.setModel('--evil')).rejects.toThrow();
    await expect(s.setPermissionMode('plan')).rejects.toThrow(/modalità/);
  });

  it('command approval: accept runs it, the panel closes', async () => {
    const { s, sink, logFile } = start();
    s.send('perm');
    const req = await waitFor(() => sink.pendings[0], 'approval');
    expect(req).toMatchObject({ type: 'permission', tool: 'Shell', title: 'Shell: npm test' });
    expect(sink.patch.state).toBe('waiting');
    expect(s.answer(req.id, { kind: 'permission', allow: true })).toBe(true);
    await idleAfter(sink, 1);
    expect(readLog(logFile).find(l => l.answer)?.answer).toEqual({ decision: 'accept' });
    expect(texts(sink, 'assistant')).toContain('Comando eseguito');
    const tool = sink.last('tool');
    expect(tool).toMatchObject({ name: 'Shell', status: 'ok', exitCode: 0 }); // the exact exit code (receipts, ADR 0130)
    expect(tool?.output).toContain('tutti i test passano');
    expect(sink.resolvedIds).toContain(req.id);
    expect(s.answer(req.id, { kind: 'permission', allow: true })).toBe(false);
  });

  it('command approval: always = acceptForSession, deny = decline', async () => {
    const a = start();
    a.s.send('perm');
    const r1 = await waitFor(() => a.sink.pendings[0], 'approval');
    a.s.answer(r1.id, { kind: 'permission', allow: true, always: true });
    await idleAfter(a.sink, 1);
    expect(readLog(a.logFile).find(l => l.answer)?.answer).toEqual({ decision: 'acceptForSession' });
    const b = start();
    b.s.send('perm');
    const r2 = await waitFor(() => b.sink.pendings[0], 'approval');
    expect(() => b.s.answer(r2.id, { kind: 'question', answers: {} })).toThrow();
    b.s.answer(r2.id, { kind: 'permission', allow: false, message: 'no' });
    await idleAfter(b.sink, 1);
    expect(readLog(b.logFile).find(l => l.answer)?.answer).toEqual({ decision: 'decline' });
    expect(b.sink.last('tool')).toMatchObject({ status: 'error', output: 'rifiutato' });
  });

  it('file change: a panel naming the file, the diff on the tool row', async () => {
    const { s, sink, cwd } = start();
    s.send('edit');
    const req = await waitFor(() => sink.pendings[0], 'approval');
    expect(req).toMatchObject({ tool: 'Edit', title: 'Modifica: a.txt' });
    s.answer(req.id, { kind: 'permission', allow: true });
    await idleAfter(sink, 1);
    const tool = sink.last('tool');
    expect(tool?.diff?.[0]).toMatchObject({ path: 'a.txt', added: 2, removed: 1 });
    expect(cwd).toBeTruthy();
  });

  it('question: the answer goes back by question id', async () => {
    const { s, sink, logFile } = start();
    s.send('ask');
    const req = await waitFor(() => sink.pendings[0], 'question');
    expect(req.type).toBe('question');
    expect(req.questions?.[0]).toMatchObject({ question: 'Che colore preferisci?', header: 'Colore', options: [{ label: 'Rosso', description: 'caldo' }, { label: 'Blu', description: 'freddo' }] });
    s.answer(req.id, { kind: 'question', answers: { 'Che colore preferisci?': 'Blu' } });
    await idleAfter(sink, 1);
    expect(readLog(logFile).find(l => l.answer)?.answer).toEqual({ answers: { colore: { answers: ['Blu'] } } });
    expect(texts(sink, 'assistant')).toContain('Hai scelto Blu');
  });

  it.each([true, false])('MCP empty form: explicit allow=%s, no automatic or persistent consent', async allow => {
    const { s, sink, logFile } = start();
    s.send('elicitation');
    await waitFor(() => sink.pendings.length || results(sink).length, 'MCP panel or result');
    const req = sink.pendings[0]!;
    expect(req).toBeDefined();
    expect(req).toMatchObject({ type: 'permission', tool: 'mcp__second_brain_app__app_chats', noAlways: true });
    expect(req.title).toContain('Consenti');
    expect(req.detail).toContain('Intervallo: 2h');
    expect(req.detail).toContain('Elenca le chat visibili');
    expect(req.input).toMatchObject({ server: 'second_brain_app', arguments: { since: '2h' } });
    expect(readLog(logFile).filter(l => l.msg?.id === 1000)).toHaveLength(0);
    expect(() => s.answer(req.id, { kind: 'question', answers: {} })).toThrow();
    expect(() => s.answer(req.id, { kind: 'permission', allow: true, always: true })).toThrow();
    expect(s.answer(req.id, { kind: 'permission', allow })).toBe(true);
    expect(s.answer(req.id, { kind: 'permission', allow })).toBe(false);
    await idleAfter(sink, 1);
    expect(readLog(logFile).find(l => l.answer)?.answer).toEqual({ action: allow ? 'accept' : 'decline', content: allow ? {} : null });
    expect(readLog(logFile).filter(l => l.msg?.id === 1000)).toHaveLength(1);
    expect(sink.resolvedIds.filter(id => id === req.id)).toHaveLength(1);
  });

  it('MCP Stop cancels with null content exactly once', async () => {
    const { s, sink, logFile } = start();
    s.send('elicitation');
    const req = await waitFor(() => sink.pendings[0], 'MCP approval');
    await s.interrupt({ byUser: true });
    await idleAfter(sink, 1);
    expect(readLog(logFile).find(l => l.answer)?.answer).toEqual({ action: 'cancel', content: null });
    expect(s.answer(req.id, { kind: 'permission', allow: true })).toBe(false);
    expect(readLog(logFile).filter(l => l.msg?.id === 1000)).toHaveLength(1);
    expect(sink.resolvedIds.filter(id => id === req.id)).toHaveLength(1);
  });

  it.each(['resolved', 'completed'])('MCP %s withdraws a turn-scoped panel without a late response', async ending => {
    const { s, sink, logFile } = start();
    s.send(`elicitation ${ending}`);
    const req = await waitFor(() => sink.pendings[0], 'MCP approval');
    await idleAfter(sink, 1);
    expect(sink.resolvedIds.filter(id => id === req.id)).toHaveLength(1);
    expect(s.answer(req.id, { kind: 'permission', allow: true })).toBe(false);
    expect(readLog(logFile).filter(l => l.msg?.id === 1000)).toHaveLength(0);
  });

  it('MCP standalone request survives turn end; only its thread may resolve it', async () => {
    const { s, sink, logFile } = start({ env: { FAKE_CODEX_ELICITATION: JSON.stringify({ turnId: null }) } });
    s.send('elicitation completed');
    const req = await waitFor(() => sink.pendings[0], 'MCP approval');
    await waitFor(() => results(sink).length === 1, 'turn end');
    expect(sink.patch.state).toBe('waiting');
    s.line(JSON.stringify({ method: 'serverRequest/resolved', params: { threadId: 'another-thread', requestId: 1000 } }));
    expect(sink.resolvedIds).not.toContain(req.id);
    s.line(JSON.stringify({ method: 'serverRequest/resolved', params: { threadId: s.sessionId, requestId: 1000 } }));
    expect(sink.resolvedIds.filter(id => id === req.id)).toHaveLength(1);
    expect(s.answer(req.id, { kind: 'permission', allow: true })).toBe(false);
    expect(readLog(logFile).filter(l => l.msg?.id === 1000)).toHaveLength(0);
    expect(sink.patch.state).toBe('idle');
  });

  it('MCP session close removes the panel and rejects a later click', async () => {
    const { s, sink } = start();
    s.send('elicitation');
    const req = await waitFor(() => sink.pendings[0], 'MCP approval');
    await s.close(500);
    expect(sink.resolvedIds.filter(id => id === req.id)).toHaveLength(1);
    expect(s.answer(req.id, { kind: 'permission', allow: true })).toBe(false);
  });

  it.each([
    { mode: 'url', url: 'https://example.com/confirm', elicitationId: 'e1' },
    { mode: 'openai/form' }, { mode: 'openaiForm' }, { mode: null },
    { requestedSchema: null }, { requestedSchema: [] },
    { requestedSchema: { type: 'object', properties: { answer: { type: 'string' } } } },
    { requestedSchema: { type: 'object', properties: {}, required: ['answer'] } },
    { requestedSchema: { type: 'object', properties: {}, minProperties: 1 } },
    { requestedSchema: { type: 'object', properties: {}, additionalProperties: { type: 'string' } } },
    { message: '' }, { threadId: 'another-thread' }, { turnId: 'another-turn' },
    { _meta: { tool_params: [] } }, { _meta: { tool_params_display: [{ name: 'x' }] } },
  ])('MCP unsupported or malformed input yields an RPC error, never user decline: %j', async params => {
    const { s, sink, logFile } = start({ env: { FAKE_CODEX_ELICITATION: JSON.stringify(params) } });
    s.send('elicitation');
    await idleAfter(sink, 1);
    expect(sink.pendings).toHaveLength(0);
    const replies = readLog(logFile).filter(l => l.msg?.id === 1000);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.msg).toMatchObject({ error: { code: -32602 } });
    expect(replies[0]?.msg).not.toHaveProperty('result');
    expect(texts(sink, 'system').some(t => /MCP.*non supportata|MCP.*non valida/.test(t))).toBe(true);
  });

  it('tool/requestUserInput is not guessed as the item/tool/requestUserInput protocol', async () => {
    const { s, sink, logFile } = start();
    await s.ready;
    s.line(JSON.stringify({ id: 8888, method: 'tool/requestUserInput', params: { threadId: s.sessionId, questions: [] } }));
    await waitFor(() => readLog(logFile).some(l => l.msg?.id === 8888), 'unsupported protocol response');
    expect(sink.pendings).toHaveLength(0);
    expect(readLog(logFile).find(l => l.msg?.id === 8888)?.msg).toMatchObject({ error: { code: -32601 } });
  });

  it('a message while a turn runs steers it', async () => {
    const { s, sink, logFile } = start();
    s.send('slow');
    await waitFor(() => sent(logFile, 'turn/start').length && sink.patch.state === 'running' && texts(sink, 'assistant').length, 'streaming');
    s.send('cambia strada');
    await idleAfter(sink, 1);
    expect(sent(logFile, 'turn/steer')[0]?.params).toMatchObject({ input: [{ type: 'text', text: 'cambia strada', text_elements: [] }] });
    expect(texts(sink, 'assistant')).toContain('Ricevuto: cambia strada');
    expect(sent(logFile, 'turn/start')).toHaveLength(1);
  });

  it('Stop interrupts the turn; an open panel is answered cancel', async () => {
    const a = start();
    a.s.send('slow');
    await waitFor(() => texts(a.sink, 'assistant').length, 'streaming');
    await a.s.interrupt({ byUser: true });
    await idleAfter(a.sink, 1);
    expect(results(a.sink)[0]).toMatchObject({ interrupted: true, isError: false });
    expect(texts(a.sink, 'system')).toContain('Interrotto da te.');
    const b = start();
    b.s.send('perm');
    const req = await waitFor(() => b.sink.pendings[0], 'approval');
    await b.s.interrupt({ byUser: true });
    await idleAfter(b.sink, 1);
    expect(readLog(b.logFile).find(l => l.answer)?.answer).toEqual({ decision: 'cancel' });
    expect(b.sink.resolvedIds).toContain(req.id);
  });

  it('a failed turn shows the error; unauthorized shows the login help', async () => {
    const { s, sink } = start();
    s.send('fail');
    await idleAfter(sink, 1);
    expect(results(sink)[0]).toMatchObject({ isError: true });
    expect(texts(sink, 'system').some(t => t.includes('Il modello finto ha fallito'))).toBe(true);
    s.send('unauth');
    await idleAfter(sink, 2);
    expect(texts(sink, 'system').some(t => t.includes('`codex login`'))).toBe(true);
  });

  it('no account: the login help before any turn, key or not; the app never logs in, the key goes only into the env', async () => {
    const a = start({ env: { FAKE_CODEX_NO_AUTH: '1' } });
    await waitFor(() => a.sink.exited, 'exit');
    expect(a.sink.exited?.error).toContain('Accedi a Codex');
    const b = start({ env: { FAKE_CODEX_NO_AUTH: '1', CODEX_API_KEY: 'sk-test' } });
    await waitFor(() => b.sink.exited, 'exit');
    expect(b.sink.exited?.error).toContain('Accedi a Codex');
    expect(readLog(b.logFile)[0]?.key).toBe(true);
    expect(sent(b.logFile, 'account/login/start')).toEqual([]);
    // logged in with `codex login` and a key saved: the key reaches the env, still no login call
    const d = start({ env: { CODEX_API_KEY: 'sk-test' } });
    await d.s.ready;
    d.s.send('ciao');
    await idleAfter(d.sink, 1);
    expect(readLog(d.logFile)[0]?.key).toBe(true);
    expect(sent(d.logFile, 'account/login/start')).toEqual([]);
  });

  it('file change with grantRoot: the panel says it is write access to the folder for the whole session, no "sempre"', async () => {
    const { s, sink, logFile } = start();
    s.send('grant');
    const req = await waitFor(() => sink.pendings[0], 'approval');
    expect(req.title).toMatch(/^Scrivere in .+ per tutta la sessione$/);
    expect(req.detail).toContain('sottocartelle per tutta la sessione');
    expect(req.alwaysRules).toBeUndefined();
    s.answer(req.id, { kind: 'permission', allow: true, always: true });
    await idleAfter(sink, 1);
    expect(readLog(logFile).find(l => l.answer)?.answer).toEqual({ decision: 'accept' });
  });

  it('Stop before turn/start is answered: turn/interrupt goes out as soon as the turn id arrives', async () => {
    const { s, sink, logFile } = start({ env: { FAKE_CODEX_TURN_START_DELAY: '400' } });
    s.send('slow');
    await waitFor(() => sent(logFile, 'turn/start').length, 'turn/start sent');
    await s.interrupt({ byUser: true });
    expect(sent(logFile, 'turn/interrupt')).toEqual([]);
    await idleAfter(sink, 1);
    expect(sent(logFile, 'turn/interrupt')).toHaveLength(1);
    expect(results(sink)[0]).toMatchObject({ interrupted: true });
  });

  it('resume: the same thread, its past replayed; a failed resume opens a new thread', async () => {
    const id = '0199a0b0-0000-7000-8000-000000000001';
    const a = start({ resume: true, sessionId: id, showReplay: true });
    await a.s.ready;
    expect(a.s.sessionId).toBe(id);
    expect(sent(a.logFile, 'thread/resume')[0]?.params).toMatchObject({ threadId: id });
    expect(texts(a.sink, 'assistant')).toEqual(['risposta di prima']);
    expect([...a.sink.items.values()].some(i => i.kind === 'user' && i.text === 'domanda di prima')).toBe(true);
    const b = start({ resume: true, sessionId: id, env: { FAKE_CODEX_RESUME_FAIL: '1' } });
    await b.s.ready;
    expect(b.s.sessionId).not.toBe(id);
    expect(texts(b.sink, 'system').some(t => t.includes('ne apro una nuova'))).toBe(true);
  });

  it('mcp tool call, plan updates, drift on unknown shapes', async () => {
    const { s, sink } = start();
    s.send('mcp');
    await idleAfter(sink, 1);
    expect(sink.last('tool')).toMatchObject({ name: 'mcp__second-brain__tabs_list', status: 'ok', output: 'nessuna scheda' });
    s.send('plan');
    await idleAfter(sink, 2);
    const plans = texts(sink, 'system').filter(t => t.startsWith('Piano:'));
    expect(plans).toHaveLength(1);
    expect(plans[0]).toContain('✓ Scrivi');
    s.send('unknown');
    await idleAfter(sink, 3);
    expect(texts(sink, 'assistant').at(-1)).toBe('Ciao da Codex');
  });

  it('a crash ends the session with the stderr tail', async () => {
    const { s, sink } = start();
    s.send('crash');
    await waitFor(() => sink.exited, 'exit');
    expect(sink.exited?.error).toContain('crash requested');
    expect(sink.patch.state).toBe('error');
    expect(() => s.send('ancora')).toThrow();
  });

  it('a read-only run with denied folders never starts; read-only alone gets the read-only sandbox', async () => {
    const a = start({ readOnly: true, denyRead: ['C:/x'] });
    await waitFor(() => a.sink.exited, 'exit');
    expect(a.sink.exited?.error).toContain('sola lettura');
    const b = start({ readOnly: true });
    await b.s.ready;
    expect(sent(b.logFile, 'thread/start')[0]?.params).toMatchObject({ sandbox: 'read-only' });
  });

  it('under tests the real CLI is refused', async () => {
    const sink = recSink();
    const s = new CodexSession({ ...BASE, chatId: 'c_real', cwd: tmp('cwd'), pathOverride: 'C:/nowhere/codex.cmd' }, sink);
    open.push(s);
    s.start();
    expect(sink.exited?.error).toContain('fake');
  });

  it('close ends the process cleanly', async () => {
    const { s, sink } = start();
    await s.ready;
    await s.close(2000);
    expect(sink.exited).toEqual({ code: 0, error: null });
    expect(s.alive).toBe(false);
  });
});
