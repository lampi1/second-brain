// AcpSession against the fake ACP agent (test/fixtures/fake-cursor-acp.mjs), run as Cursor: engine resolution and the
// test guard, streaming, permissions (allow once / always / reject, no "always"), cursor/ask_question (free text as the
// skip reason), cursor/create_plan, cancel, queued prompts, login missing, resume with session/load, model and mode, MCP,
// diffs, usage → cost. Then the same fake run as another ACP engine (Kimi): its own harness, argv, texts, and none of
// Cursor's options unless given (ADR 0046). No real engine ever runs here.
import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cliArgv, engineAllowed, newestCursorVersion, resolveAcp, resolveCursor } from '../../../src/main/chats/cli';
import { AcpSession, authHelp, cursorConfigDir, isNetError, modelRestart, netRetryPrompt, type AcpOptions } from '../../../src/main/chats/acp';
import { costOf, priceOf } from '../../../src/main/chats/cursor-prices';
import { engineStatus, openLogin } from '../../../src/main/cli';
import { FAKE_CURSOR, PNG_1PX, cursorLog, recSink, tmp, waitFor, type RecSink } from './helpers';

/** The Cursor entry's options, as engines/sessions.ts passes them. */
const CURSOR = {
  engineId: 'cursor', label: 'Cursor', args: ['acp'], modelFlag: '--model', acpCommand: 'agent', loginCommand: 'agent login',
  subagentHooks: true, priceFallback: true,
} satisfies Partial<AcpOptions>;
/** Another ACP engine: only its identity and start shape, none of Cursor's options. */
const KIMI = { engineId: 'kimi', label: 'Kimi', args: ['acp'], acpCommand: 'kimi' } satisfies Partial<AcpOptions>;

