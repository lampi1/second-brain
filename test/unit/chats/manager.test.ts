// ChatManager (the app's ChatService) against the fake CLI: events, questions, persistence and restore,
// resume on send with history, forks of external sessions, settings, close, crash recovery.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ChatManager, type ChatManagerOptions, type TurnEndInfo } from '../../../src/main/chats/manager';
import { FAKE, FAKE_CURSOR, alive, cursorLog, fakeLog, recEmitter, tmp, waitFor, type RecEmitter } from './helpers';

interface Env { userData: string; home: string; cwd: string; argLog: string }
const managers: ChatManager[] = [];
function env(): Env {
  const e = { userData: tmp('ud'), home: tmp('home'), cwd: tmp('cwd'), argLog: '' };
  e.argLog = path.join(e.userData, 'argv.jsonl');
  return e;
}
function manager(e: Env, extra: Partial<ChatManagerOptions> = {}): { m: ChatManager; em: RecEmitter } {
  const em = recEmitter();
  const m = new ChatManager({ emitter: em, userData: e.userData, claudePath: FAKE, claudeHome: e.home, env: { CLAUDE_CONFIG_DIR: e.home, FAKE_CLAUDE_LOG: e.argLog }, ...extra });
  managers.push(m);
  return { m, em };
}
const argvs = (e: Env): string[][] => fakeLog(e.argLog).flatMap(l => (l.argv ? [l.argv] : []));
const results = (m: ChatManager, id: string) => m.items(id).filter(i => i.kind === 'result');

afterEach(async () => { await Promise.all(managers.splice(0).map(m => m.shutdown())); });

