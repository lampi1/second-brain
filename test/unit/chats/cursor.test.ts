// CursorSession over ACP against the fake agent (test/fixtures/fake-cursor-acp.mjs): engine resolution and the test
// guard, streaming, permissions (allow once / always / reject, no "always"), cursor/ask_question, cursor/create_plan,
// cancel, queued prompts, login missing, resume with session/load, model and mode, MCP, diffs, usage → cost.
// The real Cursor engine never runs here.
import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cursorAllowed, cursorArgv, newestCursorVersion, resolveCursor } from '../../../src/main/chats/cli';
import { AUTH_HELP, CursorSession, MODEL_RESTART, cursorConfigDir, type CursorOptions } from '../../../src/main/chats/cursor';
import { costOf, priceOf } from '../../../src/main/chats/cursor-prices';
import { cursorStatus, openLogin } from '../../../src/main/cli';
import { FAKE_CURSOR, cursorLog, recSink, tmp, waitFor, type RecSink } from './helpers';

const open: CursorSession[] = [];
const logs: string[] = [];
function start(extra: Partial<CursorOptions> = {}): { s: CursorSession; sink: RecSink; cwd: string; logFile: string } {
  const cwd = tmp('cwd');
  const logFile = path.join(tmp('log'), 'cursor.jsonl');
  logs.push(logFile);
  const sink = recSink();
  // the fake writes --model into CURSOR_CONFIG_DIR like the real CLI: always a temp folder here
  const s = new CursorSession({ chatId: 'c_cur', cwd, cursorPath: FAKE_CURSOR, ...extra, env: { FAKE_CURSOR_LOG: logFile, CURSOR_CONFIG_DIR: tmp('cursor-cfg'), ...extra.env } }, sink);
  open.push(s);
  s.start();
  return { s, sink, cwd, logFile };
}
const results = (sink: RecSink) => [...sink.items.values()].filter(i => i.kind === 'result');
const answerOf = (logFile: string) => cursorLog(logFile).filter(l => 'answer' in l).at(-1)?.answer?.outcome;

afterEach(async () => {
  await Promise.all(open.splice(0).map(s => s.close(500)));
  // in every test: session/set_model writes the user's global Cursor config, the app must never send it;
  // authenticate would open a browser login from a hidden process
  for (const f of logs.splice(0)) for (const l of cursorLog(f)) expect(['session/set_model', 'authenticate']).not.toContain(l.method);
});