const open: AcpSession[] = [];
const logs: string[] = [];
function start(extra: Partial<AcpOptions> = {}): { s: AcpSession; sink: RecSink; cwd: string; logFile: string } {
  const cwd = tmp('cwd');
  const logFile = path.join(tmp('log'), 'cursor.jsonl');
  logs.push(logFile);
  const sink = recSink();
  // the fake writes --model into CURSOR_CONFIG_DIR like the real CLI: always a temp folder here
  const s = new AcpSession({ ...CURSOR, chatId: 'c_cur', cwd, pathOverride: FAKE_CURSOR, ...extra, env: { FAKE_CURSOR_LOG: logFile, CURSOR_CONFIG_DIR: tmp('cursor-cfg'), ...extra.env } }, sink);
  open.push(s);
  s.start();
  return { s, sink, cwd, logFile };
}
/** The fake as the Kimi engine: no CURSOR_CONFIG_DIR in its env from the test either. */
function startKimi(extra: Partial<AcpOptions> = {}): { s: AcpSession; sink: RecSink; cwd: string; logFile: string } {
  const cwd = tmp('cwd');
  const logFile = path.join(tmp('log'), 'kimi.jsonl');
  logs.push(logFile);
  const sink = recSink();
  const s = new AcpSession({ ...KIMI, chatId: 'c_kimi', cwd, pathOverride: FAKE_CURSOR, ...extra, env: { FAKE_CURSOR_LOG: logFile, ...extra.env } }, sink);
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

describe('authHelp', () => {
  it('names the login command, or the key in Settings when the engine has none', () => {
    expect(authHelp('Kimi', 'kimi login')).toContain('`kimi login`');
    expect(authHelp('Kimi', null)).toContain('Impostazioni → Motori');
  });
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
    const c = resolveCursor(null, { LOCALAPPDATA: local }, 'win32');
    expect(c).toMatchObject({ kind: 'node', command: path.join(v, '2026.07.23-10-11-12-abc123', 'node.exe'), prefix: [path.join(v, '2026.07.23-10-11-12-abc123', 'index.js')] });
    expect(c?.env).toMatchObject({ CURSOR_INVOKED_AS: 'agent.cmd', NODE_COMPILE_CACHE: path.join(local, 'cursor-compile-cache') });
    expect(cliArgv(c!, ['--model', 'gpt-5', 'acp']).args).toEqual([path.join(v, '2026.07.23-10-11-12-abc123', 'index.js'), '--model', 'gpt-5', 'acp']);
  });

  it('macOS and Linux: the newest version under ~/.local/share/cursor-agent with its own node (ADR 0054)', () => {
    const home = tmp('home');
    const v = path.join(home, '.local', 'share', 'cursor-agent', 'versions', '2026.07.23-e383d2b');
    fs.mkdirSync(v, { recursive: true });
    for (const f of ['node', 'index.js']) fs.writeFileSync(path.join(v, f), '');
    const c = resolveCursor(null, {}, 'linux', home);
    expect(c).toMatchObject({ kind: 'node', command: path.join(v, 'node'), prefix: [path.join(v, 'index.js')] });
    expect(c?.env).toMatchObject({ CURSOR_INVOKED_AS: 'cursor-agent' });
  });

  it('falls back to agent.cmd through cmd.exe with safe arguments only', () => {
    const c = resolveCursor('C:\\Tools\\agent.cmd', {});
    expect(c?.kind).toBe('cmd');
    expect(cliArgv(c!, ['--model', 'claude-opus-4-8[effort=high]', 'acp'])).toMatchObject({ verbatim: true, args: ['/d', '/s', '/c', '""C:\\Tools\\agent.cmd" --model claude-opus-4-8[effort=high] acp"'] });
    expect(() => cliArgv(c!, ['--model', 'x & calc', 'acp'])).toThrow(/non sicuro/);
  });

  it('never starts the real Cursor engine under tests', async () => {
    const real = { kind: 'node' as const, command: 'C:\\x\\node.exe', prefix: ['C:\\x\\index.js'], env: {}, verbatim: false, display: 'C:\\x' };
    expect(engineAllowed(real, { VITEST: 'true' })).toBe(false);
    expect(engineAllowed(real, { SB_TEST: '1' })).toBe(false);
    expect(engineAllowed(real, {})).toBe(true);
    expect(engineAllowed(resolveCursor(FAKE_CURSOR, {})!, { SB_TEST: '1' })).toBe(true);
    // a script that is not a .mjs fake, or that lives in Cursor's install, is the real engine run as a script
    expect(engineAllowed(resolveCursor('C:\\x\\cursor-agent\\versions\\v\\index.js', {})!, { SB_TEST: '1' })).toBe(false);
    expect(engineAllowed(resolveCursor('C:\\x\\cursor-agent\\versions\\v\\evil.mjs', {})!, { VITEST: 'true' })).toBe(false);
    expect(engineAllowed(resolveCursor('C:\\x\\other.cjs', {})!, { VITEST: 'true' })).toBe(false);
    const sink = recSink();
    const s = new AcpSession({ ...CURSOR, chatId: 'c', cwd: tmp('cwd') }, sink, real);
    s.start();
    expect(s.state).toBe('error');
    expect(s.pid).toBeNull(); // nothing spawned
    expect(sink.exited?.error).toMatch(/Nei test il motore Cursor reale non parte mai/);
  });

  it('status and login never run the real Cursor CLI under tests', async () => {
    const prev = process.env.SB_CURSOR_PATH;
    delete process.env.SB_CURSOR_PATH;
    try {
      const st = await engineStatus('cursor'); // resolves the installed CLI if any, but does not run it
      expect(st.version).toBeNull();
      expect(() => openLogin('cursor')).toThrow(/Nei test/);
    } finally { if (prev !== undefined) process.env.SB_CURSOR_PATH = prev; }
  });
});