describe('ChatManager', () => {
  it('creates a chat, streams a turn and emits contract events', async () => {
    const e = env();
    const { m, em } = manager(e);
    const c = await m.create({ harness: 'claude', cwd: e.cwd, prompt: 'hello there', model: 'sonnet', effort: 'high' });
    expect(c).toMatchObject({ origin: 'app', harness: 'claude', title: 'hello there', model: 'sonnet', permissionMode: null, isRegia: false });
    await waitFor(() => results(m, c.id).length === 1, 'first result');
    const items = m.items(c.id);
    expect(items[0]).toMatchObject({ kind: 'user', text: 'hello there' });
    expect(items.some(i => i.kind === 'assistant' && i.text === 'Ciao dal motore' && !i.streaming)).toBe(true);
    const ev = em.of('chat:item');
    expect(ev.some(x => x.replace === true && x.item.kind === 'assistant')).toBe(true);
    const s = await waitFor(() => m.list().find(x => x.id === c.id && x.state === 'idle' && x.contextTokens === 1234), 'idle summary');
    expect(s).toMatchObject({ costUsd: 0.01, lastText: 'Ciao dal motore', model: 'sonnet', contextMaxTokens: 200000 });
    expect(em.of('chat:updated').length).toBeGreaterThan(2);
    const a = argvs(e)[0] ?? [];
    expect(a.join(' ')).toContain(`--session-id=${c.sessionId}`);
    expect(a.join(' ')).toContain('--model sonnet');
    expect(a.join(' ')).toContain('--effort high');
    expect(a).not.toContain('--permission-mode');
    const stored = JSON.parse(fs.readFileSync(path.join(e.userData, 'chats.json'), 'utf8')) as { chats: { id: string; sessionId: string; costTotalUsd: number }[] };
    expect(stored.chats[0]).toMatchObject({ id: c.id, sessionId: c.sessionId, costTotalUsd: 0.01 });
  });

  it('routes a question to pending and back', async () => {
    const e = env();
    const { m, em } = manager(e);
    const c = await m.create({ harness: 'claude', cwd: e.cwd, prompt: 'ask me', regia: true });
    const p = await waitFor(() => m.pending()[0], 'pending question');
    expect(p).toMatchObject({ chatId: c.id, type: 'question', title: 'Che colore?' });
    expect(em.of('pending:added')).toHaveLength(1);
    expect(m.list()[0]).toMatchObject({ state: 'waiting', pending: 1, isRegia: true });
    await m.answer(c.id, p.id, { kind: 'question', answers: { 'Che colore?': 'Rosso' } });
    expect(em.of('pending:resolved')).toEqual([{ chatId: c.id, requestId: p.id }]);
    await expect(m.answer(c.id, p.id, { kind: 'question', answers: {} })).rejects.toThrow(/non è più aperta/);
    await waitFor(() => results(m, c.id).length === 1, 'result');
    expect(m.items(c.id).some(i => i.kind === 'assistant' && i.text === 'Hai scelto Rosso')).toBe(true);
    expect(m.pending()).toEqual([]);
  });

  it('persists chats, restores them closed with their history and resumes on send', async () => {
    const e = env();
    const first = manager(e);
    const c = await first.m.create({ harness: 'claude', cwd: e.cwd, prompt: 'hello', title: 'Lavoro', permissionMode: 'acceptEdits' });
    await waitFor(() => results(first.m, c.id).length === 1, 'first result');
    await first.m.shutdown();

    const { m, em } = manager(e);
    const r = m.list();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: c.id, title: 'Lavoro', state: 'closed', sessionId: c.sessionId, permissionMode: 'acceptEdits', costUsd: 0 });
    // the past comes from the transcript the CLI wrote
    const past = m.items(c.id);
    expect(past.some(i => i.kind === 'user' && i.text === 'hello')).toBe(true);
    expect(past.some(i => i.kind === 'assistant' && i.text === 'Ciao dal motore')).toBe(true);
    await m.send(c.id, 'again');
    await waitFor(() => results(m, c.id).length === 1, 'resumed result');
    const a = argvs(e)[1] ?? [];
    expect(a.join(' ')).toContain(`--resume=${c.sessionId}`);
    expect(a).not.toContain('--fork-session');
    expect(a.join(' ')).toContain('--permission-mode acceptEdits');
    // the CLI restored 0.01 of spend: this turn alone cost 0.01
    expect(results(m, c.id)[0]).toMatchObject({ costUsd: 0.01 });
    expect(m.list()[0]?.costUsd).toBe(0.01);
    expect(em.of('chat:item').some(x => x.item.kind === 'user' && 'text' in x.item && x.item.text === 'again')).toBe(true);
  });

  it('forks one of the app\'s own Claude chats (a copy with its own id), nothing else', async () => {
    const e = env();
    const { m } = manager(e);
    const orig = await m.create({ harness: 'claude', cwd: e.cwd, prompt: 'hello' });
    await waitFor(() => results(m, orig.id).length === 1, 'orig result');
    const c = await m.create({ harness: 'claude', cwd: e.cwd, resumeSessionId: orig.sessionId ?? '', fork: true, prompt: 'continue' });
    expect(c.sessionId).toBeNull();
    expect(m.items(c.id).some(i => i.kind === 'assistant' && i.text === 'Ciao dal motore')).toBe(true); // the past it starts from
    const s = await waitFor(() => m.list().find(x => x.id === c.id && x.sessionId), 'forked id');
    expect(s.sessionId).not.toBe(orig.sessionId);
    expect((argvs(e).at(-1) ?? []).join(' ')).toContain(`--resume=${orig.sessionId} --fork-session`);
    // ADR 0010: no sessions from other apps, and never the same session twice
    await expect(m.create({ harness: 'claude', cwd: e.cwd, resumeSessionId: orig.sessionId ?? '' })).rejects.toThrow(/duplicare/);
    await expect(m.create({ harness: 'claude', cwd: e.cwd, resumeSessionId: '11111111-2222-4333-8444-555555555555', fork: true })).rejects.toThrow(/duplicare/);
  });

  it('rejects bad folders and bad options', async () => {
    const e = env();
    const { m } = manager(e);
    await expect(m.create({ harness: 'claude', cwd: 'relative/dir' })).rejects.toThrow(/Cartella non valida/);
    await expect(m.create({ harness: 'claude', cwd: path.join(e.cwd, 'missing') })).rejects.toThrow(/Cartella non valida/);
    await expect(m.create({ harness: 'claude', cwd: e.cwd, permissionMode: 'yolo' as never })).rejects.toThrow(/permessi/);
    await expect(m.create({ harness: 'claude', cwd: e.cwd, resumeSessionId: '../x', fork: true })).rejects.toThrow(/duplicare/);
    await expect(m.create({ harness: 'claude', cwd: e.cwd, model: 'x" & calc' })).rejects.toThrow(/Modello non valido/);
    await expect(m.create({ harness: 'cursor', cwd: e.cwd, effort: 'high' })).rejects.toThrow(/effort/i);
    await expect(m.send('nope', 'x')).rejects.toThrow(/non trovata/);
    expect(m.items('nope')).toEqual([]);
  });

  it('applies settings live, persists them and closes a chat', async () => {
    const e = env();
    const { m, em } = manager(e);
    const c = await m.create({ harness: 'claude', cwd: e.cwd });
    await waitFor(() => m.list()[0]?.state === 'idle', 'idle');
    const s = await m.set(c.id, { model: 'opus', effort: 'low', permissionMode: 'plan', title: 'Piano' });
    expect(s).toMatchObject({ model: 'opus', effort: 'low', permissionMode: 'plan', title: 'Piano' });
    expect(m.items(c.id).some(i => i.kind === 'system' && i.text.startsWith('Applicato dal prossimo avvio'))).toBe(false);
    await expect(m.set(c.id, { title: '  ' })).rejects.toThrow(/Titolo vuoto/);
    const stored = JSON.parse(fs.readFileSync(path.join(e.userData, 'chats.json'), 'utf8')) as { chats: object[] };
    expect(stored.chats[0]).toMatchObject({ model: 'opus', effort: 'low', permissionMode: 'plan', title: 'Piano' });
    await m.close(c.id);
    expect(em.of('chat:removed')).toEqual([{ chatId: c.id }]);
    expect(m.list()).toEqual([]);
    expect((JSON.parse(fs.readFileSync(path.join(e.userData, 'chats.json'), 'utf8')) as { chats: object[] }).chats).toEqual([]);
  });

  it('stops running chats and recovers from a crash by resuming', async () => {
    const e = env();
    const { m } = manager(e, { env: { CLAUDE_CONFIG_DIR: e.home, FAKE_CLAUDE_LOG: e.argLog, FAKE_CLAUDE_DELAY: '30' } });
    const c = await m.create({ harness: 'claude', cwd: e.cwd, prompt: 'slow' });
    await waitFor(() => m.items(c.id).some(i => i.kind === 'assistant'), 'streaming');
    expect(await m.stopAll()).toBe(1);
    await waitFor(() => results(m, c.id).length === 1, 'interrupted result');
    expect(results(m, c.id)[0]).toMatchObject({ isError: true });
    await m.stop(c.id); // idle: no-op

    await m.send(c.id, 'crash');
    const s = await waitFor(() => m.list().find(x => x.state === 'error'), 'error state');
    expect(s.lastError).toContain('fake crash');
    await m.send(c.id, 'hello again');
    await waitFor(() => results(m, c.id).length === 2, 'result after restart');
    expect((argvs(e).at(-1) ?? []).join(' ')).toContain(`--resume=${c.sessionId}`);
    expect(m.list()[0]?.lastError).toBeUndefined();
  });

  it('reports the CLI status without blocking (version probed in the background)', async () => {
    const e = env();
    const { m } = manager(e);
    expect(m.cliStatus()).toMatchObject({ found: true, path: FAKE, loggedIn: null });
    await waitFor(() => m.cliStatus().version === '0.0.0-fake', 'version probe');
  });

  it('survives a corrupt chats.json and reports a missing CLI on send', async () => {
    const e = env();
    fs.writeFileSync(path.join(e.userData, 'chats.json'), '{not json');
    const { m } = manager(e, { claudePath: path.join(e.userData, 'no-claude.exe') });
    expect(m.list()).toEqual([]);
    expect(fs.readdirSync(e.userData).some(f => f.startsWith('chats.json.bad-'))).toBe(true);
    const c = await m.create({ harness: 'claude', cwd: e.cwd });
    expect(m.list().find(x => x.id === c.id)).toMatchObject({ state: 'error', lastError: expect.stringMatching(/Motore Claude non trovato/) });
    await expect(m.send(c.id, 'x')).rejects.toThrow(/Motore Claude non trovato/);
    const withPrompt = await m.create({ harness: 'claude', cwd: e.cwd, prompt: 'hi' }); // resolves: the chat exists, in error
    expect(withPrompt).toMatchObject({ state: 'error', lastError: expect.stringMatching(/Motore Claude non trovato/) });
    expect(m.cliStatus()).toMatchObject({ found: false, path: path.join(e.userData, 'no-claude.exe'), version: null });
  });

  // finding 1: stop must reach the CLI whatever state the tile shows
  it('stop interrupts whenever a process exists, even when the chat looks idle', async () => {
    const e = env();
    const { m } = manager(e);
    const c = await m.create({ harness: 'claude', cwd: e.cwd });
    await waitFor(() => m.list()[0]?.state === 'idle', 'idle');
    await m.stop(c.id);
    await waitFor(() => fakeLog(e.argLog).some(l => l.control === 'interrupt'), 'interrupt sent');
  });

  // finding 2 + A: no claude process survives the app
  it('shutdown kills a busy CLI within the grace cap, killAll kills synchronously', async () => {
    const e = env();
    const { m } = manager(e, { env: { CLAUDE_CONFIG_DIR: e.home, FAKE_CLAUDE_LOG: e.argLog, FAKE_CLAUDE_DELAY: '50' } });
    await m.create({ harness: 'claude', cwd: e.cwd, prompt: 'slow' }); // a 10 s turn: stdin end alone would wait for it
    const pid = (await waitFor(() => fakeLog(e.argLog).find(l => l.argv), 'start')).pid;
    const gc = (await waitFor(() => fakeLog(e.argLog).find(l => l.grandchild), 'the CLI\'s own child')).grandchild ?? 0;
    await waitFor(() => m.list()[0]?.state === 'running', 'running');
    const t0 = Date.now();
    await m.shutdown(400);
    expect(Date.now() - t0).toBeLessThan(20000); // grace + 4.5 s + one taskkill (1-7 s on a loaded Windows box)
    expect(alive(pid)).toBe(false); // shutdown waits for the kill to land
    await waitFor(() => !alive(gc), 'the CLI\'s child killed with it (tree kill)', 8000); // taskkill is slow under load

    const e2 = env();
    const two = manager(e2);
    await two.m.create({ harness: 'claude', cwd: e2.cwd });
    const pid2 = (await waitFor(() => fakeLog(e2.argLog).find(l => l.argv), 'start')).pid;
    expect(alive(pid2)).toBe(true);
    two.m.killAll();
    await waitFor(() => !alive(pid2), 'killed now', 10000);
  }, 60000); // taskkill takes 1-7 s on a loaded Windows box, twice here

  // finding 5: only full UUIDs reach --resume
  it('resumes only full session UUIDs', async () => {
    const e = env();
    const { m } = manager(e);
    await expect(m.create({ harness: 'claude', cwd: e.cwd, resumeSessionId: 'a976a8bc', fork: true })).rejects.toThrow(/duplicare/);
    await expect(m.create({ harness: 'claude', cwd: e.cwd, resumeSessionId: '--dangerously-skip-permissions', fork: true })).rejects.toThrow(/duplicare/);
    // a tampered chats.json id is dropped, never passed to the CLI
    fs.writeFileSync(path.join(e.userData, 'chats.json'), JSON.stringify({ chats: [{ id: 'c_x', harness: 'claude', cwd: e.cwd, sessionId: '--evil', forkFrom: '../x', title: 'T' }] }));
    const r = manager(e);
    expect(r.m.list()[0]).toMatchObject({ sessionId: null });
  });

  // "perchè tutti questi comandi mi proponi non va in automode?": a forced --permission-mode default beat settings.json
  it('with no mode chosen leaves the mode to settings.json, shows what the CLI reports, and keeps it unchosen', async () => {
    const e = env();
    const first = manager(e, { env: { CLAUDE_CONFIG_DIR: e.home, FAKE_CLAUDE_LOG: e.argLog, FAKE_CLAUDE_SETTINGS_MODE: 'auto' } });
    const c = await first.m.create({ harness: 'claude', cwd: e.cwd, prompt: 'hello' });
    expect(c.permissionMode).toBe(null);
    await waitFor(() => first.m.list()[0]?.permissionMode === 'auto', 'mode from init');
    await waitFor(() => results(first.m, c.id).length === 1, 'first result');
    await first.m.shutdown();
    const stored = JSON.parse(fs.readFileSync(path.join(e.userData, 'chats.json'), 'utf8')) as { version: number; chats: { permissionMode: unknown }[] };
    expect(stored).toMatchObject({ version: 2, chats: [{ permissionMode: null }] });
    const { m } = manager(e, { env: { CLAUDE_CONFIG_DIR: e.home, FAKE_CLAUDE_LOG: e.argLog, FAKE_CLAUDE_SETTINGS_MODE: 'auto' } });
    await m.send(c.id, 'again');
    await waitFor(() => results(m, c.id).length === 1, 'resumed result');
    for (const a of argvs(e)) expect(a).not.toContain('--permission-mode');
    expect(m.list()[0]?.permissionMode).toBe('auto');
  });

  it('reads a v1 chats.json "default" as no choice (v1 wrote it for every chat) and keeps the other modes', async () => {
    const e = env();
    const base = { harness: 'claude', cwd: e.cwd, sessionId: null, title: 'T', model: null, effort: null, isRegia: false, createdAt: 1 };
    fs.writeFileSync(path.join(e.userData, 'chats.json'), JSON.stringify({ version: 1, chats: [{ ...base, id: 'c_a', permissionMode: 'default' }, { ...base, id: 'c_b', permissionMode: 'plan' }] }));
    const { m } = manager(e);
    expect(m.list().map(c => [c.id, c.permissionMode]).sort()).toEqual([['c_a', null], ['c_b', 'plan']]);
    await m.set('c_a', { permissionMode: 'default' }); // chosen now: saved as a real choice (v2)
    const stored = JSON.parse(fs.readFileSync(path.join(e.userData, 'chats.json'), 'utf8')) as { version: number; chats: { id: string; permissionMode: unknown }[] };
    expect(stored.version).toBe(2);
    expect(stored.chats.find(c => c.id === 'c_a')?.permissionMode).toBe('default');
    const again = manager(e).m;
    expect(again.list().find(c => c.id === 'c_a')?.permissionMode).toBe('default');
  });

  // finding B: a mode the CLI took by itself is shown, never saved
  it('shows but never persists a permission mode set by the CLI ("always" with a setMode suggestion)', async () => {
    const e = env();
    const { m } = manager(e);
    const c = await m.create({ harness: 'claude', cwd: e.cwd, prompt: 'mode' });
    const p = await waitFor(() => m.pending()[0], 'mode permission');
    expect(p.alwaysRules).toEqual(['modalità: accetta modifiche']);
    await m.answer(c.id, p.id, { kind: 'permission', allow: true, always: true });
    await waitFor(() => m.list()[0]?.permissionMode === 'acceptEdits', 'mode shown');
    await waitFor(() => results(m, c.id).length === 1, 'result');
    const stored = JSON.parse(fs.readFileSync(path.join(e.userData, 'chats.json'), 'utf8')) as { chats: { permissionMode: string }[] };
    expect(stored.chats[0]?.permissionMode).toBe(null);
    await m.set(c.id, { permissionMode: 'plan' }); // the user's own choice is saved
    expect((JSON.parse(fs.readFileSync(path.join(e.userData, 'chats.json'), 'utf8')) as { chats: { permissionMode: string }[] }).chats[0]?.permissionMode).toBe('plan');
  });

  // finding C: an error result with total 0 must not reset the saved total
  it('keeps the cost total across an error result, so the next resume counts one turn', async () => {
    const e = env();
    const first = manager(e);
    const c = await first.m.create({ harness: 'claude', cwd: e.cwd, prompt: 'hello' });
    await waitFor(() => results(first.m, c.id).length === 1, 'first result');
    await first.m.send(c.id, 'expired');
    await waitFor(() => results(first.m, c.id).length === 2, 'error result');
    const stored = JSON.parse(fs.readFileSync(path.join(e.userData, 'chats.json'), 'utf8')) as { chats: { costTotalUsd: number }[] };
    expect(stored.chats[0]?.costTotalUsd).toBe(0.01);
    await first.m.shutdown();
    const { m } = manager(e);
    await m.send(c.id, 'again');
    await waitFor(() => results(m, c.id).length === 1, 'resumed result');
    expect(results(m, c.id)[0]).toMatchObject({ costUsd: 0.01 });
  });

  // Cursor engine (the fake ACP agent only)
  it('runs a Cursor chat: panel, answer, turn, cost unknown; restored chats resume with session/load', async () => {
    const e = env();
    const curLog = path.join(e.userData, 'cursor.jsonl');
    const opts = { cursorPath: FAKE_CURSOR, env: { FAKE_CURSOR_LOG: curLog, CURSOR_CONFIG_DIR: tmp('cursor-user') } };
    const first = manager(e, opts);
    const c = await first.m.create({ harness: 'cursor', cwd: e.cwd, prompt: 'perm', regia: true });
    expect(c).toMatchObject({ harness: 'cursor', isRegia: true, sessionId: null, costKnown: false });
    const p = await waitFor(() => first.m.pending()[0], 'permission');
    expect(p).toMatchObject({ chatId: c.id, type: 'permission', noAlways: true });
    await first.m.answer(c.id, p.id, { kind: 'permission', allow: true });
    await waitFor(() => results(first.m, c.id).length === 1 && first.m.list()[0]?.state === 'idle', 'turn');
    const s = first.m.list()[0];
    expect(s).toMatchObject({ costUsd: 0, costKnown: false, model: 'auto', lastText: 'Test verdi.' });
    expect(s?.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(first.m.set(c.id, { effort: 'high' })).rejects.toThrow(/effort/i);
    await first.m.shutdown();

    const { m } = manager(e, opts);
    expect(m.list()[0]).toMatchObject({ id: c.id, harness: 'cursor', state: 'closed', sessionId: s?.sessionId, costKnown: false });
    await m.send(c.id, 'hello');
    await waitFor(() => results(m, c.id).length === 1, 'resumed turn');
    expect(cursorLog(curLog).filter(l => l.method === 'session/load').map(l => l.params?.sessionId)).toEqual([s?.sessionId]);
    // after the restart the tile shows the past Cursor replayed, before the new message
    const seen = m.items(c.id).map(i => `${i.kind}:${'text' in i ? i.text : ''}`);
    expect(seen.slice(0, 3)).toEqual(['user:vecchia domanda', 'assistant:vecchia risposta', 'user:hello']);
    expect(m.items(c.id).some(i => i.kind === 'assistant' && i.text === 'Ciao dal motore')).toBe(true);
  });

  // Cursor model change: never session/set_model (it writes the user's global Cursor config); the session is reopened
  // with the new --model and session/load, inside the app's own config folder
  it('changes a Cursor chat\'s model by reopening its session, never with session/set_model', async () => {
    const e = env();
    const curLog = path.join(e.userData, 'cursor.jsonl');
    const userDir = tmp('cursor-user');
    const userCfg = JSON.stringify({ model: { modelId: 'user-model' }, hasChangedDefaultModel: false });
    fs.writeFileSync(path.join(userDir, 'cli-config.json'), userCfg);
    const { m } = manager(e, { cursorPath: FAKE_CURSOR, env: { FAKE_CURSOR_LOG: curLog, CURSOR_CONFIG_DIR: userDir } });
    const c = await m.create({ harness: 'cursor', cwd: e.cwd, prompt: 'hello', model: 'gpt-5.6-sol' });
    await waitFor(() => results(m, c.id).length === 1 && m.list()[0]?.state === 'idle', 'first turn');
    const sid = m.list()[0]?.sessionId;
    const s = await m.set(c.id, { model: 'claude-sonnet-5.5' });
    expect(s.model).toBe('claude-sonnet-5.5');
    await waitFor(() => m.list()[0]?.state === 'closed', 'session closed for the new model');
    await m.send(c.id, 'again');
    await waitFor(() => results(m, c.id).length === 2, 'turn with the new model');
    const starts = cursorLog(curLog).filter(l => l.argv).map(l => l.argv);
    expect(starts).toEqual([['--model', 'gpt-5.6-sol', 'acp'], ['--model', 'claude-sonnet-5.5', 'acp']]);
    expect(cursorLog(curLog).filter(l => l.method === 'session/load').map(l => l.params?.sessionId)).toEqual([sid]);
    expect(cursorLog(curLog).some(l => l.method === 'session/set_model')).toBe(false);
    expect(fs.readFileSync(path.join(userDir, 'cli-config.json'), 'utf8')).toBe(userCfg); // the user's Cursor config: untouched
    expect(JSON.parse(fs.readFileSync(path.join(e.userData, 'cursor-config', 'cli-config.json'), 'utf8')).model).toEqual({ modelId: 'claude-sonnet-5.5' });
    expect(m.items(c.id).filter(i => i.kind === 'user').map(i => (i as { text: string }).text)).toEqual(['hello', 'again']); // history kept, no replay twice
  });

  // brain hooks (wiring.ts connects them to BrainService)
  it('calls the brain hooks: estimate at the first send, waiting, turn end with the first prompt, done, rate limits', async () => {
    const e = env();
    const calls = { rate: [] as unknown[], turns: [] as TurnEndInfo[], waiting: [] as string[], done: [] as string[], est: [] as string[] };
    const { m } = manager(e, {
      onRateLimit: msg => calls.rate.push(msg),
      onTurnEnd: i => calls.turns.push(i),
      onWaiting: (id, p) => calls.waiting.push(`${id}:${p.type}`),
      onDone: id => calls.done.push(id),
      estimateFor: req => { calls.est.push(req.prompt); return { kind: 'question', estimate: { usdLow: 0.01, usdHigh: 0.05, minLow: 1, minHigh: 3 }, basis: { count: 7, scope: 'kind+model', label: 'da 7 lavori simili' } }; },
    });
    const c = await m.create({ harness: 'claude', cwd: e.cwd, prompt: 'ask me', model: 'sonnet' });
    expect(m.list()[0]?.estimate).toEqual({ usdLow: 0.01, usdHigh: 0.05, minLow: 1, minHigh: 3, basis: 7 });
    const p = await waitFor(() => m.pending()[0], 'question');
    expect(calls.waiting).toEqual([`${c.id}:question`]);
    expect(calls.done).toEqual([]); // waiting for the user is not done
    await m.answer(c.id, p.id, { kind: 'question', answers: { 'Che colore?': 'Blu' } });
    await waitFor(() => calls.done.length === 1, 'done after the turn');
    expect(calls.done).toEqual([c.id]);
    expect(calls.turns).toHaveLength(1);
    expect(calls.turns[0]).toEqual({ chatId: c.id, sessionId: c.sessionId, harness: 'claude', model: 'sonnet', effort: null, kind: 'question', firstPrompt: 'ask me', costUsd: 0.01, durationMs: expect.any(Number), turns: 1, isError: false });
    // the stream's rate_limit_event and the get_usage answer both reach the brain
    await waitFor(() => calls.rate.some(x => (x as { type?: string }).type === 'rate_limit_event') && calls.rate.some(x => !!(x as { rate_limits?: unknown }).rate_limits), 'rate limits');
    await m.send(c.id, 'hello');
    await waitFor(() => calls.turns.length === 2 && calls.done.length === 2, 'second turn');
    expect(calls.turns[1]?.firstPrompt).toBeUndefined();
    expect(calls.est).toEqual(['ask me']); // one estimate per job
    expect(m.isOwnSession(c.sessionId ?? '')).toBe(true);
    expect(m.isOwnSession((c.sessionId ?? '').slice(0, 8).toUpperCase())).toBe(true);
    expect(m.isOwnSession('deadbeef')).toBe(false);
    expect(m.isOwnSession('1234')).toBe(false);
  });

  it('a throwing hook never breaks the chat; a restored chat starts no new job', async () => {
    const e = env();
    const boom = (): never => { throw new Error('listener bug'); };
    const est: string[] = [];
    const first = manager(e, { onRateLimit: boom, onTurnEnd: boom, onWaiting: boom, onDone: boom, estimateFor: req => { est.push(req.prompt); return boom(); } });
    const c = await first.m.create({ harness: 'claude', cwd: e.cwd, prompt: 'bash' });
    const p = await waitFor(() => first.m.pending()[0], 'permission');
    await first.m.answer(c.id, p.id, { kind: 'permission', allow: true });
    await waitFor(() => results(first.m, c.id).length === 1 && first.m.list()[0]?.state === 'idle', 'turn completes');
    expect(first.m.list()[0]?.estimate).toBeUndefined();
    await first.m.shutdown();
    const { m } = manager(e, { estimateFor: req => { est.push(req.prompt); return null; } });
    await m.send(c.id, 'again');
    await waitFor(() => results(m, c.id).length === 1, 'resumed turn');
    expect(est).toEqual(['bash']);
  });

});