describe('Cursor engine resolution', () => {
  it('starts the newest CLI version with its own node.exe (no PowerShell launcher)', () => {
    const local = tmp('local');
    const v = path.join(local, 'cursor-agent', 'versions');
    const mk = (name: string, files = ['node.exe', 'index.js']) => { fs.mkdirSync(path.join(v, name), { recursive: true }); for (const f of files) fs.writeFileSync(path.join(v, name, f), ''); };
    mk('2026.07.16-899851b');
    mk('2026.07.23-e383d2b');
    mk('2026.07.23-10-11-12-abc123'); // same day, later build (timestamp form)
    mk('2026.08.01-deadbee', ['index.js']); // no node.exe: incomplete install
    mk('not-a-version');
    fs.writeFileSync(path.join(v, `${crypto.randomUUID()}.zip`), ''); // a stray download next to the versions
    expect(newestCursorVersion(v)).toBe(path.join(v, '2026.07.23-10-11-12-abc123'));
    const c = resolveCursor(null, { LOCALAPPDATA: local });
    expect(c).toMatchObject({ kind: 'node', command: path.join(v, '2026.07.23-10-11-12-abc123', 'node.exe'), prefix: [path.join(v, '2026.07.23-10-11-12-abc123', 'index.js')] });
    expect(c?.env).toMatchObject({ CURSOR_INVOKED_AS: 'agent.cmd', NODE_COMPILE_CACHE: path.join(local, 'cursor-compile-cache') });
    expect(cursorArgv(c!, ['--model', 'gpt-5', 'acp']).args).toEqual([path.join(v, '2026.07.23-10-11-12-abc123', 'index.js'), '--model', 'gpt-5', 'acp']);
  });

  it('falls back to agent.cmd through cmd.exe with safe arguments only', () => {
    const c = resolveCursor('C:\\Tools\\agent.cmd', {});
    expect(c?.kind).toBe('cmd');
    expect(cursorArgv(c!, ['--model', 'claude-opus-4-8[effort=high]', 'acp'])).toMatchObject({ verbatim: true, args: ['/d', '/s', '/c', '""C:\\Tools\\agent.cmd" --model claude-opus-4-8[effort=high] acp"'] });
    expect(() => cursorArgv(c!, ['--model', 'x & calc', 'acp'])).toThrow(/non sicuro/);
  });

  it('never starts the real Cursor engine under tests', async () => {
    const real = { kind: 'node' as const, command: 'C:\\x\\node.exe', prefix: ['C:\\x\\index.js'], env: {}, verbatim: false, display: 'C:\\x' };
    expect(cursorAllowed(real, { VITEST: 'true' })).toBe(false);
    expect(cursorAllowed(real, { SB_TEST: '1' })).toBe(false);
    expect(cursorAllowed(real, {})).toBe(true);
    expect(cursorAllowed(resolveCursor(FAKE_CURSOR, {})!, { SB_TEST: '1' })).toBe(true);
    // a script that is not a .mjs fake, or that lives in Cursor's install, is the real engine run as a script
    expect(cursorAllowed(resolveCursor('C:\\x\\cursor-agent\\versions\\v\\index.js', {})!, { SB_TEST: '1' })).toBe(false);
    expect(cursorAllowed(resolveCursor('C:\\x\\cursor-agent\\versions\\v\\evil.mjs', {})!, { VITEST: 'true' })).toBe(false);
    expect(cursorAllowed(resolveCursor('C:\\x\\other.cjs', {})!, { VITEST: 'true' })).toBe(false);
    const sink = recSink();
    const s = new CursorSession({ chatId: 'c', cwd: tmp('cwd') }, sink, real);
    s.start();
    expect(s.state).toBe('error');
    expect(s.pid).toBeNull(); // nothing spawned
    expect(sink.exited?.error).toMatch(/Nei test il motore Cursor reale non parte mai/);
  });

  it('status and login never run the real Cursor CLI under tests', async () => {
    const prev = process.env.SB_CURSOR_PATH;
    delete process.env.SB_CURSOR_PATH;
    try {
      const st = await cursorStatus(); // resolves the installed CLI if any, but does not run it
      expect(st.version).toBeNull();
      expect(() => openLogin('cursor')).toThrow(/Nei test/);
    } finally { if (prev !== undefined) process.env.SB_CURSOR_PATH = prev; }
  });
});