describe('AcpSession as Cursor', () => {
  it('streams thought and text, ends the turn, reports no cost (ACP gives no usage)', async () => {
    const { s, sink, logFile } = start();
    await waitFor(() => s.state === 'idle', 'session ready');
    expect(s.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(sink.patch.model).toBe('auto[context=256k,reasoning_effort=high,fast=true]');
    // the CLI's own model list goes to the owner (→ the Settings page's Cursor models)
    expect(sink.modelLists.at(-1)?.map(m => m.id)).toEqual(['auto', 'gpt-5.6-sol', 'claude-sonnet-5.5']);
    expect(sink.modelLists.at(-1)?.[1]).toEqual({ id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' });
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

    // "Altro…": ACP's answered outcome has room only for option ids, so the free text goes back as the skip reason
    s.send('ask three');
    const q3 = await waitFor(() => sink.pendings[2], 'questions 3');
    s.answer(q3.id, { kind: 'question', answers: { 'Che colore?': 'verde acqua', 'Quali file?': ['a.ts'] } });
    await waitFor(() => results(sink).length === 3, 'turn 3');
    expect(answerOf(logFile)).toEqual({ outcome: 'skipped', reason: 'L’utente ha risposto con parole sue invece di scegliere solo le opzioni: «Che colore?» → verde acqua; «Quali file?» → a.ts' });
  });

  it('a message streamed right before a question is finished when the question opens (its commands show on the Regia card)', async () => {
    const { s, sink } = start();
    s.send('ask cmd');
    await waitFor(() => sink.pendings[0], 'question');
    expect(sink.last('assistant')).toMatchObject({ text: 'Lancia:\n```powershell\nGet-Date\n```\n' });
    expect(sink.last('assistant')?.streaming).toBeFalsy();
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
    s.send('plan c');
    const q3 = await waitFor(() => sink.pendings[2], 'plan 3');
    s.answer(q3.id, { kind: 'question', answers: { 'Approvi il piano?': 'prima il punto 2' } });
    await waitFor(() => results(sink).length === 3, 'turn 3');
    expect(answerOf(logFile)).toEqual({ outcome: 'rejected', reason: 'L’utente non approva il piano così com’è e ha scritto: «prima il punto 2»' });
  });

  it('stop: session/cancel, open panels answered "cancelled", queued messages dropped', async () => {
    const { s, sink, logFile } = start();
    s.send('perm');
    const p = await waitFor(() => sink.pendings[0], 'permission');
    s.send('queued one');
    await s.interrupt({ byUser: true });
    expect(sink.resolvedIds).toContain(p.id);
    await waitFor(() => results(sink).length === 1 && s.state === 'idle', 'cancelled turn');
    // the user's own stop is no error (12/10: "quando faccio Invia subito vedo sempre un errore")
    expect(results(sink)[0]).toMatchObject({ isError: false, interrupted: true });
    expect([...sink.items.values()].some(i => i.kind === 'system' && i.code === 'stoppedByYou')).toBe(true);
    expect(answerOf(logFile)).toEqual({ outcome: 'cancelled' });
    expect(cursorLog(logFile).some(l => l.method === 'session/cancel')).toBe(true);
    expect([...sink.items.values()].some(i => i.kind === 'system' && i.code === 'queueCancelled' && i.params?.n === 1)).toBe(true);
    await new Promise(r => setTimeout(r, 200));
    expect(results(sink)).toHaveLength(1); // the queued message never ran

    s.send('slow');
    await waitFor(() => sink.last('assistant')?.text.includes('tick'), 'streaming');
    await s.interrupt();
    await waitFor(() => results(sink).length === 2 && s.state === 'idle', 'cancelled stream');
    expect(sink.last('assistant')?.streaming).toBe(false);
  });

  it('sends pasted images as ACP image blocks when the agent takes them', async () => {
    const { s, sink, logFile } = start();
    s.send('cosa vedi?', [{ mimeType: 'image/png', data: PNG_1PX }]);
    await waitFor(() => results(sink).length === 1, 'turn');
    const prompt = cursorLog(logFile).find(l => l.method === 'session/prompt')?.params?.prompt;
    expect(prompt).toEqual([{ type: 'image', mimeType: 'image/png', data: PNG_1PX }, { type: 'text', text: 'cosa vedi?' }]);
  });

  it('without image support the images are saved as files and their paths go in the text', async () => {
    const { s, sink, logFile } = start({ env: { FAKE_CURSOR_NO_IMAGE: '1' } });
    s.send('', [{ mimeType: 'image/png', data: PNG_1PX }]);
    await waitFor(() => results(sink).length === 1, 'turn');
    const prompt = cursorLog(logFile).find(l => l.method === 'session/prompt')?.params?.prompt as { type: string; text: string }[];
    expect(prompt).toHaveLength(1);
    expect(prompt[0]?.type).toBe('text');
    const file = /^- (.+\.png)$/m.exec(prompt[0]?.text ?? '')?.[1] ?? '';
    expect(prompt[0]?.text).toMatch(/^Immagini allegate/);
    expect(file).toContain('second-brain-images');
    // the turn is over: the screenshot (maybe private) does not stay in the temp folder
    await waitFor(() => !fs.existsSync(file) || undefined, 'temp file deleted');
  });

  // "Invia subito" (renderer store.sendQueuedNow): session/cancel, the chat reports idle, then the message is sent
  it('send now: after a cancel mid-turn the chat goes idle and the next message runs once, as a normal turn', async () => {
    const { s, sink, logFile } = start({ env: { FAKE_CURSOR_DELAY: '30' } });
    s.send('slow');
    await waitFor(() => sink.last('assistant')?.text.includes('tick'), 'streaming');
    await s.interrupt({ byUser: true });
    await waitFor(() => results(sink).length === 1 && s.state === 'idle', 'cancelled turn');
    s.send('subito');
    await waitFor(() => results(sink).length === 2 && s.state === 'idle', 'the second turn');
    expect(results(sink).map(r => r.kind === 'result' && [r.isError, !!r.interrupted])).toEqual([[false, true], [false, false]]);
    expect(cursorLog(logFile).filter(l => l.method === 'session/prompt')).toHaveLength(2); // each message prompted once
  });

  // "Invia subito" stops only the turn: a message the session already queued (an agent's app_send_to_chat) is not
  // cancelled with it, it runs next; a plain Stop still drops it
  it('send now keeps the session queue: the cancel ends the turn, the queued message still runs', async () => {
    const { s, sink, logFile } = start({ env: { FAKE_CURSOR_DELAY: '30' } });
    s.send('slow');
    s.send('dopo');
    await waitFor(() => sink.last('assistant')?.text.includes('tick'), 'streaming');
    await s.interrupt({ keepQueued: true, byUser: true });
    await waitFor(() => results(sink).length === 2 && s.state === 'idle', 'the queued turn');
    expect(results(sink).map(r => r.kind === 'result' && [r.isError, !!r.interrupted])).toEqual([[false, true], [false, false]]);
    expect([...sink.items.values()].some(i => i.kind === 'system' && i.code === 'stoppedByYouResend')).toBe(true);
    const prompts = cursorLog(logFile).filter(l => l.method === 'session/prompt').map(l => JSON.stringify(l.params?.prompt));
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('dopo');
    expect([...sink.items.values()].some(i => i.kind === 'system' && i.code === 'queueCancelled')).toBe(false);
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

  it('tells Cursor\'s network errors from the model\'s words', () => {
    // what the CLI appends: "\n\nError: " + String(error)
    expect(isNetError('\n\nError: RetriableError: [aborted] read ECONNRESET')).toBe(true);
    expect(isNetError('Sto lavorando\n\nError: RetriableError: [aborted] read ECONNRESET\n')).toBe(true);
    expect(isNetError('Leggo.\n\nError: RetriableError: [unavailable] PING timed out')).toBe(true);
    expect(isNetError('Leggo.\n\nError: RetriableError: [unavailable]')).toBe(true);
    expect(isNetError('Leggo.\n\nError: RetriableError: Stream ended without turnEnded — connection likely dropped mid-stream')).toBe(true);
    expect(isNetError('Leggo.\n\nError: [unavailable] PING timed out')).toBe(true);
    // the model quoting the error is not one
    expect(isNetError('Nei log c\'è Error: RetriableError: [aborted] read ECONNRESET')).toBe(false);
    expect(isNetError('Ecco il log:\nError: RetriableError: [aborted] read ECONNRESET')).toBe(false);
    expect(isNetError('Riga dal log:\n\n[unavailable] PING timed out')).toBe(false);
    expect(isNetError('\n\nError: RetriableError: x\nquindi ho corretto il retry.')).toBe(false);
    expect(isNetError('\n\nError: NonRetriableError: bad request')).toBe(false);
    expect(isNetError('\n\nError: [unauthenticated] Backend rejected authentication')).toBe(false);
    expect(isNetError('')).toBe(false);
  });

  it('a network error at the end of a turn: "continua" goes by itself, with a visible line, and the chat stays running', async () => {
    const { s, sink, logFile } = start({ netRetryDelaysMs: [30, 60] });
    await waitFor(() => s.state === 'idle', 'ready');
    s.send('neterr please');
    await waitFor(() => results(sink).length === 2 && s.state === 'idle', 'turn + automatic retry');
    const prompts = cursorLog(logFile).filter(l => l.method === 'session/prompt').map(l => (l.params?.prompt as { text: string }[])[0]?.text);
    expect(prompts).toEqual(['neterr please', netRetryPrompt('Cursor')]);
    expect(results(sink).map(r => r.isError)).toEqual([true, false]);
    expect(sink.last('assistant')?.text).toBe('Ripreso dopo la rete');
    const sys = [...sink.items.values()].filter(i => i.kind === 'system').map(i => i.code);
    expect(sys).toEqual(['netRetried']);
    // no idle between the cut turn and its retry: the Orchestrator does not see the chat as done
    const first = sink.trace.indexOf('result'), second = sink.trace.lastIndexOf('result');
    expect(sink.trace.slice(first, second)).not.toContain('state:idle');
  });

  it('two retries at most per message, then a clear warning; a new message gets its own retries', async () => {
    const { s, sink, logFile } = start({ netRetryDelaysMs: [20, 40], env: { FAKE_CURSOR_NETERR: '4', FAKE_CURSOR_NETERR_TEXT: 'RetriableError: [unavailable] PING timed out' } });
    await waitFor(() => s.state === 'idle', 'ready');
    s.send('neterr');
    await waitFor(() => results(sink).length === 3 && s.state === 'idle', 'turn + two retries');
    const sys = () => [...sink.items.values()].filter(i => i.kind === 'system');
    expect(sys().at(-1)).toMatchObject({ level: 'error', code: 'netRetriesExhausted', params: { n: 2 } });
    expect(results(sink).every(r => r.isError)).toBe(true);
    s.send('neterr again');
    await waitFor(() => results(sink).length === 5 && s.state === 'idle', 'new message, one retry');
    expect(sink.last('assistant')?.text).toBe('Ripreso dopo la rete');
    expect(cursorLog(logFile).filter(l => l.method === 'session/prompt')).toHaveLength(5);
  });

  it('stop during the wait drops the retry', async () => {
    const { s, sink, logFile } = start({ netRetryDelaysMs: [400, 400] });
    await waitFor(() => s.state === 'idle', 'ready');
    s.send('neterr');
    await waitFor(() => results(sink).length === 1, 'cut turn');
    expect(s.state).toBe('running');
    expect(s.busy).toBe(true);
    await s.interrupt();
    expect(s.state).toBe('idle');
    expect(s.busy).toBe(false);
    expect([...sink.items.values()].filter(i => i.kind === 'system').at(-1)).toMatchObject({ code: 'netRetryCancelledStopped' });
    await new Promise(r => setTimeout(r, 600));
    expect(cursorLog(logFile).filter(l => l.method === 'session/prompt')).toHaveLength(1);

    s.send('neterr two'); // the fake's one failure (FAKE_CURSOR_NETERR default) is used up: this turn answers
    await waitFor(() => results(sink).length === 2 && s.state === 'idle', 'second turn');
    expect(sink.last('assistant')?.text).toBe('Ripreso dopo la rete');
  });

  it('noRetry: a turn cut by a network error is not retried (a failed hand-off), even when the retry is already planned', async () => {
    const { s, sink, logFile } = start({ netRetryDelaysMs: [300, 300] });
    await waitFor(() => s.state === 'idle', 'ready');
    s.send('neterr');
    await waitFor(() => results(sink).length === 1, 'cut turn');
    expect(s.busy).toBe(true);
    s.noRetry();
    expect(s.state).toBe('idle');
    expect(s.busy).toBe(false);
    await new Promise(r => setTimeout(r, 500));
    expect(cursorLog(logFile).filter(l => l.method === 'session/prompt')).toHaveLength(1);
    expect([...sink.items.values()].filter(i => i.kind === 'system').at(-1)).toMatchObject({ code: 'netRetryCancelledHandoff' });
  });

  it('a message sent while the retry waits goes after it', async () => {
    const { s, sink, logFile } = start({ netRetryDelaysMs: [200, 200] });
    await waitFor(() => s.state === 'idle', 'ready');
    s.send('neterr');
    await waitFor(() => results(sink).length === 1, 'cut turn');
    s.send('hello');
    await waitFor(() => results(sink).length === 3 && s.state === 'idle', 'retry, then the message');
    const prompts = cursorLog(logFile).filter(l => l.method === 'session/prompt').map(l => (l.params?.prompt as { text: string }[])[0]?.text);
    expect(prompts).toEqual(['neterr', netRetryPrompt('Cursor'), 'hello']);
  });

  it('"Invia subito" while the retry waits sends the kept message now, without the retry', async () => {
    const { s, sink, logFile } = start({ netRetryDelaysMs: [400, 400] });
    await waitFor(() => s.state === 'idle', 'ready');
    s.send('neterr');
    await waitFor(() => results(sink).length === 1, 'cut turn');
    s.send('hello');
    await s.interrupt({ keepQueued: true, byUser: true });
    await waitFor(() => results(sink).length === 2 && s.state === 'idle', 'the kept message ran');
    await new Promise(r => setTimeout(r, 600));
    const prompts = cursorLog(logFile).filter(l => l.method === 'session/prompt').map(l => (l.params?.prompt as { text: string }[])[0]?.text);
    expect(prompts).toEqual(['neterr', 'hello']);
  });

  it('not logged in: "Accedi a Cursor", the process is stopped, authenticate is never called', async () => {
    const { s, sink, logFile } = start({ env: { FAKE_CURSOR_NO_AUTH: '1' } });
    await waitFor(() => sink.exited, 'stopped');
    expect(s.state).toBe('error');
    expect(sink.exited?.error).toBe(authHelp('Cursor', CURSOR.loginCommand!));
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
    expect([...two.sink.items.values()].some(i => i.kind === 'system' && i.code === 'noResume')).toBe(true);
  });

  it('model only with --model at spawn (never session/set_model); plan mode via session/set_mode; the chat\'s MCP endpoint', async () => {
    const url = `http://127.0.0.1:4329/mcp/chat/c_cur/${crypto.randomBytes(8).toString('hex')}`;
    const { s, sink, logFile } = start({ model: 'gpt-5.6-sol', permissionMode: 'plan', mcpUrl: url });
    await waitFor(() => s.state === 'idle', 'ready');
    const a = cursorLog(logFile).find(l => l.argv)?.argv ?? [];
    expect(a).toEqual(['--model', 'gpt-5.6-sol', 'acp']);
    expect(sink.patch.model).toBe('gpt-5.6-sol[context=256k,reasoning_effort=high,fast=true]'); // no settings: the CLI's own variant
    expect(cursorLog(logFile).some(l => l.method === 'session/set_config_option')).toBe(false);
    expect(cursorLog(logFile).find(l => l.method === 'session/new')?.params?.mcpServers).toEqual([{ type: 'http', name: 'second-brain', url, headers: [] }]);
    await waitFor(() => sink.patch.permissionMode === 'plan', 'plan mode');
    expect(cursorLog(logFile).find(l => l.method === 'session/set_mode')?.params).toMatchObject({ modeId: 'plan' });
    await expect(s.setModel('claude-sonnet-5.5')).rejects.toThrow(modelRestart('Cursor')); // the manager reopens the session instead
    await expect(s.setEffort('high')).rejects.toThrow(/effort/i);
  });

  it('an agent capped at plan takes the read-only mode whatever the chosen mode (A2)', async () => {
    const { s, sink, logFile } = start({ permissionMode: 'acceptEdits', ceiling: 'plan' });
    await waitFor(() => s.state === 'idle', 'ready');
    const set = cursorLog(logFile).filter(l => l.method === 'session/set_mode').map(l => l.params?.modeId);
    expect(set).toHaveLength(1);
    expect(['ask', 'plan']).toContain(set[0]);
    // Cursor's read-only "ask" shows as plan here, so the manager's ceiling guard does not fire on it
    await waitFor(() => sink.patch.permissionMode === 'plan', 'shown as plan');
  });

  it('applies the user\'s reasoning and fast with session/set_config_option and shows the variant really running', async () => {
    const { s, sink, logFile } = start({ model: 'gpt-5.6-sol', modelConfig: { reasoning: 'medium', fast: false } });
    await waitFor(() => s.state === 'idle', 'ready');
    const log = cursorLog(logFile);
    // the CLI offers the model parameters only to a client that says it has a parameterized picker
    expect((log.find(l => l.method === 'initialize')?.params?.clientCapabilities as { _meta?: unknown } | undefined)?._meta).toEqual({ parameterizedModelPicker: true });
    expect(log.filter(l => l.method === 'session/set_config_option').map(l => [l.params?.configId, l.params?.value])).toEqual([['reasoning_effort', 'medium'], ['fast', 'false']]);
    expect(sink.patch.model).toBe('gpt-5.6-sol[context=256k,reasoning_effort=medium,fast=false]');
    expect([...sink.items.values()].some(i => i.kind === 'system' && i.level === 'warn')).toBe(false);
  });

  it('a value the model does not offer is a visible warning with the variant that runs', async () => {
    const { s, sink, logFile } = start({ model: 'gpt-5.6-sol', modelConfig: { reasoning: 'medium', fast: false }, env: { FAKE_CURSOR_NO_MEDIUM: '1' } });
    await waitFor(() => s.state === 'idle', 'ready');
    expect(cursorLog(logFile).filter(l => l.method === 'session/set_config_option').map(l => l.params?.configId)).toEqual(['fast']);
    expect(sink.patch.model).toBe('gpt-5.6-sol[context=256k,reasoning_effort=high,fast=false]');
    const warn = [...sink.items.values()].find(i => i.kind === 'system' && i.level === 'warn');
    expect(warn).toMatchObject({ code: 'runningOther', params: { variant: 'gpt-5.6-sol[context=256k,reasoning_effort=high,fast=false]' } });
  });

  it('a parameter pinned in the chat\'s model id wins over the settings', async () => {
    const { s, logFile } = start({ model: 'gpt-5.6-sol[reasoning_effort=high]', modelConfig: { reasoning: 'medium', fast: false } });
    await waitFor(() => s.state === 'idle', 'ready');
    expect(cursorLog(logFile).filter(l => l.method === 'session/set_config_option').map(l => l.params?.configId)).toEqual(['fast']);
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
    expect([...sink.items.values()].some(i => i.kind === 'system' && i.code === 'plan' && i.params?.list === '✓ Leggi\n▸ Scrivi')).toBe(true);
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
    const items = [...sink.items.values()].filter(i => i.kind === 'system');
    expect(items.some(i => i.code === 'todos' && i.params?.list === '✓ Leggi\n▸ Scrivi')).toBe(true);
    expect(items.some(i => i.code === 'subagent' && i.params?.description === 'Esplora il repo')).toBe(true);
  });

  it('runs the subagentStart/subagentStop hooks of hooks.json for a Task (ACP never fires them)', async () => {
    const dir = tmp('hooks');
    const out = path.join(dir, 'got.jsonl');
    const script = path.join(dir, 'hook.mjs');
    fs.writeFileSync(script, `import fs from 'node:fs';\nlet r = '';\nprocess.stdin.on('data', d => (r += d)).on('end', () => fs.appendFileSync(${JSON.stringify(out)}, r + '\\n'));\n`);
    const cmd = `node "${script}"`;
    const hooksFile = path.join(dir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify({ version: 1, hooks: { subagentStart: [{ command: cmd, timeout: 20 }], subagentStop: [{ command: cmd, timeout: 20 }], beforeShellExecution: [{ command: cmd }] } }));
    const { s, sink, cwd } = start({ hooksFile });
    s.send('subagent');
    await waitFor(() => results(sink).length === 1, 'turn');
    await waitFor(() => s.hookRuns.length === 2, 'hooks started');
    await Promise.all(s.hookRuns);
    const got = fs.readFileSync(out, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    expect(got).toHaveLength(2);
    const st = got.find(g => g.hook_event_name === 'subagentStart');
    const sp = got.find(g => g.hook_event_name === 'subagentStop');
    expect(st).toMatchObject({ hook_event_name: 'subagentStart', subagent_type: 'reviewer', task: 'rivedi HEAD di repo X', tool_call_id: 'tc_sub', workspace_roots: [cwd] });
    expect(sp).toMatchObject({ hook_event_name: 'subagentStop', subagent_type: 'reviewer', task: 'rivedi HEAD di repo X', status: 'completed', duration_ms: 1234, subagent_model: 'grok-4.7' });
    expect(st.conversation_id).toBe(s.sessionId);
  });

  it('runs no subagent hook under tests unless a hooks file is given', async () => {
    const { s, sink } = start();
    s.send('subagent');
    await waitFor(() => results(sink).length === 1, 'turn');
    expect(s.hookRuns).toHaveLength(0);
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

  it('takes a live and a turn cost from ACP usage_update.cost when Cursor sends it', async () => {
    const { s, sink } = start({ model: 'auto' });
    s.send('acpcost');
    await waitFor(() => results(sink).length === 1, 'turn');
    const lives = sink.patches.flatMap(p => (p.liveCostUsd !== undefined ? [p.liveCostUsd] : []));
    expect(lives).toEqual([0.12, 0.2, 0]);
    expect(results(sink)[0]).toMatchObject({ costUsd: 0.2 });
    expect(sink.patch.costKnown).toBe(true);
    // the next turn counts only its own growth
    s.send('acpcost');
    await waitFor(() => results(sink).length === 2, 'second turn');
    expect(results(sink)[1]).toMatchObject({ costUsd: 0 });
  });
});

// ADR 0046: the same adapter runs any ACP CLI; here the fake plays Kimi (`kimi acp`, no model flag)
describe('AcpSession as another ACP engine (Kimi)', () => {
  it('resolves its own command: SB_KIMI_PATH or the given override, a .cmd shim through cmd.exe, refused under tests unless a .mjs fake', () => {
    expect(resolveAcp('kimi', 'kimi', null, { SB_KIMI_PATH: FAKE_CURSOR })).toMatchObject({ kind: 'fake', prefix: [FAKE_CURSOR] });
    expect(resolveAcp('kimi', 'kimi', 'C:\\Tools\\kimi.cmd', {})).toMatchObject({ kind: 'cmd', display: 'C:\\Tools\\kimi.cmd' });
    const exe = resolveAcp('kimi', 'kimi', 'C:\\Tools\\kimi.exe', {});
    expect(exe).toMatchObject({ kind: 'exe', command: 'C:\\Tools\\kimi.exe' });
    expect(cliArgv(exe!, ['acp']).args).toEqual(['acp']);
    expect(engineAllowed(exe!, { VITEST: 'true' })).toBe(false);
    expect(engineAllowed(exe!, { SB_TEST: '1' })).toBe(false);
    expect(engineAllowed(resolveAcp('kimi', 'kimi', 'C:\\x\\kimi.cjs', {})!, { VITEST: 'true' })).toBe(false);
    expect(engineAllowed(resolveAcp('kimi', 'kimi', FAKE_CURSOR, {})!, { VITEST: 'true' })).toBe(true);
    expect(engineAllowed(exe!, {})).toBe(true);
    // the session refuses the real one before spawning anything, in the engine's own words
    const sink = recSink();
    const s = new AcpSession({ ...KIMI, chatId: 'c', cwd: tmp('cwd') }, sink, exe);
    s.start();
    expect(s.pid).toBeNull();
    expect(sink.exited?.error).toMatch(/^Nei test il motore Kimi reale non parte mai: serve il fake \(SB_KIMI_PATH=/);
  });

  it('a CLI that is not installed: the message names the engine and its command', () => {
    const sink = recSink();
    const s = new AcpSession({ ...KIMI, acpCommand: 'kimi-not-installed-0046', chatId: 'c', cwd: tmp('cwd') }, sink);
    s.start();
    expect(s.state).toBe('error');
    expect(sink.exited?.error).toBe('Kimi CLI non trovato: installa la CLI di Kimi (kimi-not-installed-0046) e fai login.');
  });

  it('runs as harness kimi with `acp` alone (no --model), none of Cursor\'s options, and its own name in what the user reads', async () => {
    const hooksFile = path.join(tmp('hooks'), 'hooks.json'); // given, but without subagentHooks no hook runs
    const { s, sink, logFile } = startKimi({ model: 'claude-sonnet-5.5', hooksFile });
    expect(s.harness).toBe('kimi');
    expect(s.args()).toEqual(['acp']);
    await waitFor(() => s.state === 'idle', 'ready');
    const first = cursorLog(logFile).find(l => l.argv) as { argv?: string[]; configDir?: string | null } | undefined;
    expect(first?.argv).toEqual(['acp']);
    expect(first?.configDir).toBe(process.env.CURSOR_CONFIG_DIR ?? null); // the session set no CURSOR_CONFIG_DIR
    expect(cursorLog(logFile).some(l => l.method === 'session/set_config_option')).toBe(false); // no modelConfig
    // the model was not asked on the command line: what runs is no "other model than asked"
    expect([...sink.items.values()].some(i => i.kind === 'system' && i.level === 'warn')).toBe(false);
    s.send('subagent');
    await waitFor(() => results(sink).length === 1, 'subagent turn');
    expect(s.hookRuns).toHaveLength(0);
    await expect(s.setModel('x')).rejects.toThrow(modelRestart('Kimi'));
    await expect(s.setEffort('high')).rejects.toThrow('L’effort non si imposta con Kimi');
  });

  it('usage tokens are priced with Cursor\'s list only with priceFallback', async () => {
    // a model the list prices (the Cursor-shaped start, so the fake runs it), but without the option
    const { sink } = start({ model: 'claude-sonnet-5.5', priceFallback: false });
    const s = open.at(-1)!;
    s.send('edit todo usage');
    await waitFor(() => results(sink).length === 1, 'usage turn');
    expect(results(sink)[0]).toMatchObject({ costUsd: 0 });
    expect(sink.patch.costKnown).toBe(false);
  });

  it('a network error: the retry lines and the resume prompt name Kimi', async () => {
    const { s, sink, logFile } = startKimi({ netRetryDelaysMs: [30, 60] });
    await waitFor(() => s.state === 'idle', 'ready');
    s.send('neterr please');
    await waitFor(() => results(sink).length === 2 && s.state === 'idle', 'turn + automatic retry');
    const prompts = cursorLog(logFile).filter(l => l.method === 'session/prompt').map(l => (l.params?.prompt as { text: string }[])[0]?.text);
    expect(prompts).toEqual(['neterr please', netRetryPrompt('Kimi')]);
    expect([...sink.items.values()].filter(i => i.kind === 'system').map(i => (i as { code?: string }).code)).toEqual(['netRetried']);
  });

  it('not logged in: "Accedi a Kimi" with its own login command', async () => {
    const { s, sink } = startKimi({ env: { FAKE_CURSOR_NO_AUTH: '1' } });
    await waitFor(() => sink.exited, 'stopped');
    expect(s.state).toBe('error');
    expect(sink.exited?.error).toBe(authHelp('Kimi', 'kimi login'));
    expect(sink.exited?.error).toBe('Accedi a Kimi: premi “Accedi a Kimi” (apre `kimi login` in un terminale), completa il login e riprova.');
  });
});