describe('CursorSession', () => {
  it('streams thought and text, ends the turn, reports no cost (ACP gives no usage)', async () => {
    const { s, sink, logFile } = start();
    await waitFor(() => s.state === 'idle', 'session ready');
    expect(s.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(sink.patch.model).toBe('auto');
    s.send('hello');
    await waitFor(() => results(sink).length === 1 && s.state === 'idle', 'turn');
    expect(sink.last('thinking')?.text).toBe('Penso un attimo');
    const a = sink.last('assistant');
    expect(a).toMatchObject({ text: 'Ciao dal motore', streaming: false });
    const versions = sink.events.filter(e => e.item.id === a?.id);
    expect(versions[0]).toMatchObject({ replace: false, item: { streaming: true } });
    expect(versions.at(-1)?.replace).toBe(true);
    expect(results(sink)[0]).toMatchObject({ costUsd: 0, turns: 1, isError: false });
    expect(sink.patch).toMatchObject({ costKnown: false, lastText: 'Ciao dal motore' });
    const init = cursorLog(logFile).find(l => l.method === 'initialize');
    expect(init?.params).toMatchObject({ protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } });
    expect(cursorLog(logFile).some(l => l.method === 'authenticate')).toBe(false); // never: it would open a browser login
  });

  // Cursor's allow-always would write a permanent rule into the user's Cursor config: the app never offers or sends it
  it('permission: allow once and reject map to the ACP option ids; "always" is never offered nor sent', async () => {
    const { s, sink, logFile } = start();
    s.send('perm');
    const p = await waitFor(() => sink.pendings[0], 'permission');
    expect(p).toMatchObject({ type: 'permission', tool: 'Shell', title: 'Run `npm test`', noAlways: true });
    expect(p.alwaysRules).toBeUndefined();
    expect(p.detail).toContain('npm test');
    expect(p.detail).toContain('Esegue i test');
    expect(s.state).toBe('waiting');
    expect(() => s.answer(p.id, { kind: 'question', answers: {} })).toThrow(/permesso/);
    s.answer(p.id, { kind: 'permission', allow: true, always: true });
    await waitFor(() => results(sink).length === 1, 'turn');
    expect(answerOf(logFile)).toEqual({ outcome: 'selected', optionId: 'allow-once' });
    expect([...sink.items.values()].find(i => i.kind === 'tool')).toMatchObject({ name: 'Shell', summary: 'Shell: npm test', status: 'ok', output: '3 passed (allow-once)' });

    s.send('perm again');
    const p2 = await waitFor(() => sink.pendings[1], 'second permission');
    s.answer(p2.id, { kind: 'permission', allow: true });
    await waitFor(() => results(sink).length === 2, 'turn 2');
    expect(answerOf(logFile)).toEqual({ outcome: 'selected', optionId: 'allow-once' });

    s.send('perm three');
    const p3 = await waitFor(() => sink.pendings[2], 'third permission');
    s.answer(p3.id, { kind: 'permission', allow: false, message: 'no' });
    await waitFor(() => results(sink).length === 3, 'turn 3');
    expect(answerOf(logFile)).toEqual({ outcome: 'selected', optionId: 'reject-once' });
    expect(sink.last('assistant')?.text).toBe('Ok, non lo eseguo.');
  });

  it('no "always" either when Cursor does not offer allow-always', async () => {
    const { s, sink, logFile } = start();
    s.send('locked');
    const p = await waitFor(() => sink.pendings[0], 'permission');
    expect(p.noAlways).toBe(true);
    expect(p.alwaysRules).toBeUndefined();
    s.answer(p.id, { kind: 'permission', allow: true, always: true });
    await waitFor(() => results(sink).length === 1, 'turn');
    expect(answerOf(logFile)).toEqual({ outcome: 'selected', optionId: 'allow-once' });
  });

  it('cursor/ask_question: labels back to ACP ids, multi-select, skip', async () => {
    const { s, sink, logFile } = start();
    s.send('ask');
    const q = await waitFor(() => sink.pendings[0], 'questions');
    expect(q).toMatchObject({ type: 'question', tool: 'AskQuestion', title: 'Due domande' });
    expect(q.questions?.map(x => [x.question, x.multiSelect, x.options.map(o => o.label)])).toEqual([['Che colore?', false, ['Blu', 'Rosso']], ['Quali file?', true, ['a.ts', 'b.ts', 'c.ts']]]);
    expect(() => s.answer(q.id, { kind: 'permission', allow: true })).toThrow(/domanda/);
    s.answer(q.id, { kind: 'question', answers: { 'Che colore?': 'Rosso', 'Quali file?': ['a.ts', 'c.ts'] } });
    await waitFor(() => results(sink).length === 1, 'turn');
    expect(answerOf(logFile)).toEqual({ outcome: 'answered', answers: [{ questionId: 'q_color', selectedOptionIds: ['o_red'] }, { questionId: 'q_files', selectedOptionIds: ['f_a', 'f_c'] }] });
    expect(sink.last('assistant')?.text).toBe('Risposte: q_color=o_red; q_files=f_a,f_c');

    s.send('ask again');
    const q2 = await waitFor(() => sink.pendings[1], 'questions 2');
    s.answer(q2.id, { kind: 'permission', allow: false, message: 'dopo' });
    await waitFor(() => results(sink).length === 2, 'turn 2');
    expect(answerOf(logFile)).toEqual({ outcome: 'skipped', reason: 'dopo' });
  });

  it('cursor/create_plan becomes "Approvi il piano?"', async () => {
    const { s, sink, logFile } = start();
    s.send('plan');
    const q = await waitFor(() => sink.pendings[0], 'plan');
    expect(q).toMatchObject({ type: 'question', tool: 'CreatePlan', title: 'Approvi il piano?' });
    expect(q.detail).toContain('# Piano');
    expect(q.questions?.[0]?.options.map(o => o.label)).toEqual(['Approva', 'Rifiuta']);
    s.answer(q.id, { kind: 'question', answers: { 'Approvi il piano?': 'Approva' } });
    await waitFor(() => results(sink).length === 1, 'turn');
    expect(answerOf(logFile)).toEqual({ outcome: 'accepted' });
    s.send('plan b');
    const q2 = await waitFor(() => sink.pendings[1], 'plan 2');
    s.answer(q2.id, { kind: 'question', answers: { 'Approvi il piano?': 'Rifiuta' } });
    await waitFor(() => results(sink).length === 2, 'turn 2');
    expect(answerOf(logFile)).toEqual({ outcome: 'rejected' });
  });

  it('stop: session/cancel, open panels answered "cancelled", queued messages dropped', async () => {
    const { s, sink, logFile } = start();
    s.send('perm');
    const p = await waitFor(() => sink.pendings[0], 'permission');
    s.send('queued one');
    await s.interrupt();
    expect(sink.resolvedIds).toContain(p.id);
    await waitFor(() => results(sink).length === 1 && s.state === 'idle', 'cancelled turn');
    expect(results(sink)[0]).toMatchObject({ isError: true });
    expect(answerOf(logFile)).toEqual({ outcome: 'cancelled' });
    expect(cursorLog(logFile).some(l => l.method === 'session/cancel')).toBe(true);
    expect([...sink.items.values()].some(i => i.kind === 'system' && /coda annullati: 1/.test(i.text))).toBe(true);
    await new Promise(r => setTimeout(r, 200));
    expect(results(sink)).toHaveLength(1); // the queued message never ran

    s.send('slow');
    await waitFor(() => sink.last('assistant')?.text.includes('tick'), 'streaming');
    await s.interrupt();
    await waitFor(() => results(sink).length === 2 && s.state === 'idle', 'cancelled stream');
    expect(sink.last('assistant')?.streaming).toBe(false);
  });

  it('runs queued messages one after the other and stays running in between', async () => {
    const { s, sink } = start({ env: { FAKE_CURSOR_DELAY: '20' } });
    await waitFor(() => s.state === 'idle', 'ready');
    s.send('first');
    s.send('second');
    await waitFor(() => results(sink).length === 2 && s.state === 'idle', 'two turns');
    const first = sink.trace.indexOf('result'), second = sink.trace.lastIndexOf('result');
    expect(sink.trace.slice(first, second)).not.toContain('state:idle');
  });

  it('not logged in: "Accedi a Cursor", the process is stopped, authenticate is never called', async () => {
    const { s, sink, logFile } = start({ env: { FAKE_CURSOR_NO_AUTH: '1' } });
    await waitFor(() => sink.exited, 'stopped');
    expect(s.state).toBe('error');
    expect(sink.exited?.error).toBe(AUTH_HELP);
    expect(cursorLog(logFile).some(l => l.method === 'authenticate')).toBe(false);
    expect(() => s.send('x')).toThrow(/non è attiva/);
  });

  it('resumes with session/load (the replayed past is not shown again), or opens a new session', async () => {
    const sid = '1c194f13-0000-4000-8000-000000000001';
    const { s, sink, logFile } = start({ sessionId: sid, resume: true });
    await waitFor(() => s.state === 'idle', 'loaded');
    expect(s.sessionId).toBe(sid);
    expect(cursorLog(logFile).find(l => l.method === 'session/load')?.params).toMatchObject({ sessionId: sid });
    expect(cursorLog(logFile).some(l => l.method === 'session/new')).toBe(false);
    expect([...sink.items.values()].some(i => 'text' in i && /vecchia/.test(i.text))).toBe(false);
    s.send('hello');
    await waitFor(() => results(sink).length === 1, 'turn after load');

    const two = start({ sessionId: sid, resume: true, env: { FAKE_CURSOR_NO_LOAD: '1' } });
    await waitFor(() => two.s.state === 'idle', 'new instead');
    expect(two.s.sessionId).not.toBe(sid);
    expect([...two.sink.items.values()].some(i => i.kind === 'system' && /non riprende/.test(i.text))).toBe(true);
  });

  it('model only with --model at spawn (never session/set_model); plan mode via session/set_mode; the chat\'s MCP endpoint', async () => {
    const url = `http://127.0.0.1:4329/mcp/chat/c_cur/${crypto.randomBytes(8).toString('hex')}`;
    const { s, sink, logFile } = start({ model: 'gpt-5.6-sol', permissionMode: 'plan', mcpUrl: url });
    await waitFor(() => s.state === 'idle', 'ready');
    const a = cursorLog(logFile).find(l => l.argv)?.argv ?? [];
    expect(a).toEqual(['--model', 'gpt-5.6-sol', 'acp']);
    expect(sink.patch.model).toBe('gpt-5.6-sol');
    expect(cursorLog(logFile).find(l => l.method === 'session/new')?.params?.mcpServers).toEqual([{ type: 'http', name: 'second-brain', url, headers: [] }]);
    await waitFor(() => sink.patch.permissionMode === 'plan', 'plan mode');
    expect(cursorLog(logFile).find(l => l.method === 'session/set_mode')?.params).toMatchObject({ modeId: 'plan' });
    await expect(s.setModel('claude-sonnet-5.5')).rejects.toThrow(MODEL_RESTART); // the manager reopens the session instead
    await expect(s.setEffort('high')).rejects.toThrow(/effort/i);
  });

  it('runs Cursor with the app\'s own config folder: the user\'s Cursor config is copied, never written', async () => {
    const userDir = tmp('cursor-user');
    const userCfg = JSON.stringify({ model: { modelId: 'user-model' }, hasChangedDefaultModel: false, permissions: { allow: ['Shell(ls)'], deny: [] } });
    fs.writeFileSync(path.join(userDir, 'cli-config.json'), userCfg);
    fs.writeFileSync(path.join(userDir, 'permissions.json'), '{}');
    const own = path.join(tmp('ud'), 'cursor-config');
    const { s, logFile } = start({ model: 'gpt-5.6-sol', configDir: own, env: { CURSOR_CONFIG_DIR: userDir } });
    await waitFor(() => s.state === 'idle', 'ready');
    expect(cursorLog(logFile).find(l => l.argv) as { configDir?: string }).toMatchObject({ configDir: own });
    expect(fs.readFileSync(path.join(userDir, 'cli-config.json'), 'utf8')).toBe(userCfg); // untouched
    expect(JSON.parse(fs.readFileSync(path.join(own, 'cli-config.json'), 'utf8'))).toMatchObject({ model: { modelId: 'gpt-5.6-sol' }, hasChangedDefaultModel: true, permissions: { allow: ['Shell(ls)'] } });
    expect(fs.existsSync(path.join(own, 'permissions.json'))).toBe(true);
    expect(cursorConfigDir({ CURSOR_CONFIG_DIR: userDir })).toBe(userDir);
    expect(cursorConfigDir({ XDG_CONFIG_HOME: path.join(userDir, 'xdg') })).toBe(path.join(userDir, 'xdg', 'cursor'));
  });

  it('tool calls with diffs, plan entries, usage → list-price cost', async () => {
    const { s, sink } = start({ model: 'claude-sonnet-5.5' });
    s.send('edit todo usage');
    await waitFor(() => results(sink).length === 1, 'turn');
    const edit = [...sink.items.values()].find(i => i.kind === 'tool' && i.name === 'Edit');
    expect(edit).toMatchObject({ status: 'ok', summary: 'Edit a.txt' });
    expect(edit?.kind === 'tool' && edit.diff?.[0]).toMatchObject({ path: 'a.txt', added: 2, removed: 1 });
    expect([...sink.items.values()].some(i => i.kind === 'system' && i.text === 'Piano:\n✓ Leggi\n▸ Scrivi')).toBe(true);
    // 1000 in × 2 + 2000 cache read × 0.1 + 500 out × 10, per 1M
    expect(results(sink)[0]).toMatchObject({ costUsd: 0.0072 });
    expect(sink.patch.costKnown).toBe(true);
  });

  it('cursor/update_todos and cursor/task come as requests: shown and acknowledged (never "method not found")', async () => {
    const { s, sink, logFile } = start();
    s.send('extensions');
    await waitFor(() => results(sink).length === 1, 'turn');
    const acks = cursorLog(logFile).filter(l => l.answer?.outcome && 'method' in (l.answer.outcome as object)).map(l => l.answer?.outcome);
    expect(acks).toEqual([{ method: 'cursor/update_todos', result: {} }, { method: 'cursor/task', result: {} }]);
    const texts = [...sink.items.values()].filter(i => i.kind === 'system').map(i => (i as { text: string }).text);
    expect(texts).toContain('Attività:\n✓ Leggi\n▸ Scrivi');
    expect(texts).toContain('Subagente: Esplora il repo');
  });

  it('shows the replayed past of a restored chat when asked (showReplay)', async () => {
    const { s, sink } = start({ sessionId: '1c194f13-0000-4000-8000-000000000002', resume: true, showReplay: true });
    await s.ready;
    expect(s.state).toBe('idle');
    const shown = [...sink.items.values()].map(i => [i.kind, 'text' in i ? i.text : '']);
    expect(shown).toEqual([['user', 'vecchia domanda'], ['assistant', 'vecchia risposta']]);
    expect(sink.last('assistant')?.streaming).toBe(false);
  });

  it('survives junk lines and reports a crash', async () => {
    const { s, sink } = start();
    s.send('garbage then hello');
    await waitFor(() => results(sink).length === 1, 'turn');
    expect(sink.last('assistant')?.text).toBe('Ciao dal motore');
    s.line('{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"tool_call"}}}');
    s.line('{"jsonrpc":"2.0","id":99999,"result":{}}');
    s.line('[1]');
    s.send('crash');
    await waitFor(() => sink.exited, 'exit');
    expect(s.state).toBe('error');
    expect(sink.exited?.error).toContain('fatal: fake cursor crash');
  });
});

describe('cursor prices', () => {
  it('matches Cursor model ids to list prices (read 2026-10-11)', () => {
    expect(priceOf('claude-sonnet-5.5')).toMatchObject({ input: 2, output: 10 });
    expect(priceOf('sonnet-5.5-thinking')).toMatchObject({ input: 2, output: 10 });
    expect(priceOf('gpt-5.6-sol[effort=high]')).toMatchObject({ input: 4, output: 20 });
    expect(priceOf('composer-2.5-fast')).toMatchObject({ input: 3 });
    expect(priceOf('composer-2.5')).toMatchObject({ input: 0.5 });
    expect(priceOf('auto')).toBeNull();
    expect(costOf('claude-opus-5.5', { inputTokens: 1e6, outputTokens: 1e6 })).toBe(24);
    expect(costOf('auto', { inputTokens: 10 })).toBeNull();
    expect(costOf('claude-opus-5.5', {})).toBeNull();
  });
});
