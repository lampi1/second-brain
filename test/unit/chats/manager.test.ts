// ChatManager (the app's ChatService) against the fake CLI: events, questions, persistence and restore,
// resume on send with history, forks of external sessions, settings, close, crash recovery.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ChatManager, type ChatManagerOptions, type TurnEndInfo } from '../../../src/main/chats/manager';
import { ClaudeSession } from '../../../src/main/chats/claude';
import { FAKE, FAKE_CURSOR, PNG_1PX, alive, cursorLog, fakeLog, killStray, recEmitter, tmp, waitFor, type RecEmitter } from './helpers';

interface Env { userData: string; home: string; cwd: string; argLog: string }
const managers: ChatManager[] = [];
function env(): Env {
  const e = { userData: tmp('ud'), home: tmp('home'), cwd: tmp('cwd'), argLog: '' };
  e.argLog = path.join(e.userData, 'argv.jsonl');
  return e;
}
function manager(e: Env, extra: Partial<ChatManagerOptions> = {}): { m: ChatManager; em: RecEmitter } {
  const em = recEmitter();
  const m = new ChatManager({ emitter: em, userData: e.userData, enginePaths: { claude: FAKE }, claudeHome: e.home, env: { CLAUDE_CONFIG_DIR: e.home, FAKE_CLAUDE_LOG: e.argLog }, ...extra });
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
    expect(c).toMatchObject({ origin: 'app', harness: 'claude', title: 'hello there', model: 'sonnet', permissionMode: null, isOrchestrator: false });
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
    // The matching --session-id init must still confirm a native analytics session.
    const observed = m.analytics.readModel();
    expect(observed.agents).toHaveLength(1);
    expect(observed.agents[0]?.costs.listPriceUsd.total).toBe(0.01);
    expect(observed.agents[0]?.costs.actualUsd.total).toBeNull();
    expect(observed.agents[0]?.evidence[0]?.provenance.modelObserved).toBe('sonnet');
  });

  it('routes a question to pending and back', async () => {
    const e = env();
    const { m, em } = manager(e);
    const c = await m.create({ harness: 'claude', cwd: e.cwd, prompt: 'ask me', orchestrator: true });
    const p = await waitFor(() => m.pending()[0], 'pending question');
    expect(p).toMatchObject({ chatId: c.id, type: 'question', title: 'Che colore?' });
    expect(em.of('pending:added')).toHaveLength(1);
    expect(m.list()[0]).toMatchObject({ state: 'waiting', pending: 1, isOrchestrator: true });
    await m.answer(c.id, p.id, { kind: 'question', answers: { 'Che colore?': 'Rosso' } });
    expect(em.of('pending:resolved')).toEqual([{ chatId: c.id, requestId: p.id }]);
    await expect(m.answer(c.id, p.id, { kind: 'question', answers: {} })).rejects.toThrow(/non è più aperta/);
    await waitFor(() => results(m, c.id).length === 1, 'result');
    expect(m.items(c.id).some(i => i.kind === 'assistant' && i.text === 'Hai scelto Rosso')).toBe(true);
    expect(m.pending()).toEqual([]);
  });

  it('counts work time while starting or running, never while waiting for the answer', async () => {
    const e = env();
    const { m, em } = manager(e);
    const c = await m.create({ harness: 'claude', cwd: e.cwd, prompt: 'ask me' });
    const p = await waitFor(() => m.pending()[0], 'pending question');
    const before = m.workMs(c.id);
    expect(m.list()[0]!.workSince).toBeUndefined(); // the span stops when the chat waits
    await new Promise(r => setTimeout(r, 1200)); // the user thinks: not work
    expect(m.workMs(c.id)).toBe(before);
    await m.answer(c.id, p.id, { kind: 'question', answers: { 'Che colore?': 'Rosso' } });
    await waitFor(() => m.list()[0]?.state === 'idle', 'idle');
    const s = m.list()[0]!;
    expect(s.workSince).toBeUndefined();
    expect(s.workMs).toBeGreaterThan(before);
    expect(s.workMs).toBeLessThan(1200 + before); // the 1.2 s of waiting are not in it
    expect(m.workMs(c.id)).toBe(s.workMs);
    expect(em.of('chat:updated').at(-1)).toMatchObject({ workMs: s.workMs });
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
    // a model an ACP CLI would read as one of its flags (qwen -m --yolo)
    await expect(m.create({ harness: 'cursor', cwd: e.cwd, model: '--yolo' })).rejects.toThrow(/Modello non valido/);
    await expect(m.create({ harness: 'anthropic', cwd: e.cwd, effort: 'high' })).rejects.toThrow(/effort/i);
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

  it('never starts an engine the user switched off: neither a new chat nor a stopped one resuming', async () => {
    const e = env();
    const { m } = manager(e);
    const c = await m.create({ harness: 'claude', cwd: e.cwd, prompt: 'hello' });
    await waitFor(() => results(m, c.id).length === 1, 'first result');
    await m.shutdown();
    const { m: off } = manager(e, { engineOn: h => h !== 'claude' });
    await expect(off.create({ harness: 'claude', cwd: e.cwd, prompt: 'x' })).rejects.toThrow(/Claude è spento nelle impostazioni/);
    await expect(off.send(c.id, 'again')).rejects.toThrow(/Claude è spento/);
    expect(argvs(e)).toHaveLength(1); // only the first chat's engine ever started
  });

  it('an agent never wakes a stopped chat on an engine the Orchestrators may not use; the user still can', async () => {
    const e = env();
    const { m } = manager(e);
    const c = await m.create({ harness: 'claude', cwd: e.cwd, prompt: 'hello' });
    await waitFor(() => results(m, c.id).length === 1, 'first result');
    await m.shutdown();
    const { m: again } = manager(e, { agentsMayOpen: () => false });
    await expect(again.send(c.id, 'from an agent', undefined, false, 'Orchestrator')).rejects.toThrow(/Gli Orchestrator possono usare Claude/);
    expect(argvs(e)).toHaveLength(1);
    await again.send(c.id, 'from the user');
    await waitFor(() => results(again, c.id).length === 1, 'the user resumed it');
  });

  it('stops running chats and recovers from a crash by resuming', async () => {
    const e = env();
    const { m } = manager(e, { env: { CLAUDE_CONFIG_DIR: e.home, FAKE_CLAUDE_LOG: e.argLog, FAKE_CLAUDE_DELAY: '30' } });
    const c = await m.create({ harness: 'claude', cwd: e.cwd, prompt: 'slow' });
    await waitFor(() => m.items(c.id).some(i => i.kind === 'assistant'), 'streaming');
    expect(await m.stopAll()).toBe(1);
    await waitFor(() => results(m, c.id).length === 1, 'interrupted result');
    expect(results(m, c.id)[0]).toMatchObject({ isError: false, interrupted: true });
    expect(m.list().find(x => x.id === c.id)?.lastResult).toMatchObject({ isError: false, interrupted: true });
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
    const { m } = manager(e, { enginePaths: { claude: path.join(e.userData, 'no-claude.exe') } });
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

  it('a message with pasted images: checked, shown with its previews, passed to the engine', async () => {
    const e = env();
    const { m } = manager(e);
    const c = await m.create({ harness: 'claude', cwd: e.cwd });
    await waitFor(() => m.list()[0]?.state === 'idle', 'idle');
    await expect(m.send(c.id, '  ', [])).rejects.toThrow(/vuoto/);
    await expect(m.send(c.id, 'x', [{ mimeType: 'image/jpeg', data: PNG_1PX }])).rejects.toThrow(/non è un image\/jpeg/);
    const thumb = 'data:image/webp;base64,UklGRg==';
    await m.send(c.id, '', [{ mimeType: 'image/png', data: PNG_1PX, thumb }]);
    expect(m.items(c.id).find(i => i.kind === 'user')).toMatchObject({ text: '', images: 1, thumbs: [thumb] });
    await waitFor(() => fakeLog(e.argLog).find(l => l.blocks), 'the message at the engine');
    expect(fakeLog(e.argLog).find(l => l.blocks)?.blocks).toEqual([`image:base64:image/png:${PNG_1PX.length}`]);
  });

  // finding 2 + A: no claude process survives the app
  it('shutdown kills a busy CLI within its cap, killAll kills without blocking', async () => {
    const e = env();
    // the CLI's child lives 5 min by itself: only the tree kill can end it within this test
    const { m } = manager(e, { env: { CLAUDE_CONFIG_DIR: e.home, FAKE_CLAUDE_LOG: e.argLog, FAKE_CLAUDE_DELAY: '50', FAKE_CLAUDE_CHILD_MS: '300000' } });
    await m.create({ harness: 'claude', cwd: e.cwd, prompt: 'slow' }); // a 10 s turn: stdin end alone would wait for it
    const pid = (await waitFor(() => fakeLog(e.argLog).find(l => l.argv), 'start')).pid;
    const gc = (await waitFor(() => fakeLog(e.argLog).find(l => l.grandchild), 'the CLI\'s own child')).grandchild ?? 0;
    const reaped = tmp('quit-reap');
    const was = process.env.SB_QUIT_REAP_DONE;
    process.env.SB_QUIT_REAP_DONE = reaped;
    try {
      await waitFor(() => m.list()[0]?.state === 'running', 'running');
      const t0 = Date.now();
      await m.shutdown(400);
      expect(Date.now() - t0).toBeLessThan(6000); // within its cap (5.5 s), under the app's 6 s quit cap
      expect(alive(pid)).toBe(false); // shutdown waits for the kill to land
      // the detached child (it escapes the CLI's job) dies with the tree kill, or, when the CLI had to be terminated
      // directly before anyone read its tree (WMI and taskkill take 15-40 s at 100% CPU), with the reaper that outlives
      // the quit: wait for the child's death or the reaper's end (an event, not a guess at the load), then it must be dead
      const done = path.join(reaped, `${pid}.done`);
      await waitFor(() => !alive(gc) || fs.existsSync(done), 'the CLI\'s child killed, or the quit reaper done', 180000);
      await waitFor(() => !alive(gc), 'the CLI\'s child killed with it (tree kill or quit reaper)', 5000);
    } finally {
      if (was === undefined) delete process.env.SB_QUIT_REAP_DONE; else process.env.SB_QUIT_REAP_DONE = was;
      killStray(gc);
    }

    const e2 = env();
    const two = manager(e2);
    await two.m.create({ harness: 'claude', cwd: e2.cwd });
    const pid2 = (await waitFor(() => fakeLog(e2.argLog).find(l => l.argv), 'start')).pid;
    expect(alive(pid2)).toBe(true);
    const t1 = Date.now();
    two.m.killAll();
    expect(Date.now() - t1).toBeLessThan(1000); // never blocks the main process (the quit's 6 s cap must hold)
    // taskkill walks every process: 15-40 s on a loaded box, past 45 s at 100% CPU (2026-10-14, the 5th of 5 runs)
    await waitFor(() => !alive(pid2), 'the CLI killed by the detached taskkill', 180000);
  }, 450000); // taskkill and the reaper's WMI list take 15-40 s each on a loaded Windows box, minutes at 100% CPU

  // a chat closed with ✕ / Ctrl+W / auto close: the CLI ends cleanly, but what it started must not outlive it
  it('closing a chat leaves no process behind: the background command and its own child are reaped', async () => {
    const e = env();
    const was = process.env.SB_REAP;
    process.env.SB_REAP = '1';
    const { m } = manager(e);
    const orphans = (): number[] => fakeLog(e.argLog).flatMap(l => (l.orphan ? [l.orphan] : []));
    try {
      const c = await m.create({ harness: 'claude', cwd: e.cwd, prompt: 'orphan' });
      const pid = (await waitFor(() => fakeLog(e.argLog).find(l => l.argv), 'start')).pid;
      await waitFor(() => orphans().length === 2, 'the background command and its child');
      await waitFor(() => m.list()[0]?.state === 'idle', 'idle');
      expect(orphans().every(alive)).toBe(true);
      const t0 = Date.now();
      await m.close(c.id); // the ✕ path: stdin closed, the CLI exits by itself
      await waitFor(() => !alive(pid), 'the CLI exited');
      expect(Date.now() - t0).toBeLessThan(3000); // before the 3 s grace: no tree kill ran, only the reap can end them
      // one WMI process list (3-40 s on a loaded box) then taskkill
      await waitFor(() => orphans().every(p => !alive(p)), 'no process left from the closed chat', 180000); // minutes at 100% CPU
    } finally {
      if (was === undefined) delete process.env.SB_REAP; else process.env.SB_REAP = was;
      for (const p of orphans()) killStray(p);
    }
  }, 240000);

  // the chat goes on in a new process (here: the Orchestrator moves): the old engine's tools stay for now, and go at the real close
  it('a chat that goes on keeps its tools until it really closes, then they are reaped', async () => {
    const e = env();
    const was = process.env.SB_REAP;
    process.env.SB_REAP = '1';
    const { m } = manager(e);
    const orphans = (): number[] => fakeLog(e.argLog).flatMap(l => (l.orphan ? [l.orphan] : []));
    try {
      const old = await m.create({ harness: 'claude', cwd: e.cwd, prompt: 'orphan', title: 'Orchestrator', orchestrator: true });
      const pid = (await waitFor(() => fakeLog(e.argLog).find(l => l.argv), 'start')).pid;
      await waitFor(() => orphans().length === 2, 'the background command and its child');
      await waitFor(() => m.list().find(c => c.id === old.id)?.state === 'idle', 'idle');
      await m.create({ harness: 'claude', cwd: e.cwd, title: 'Orchestrator', orchestrator: true, replaces: old.id }); // the old Orchestrator's process ends
      await waitFor(() => !alive(pid), 'the old engine exited');
      await new Promise(r => setTimeout(r, 5000)); // longer than a quick process list: a reap would have run
      expect(orphans().every(alive)).toBe(true);
      await m.close(old.id);
      await waitFor(() => orphans().every(p => !alive(p)), 'its tools reaped at the real close', 180000); // WMI + taskkill: past 90 s at 100% CPU (2026-10-14)
    } finally {
      if (was === undefined) delete process.env.SB_REAP; else process.env.SB_REAP = was;
      for (const p of orphans()) killStray(p);
    }
  }, 260000);

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
    const opts = { enginePaths: { claude: FAKE, cursor: FAKE_CURSOR }, env: { FAKE_CURSOR_LOG: curLog, CURSOR_CONFIG_DIR: tmp('cursor-user') } };
    const first = manager(e, opts);
    const c = await first.m.create({ harness: 'cursor', cwd: e.cwd, prompt: 'perm', orchestrator: true });
    expect(c).toMatchObject({ harness: 'cursor', isOrchestrator: true, sessionId: null, costKnown: false });
    const p = await waitFor(() => first.m.pending()[0], 'permission');
    expect(p).toMatchObject({ chatId: c.id, type: 'permission', noAlways: true });
    await first.m.answer(c.id, p.id, { kind: 'permission', allow: true });
    await waitFor(() => results(first.m, c.id).length === 1 && first.m.list()[0]?.state === 'idle', 'turn');
    const s = first.m.list()[0];
    expect(s).toMatchObject({ costUsd: 0, costKnown: false, model: 'auto[context=256k,reasoning_effort=high,fast=true]', lastText: 'Test verdi.' });
    expect(s?.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    // the effort goes live on the model's thought_level option (issue #97) and the tile reads it back (#100)
    expect(await first.m.set(c.id, { effort: 'low' })).toMatchObject({ effort: 'low', model: 'auto[context=256k,reasoning_effort=low,fast=true]', effortStatus: { effective: 'low' } });
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
    const { m } = manager(e, { enginePaths: { claude: FAKE, cursor: FAKE_CURSOR }, env: { FAKE_CURSOR_LOG: curLog, CURSOR_CONFIG_DIR: userDir } });
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
  it('calls the brain hooks: waiting, turn end with the first prompt, done, rate limits', async () => {
    const e = env();
    const calls = { rate: [] as unknown[], turns: [] as TurnEndInfo[], waiting: [] as string[], done: [] as string[] };
    const { m } = manager(e, {
      onRateLimit: msg => calls.rate.push(msg),
      onTurnEnd: i => calls.turns.push(i),
      onWaiting: (id, p) => calls.waiting.push(`${id}:${p.type}`),
      onDone: id => calls.done.push(id),
    });
    const c = await m.create({ harness: 'claude', cwd: e.cwd, prompt: 'ask me', model: 'sonnet' });
    const p = await waitFor(() => m.pending()[0], 'question');
    expect(calls.waiting).toEqual([`${c.id}:question`]);
    expect(calls.done).toEqual([]); // waiting for the user is not done
    await m.answer(c.id, p.id, { kind: 'question', answers: { 'Che colore?': 'Blu' } });
    await waitFor(() => calls.done.length === 1, 'done after the turn');
    expect(calls.done).toEqual([c.id]);
    expect(calls.turns).toHaveLength(1);
    expect(calls.turns[0]).toEqual({ chatId: c.id, sessionId: c.sessionId, harness: 'claude', model: 'sonnet', effort: null, firstPrompt: 'ask me', costUsd: 0.01, durationMs: expect.any(Number), turns: 1, isError: false, reply: 'Hai scelto Blu' });
    // the stream's rate_limit_event and the get_usage answer both reach the brain
    await waitFor(() => calls.rate.some(x => (x as { type?: string }).type === 'rate_limit_event') && calls.rate.some(x => !!(x as { rate_limits?: unknown }).rate_limits), 'rate limits');
    await m.send(c.id, 'hello');
    await waitFor(() => calls.turns.length === 2 && calls.done.length === 2, 'second turn');
    expect(calls.turns[1]?.firstPrompt).toBeUndefined(); // the job's start goes with its first turn only
    expect(m.isOwnSession(c.sessionId ?? '')).toBe(true);
    expect(m.isOwnSession((c.sessionId ?? '').slice(0, 8).toUpperCase())).toBe(true);
    expect(m.isOwnSession('deadbeef')).toBe(false);
    expect(m.isOwnSession('1234')).toBe(false);
  });

  it('a throwing hook never breaks the chat; a restored chat resumes without a new job', async () => {
    const e = env();
    const boom = (): never => { throw new Error('listener bug'); };
    const first = manager(e, { onRateLimit: boom, onTurnEnd: boom, onWaiting: boom, onDone: boom });
    const c = await first.m.create({ harness: 'claude', cwd: e.cwd, prompt: 'bash' });
    const p = await waitFor(() => first.m.pending()[0], 'permission');
    await first.m.answer(c.id, p.id, { kind: 'permission', allow: true });
    await waitFor(() => results(first.m, c.id).length === 1 && first.m.list()[0]?.state === 'idle', 'turn completes');
    await first.m.shutdown();
    const { m } = manager(e, {});
    await m.send(c.id, 'again');
    await waitFor(() => results(m, c.id).length === 1, 'resumed turn');
  });

  // `replaces` (Ricomincia da capo, Cambia motore, Pulisci): the new Orchestrator takes the role; the
  // old one stays as a normal chat and its process (started with the app-control tools) is closed, so its next
  // message resumes it without them. Each Orchestrator gets its own app-control endpoint; the Cursor Orchestrator gets it too.
  it('moves the Orchestrator role to a new chat (persisted, both updated) and gives a Cursor Orchestrator the app MCP server', async () => {
    const e = env();
    const curLog = path.join(e.userData, 'cursor.jsonl');
    const appUrl = (id: string) => `http://127.0.0.1:4329/mcp/app/o/${id}/tok`;
    const browserUrl = (id: string) => `http://127.0.0.1:4329/mcp/chat/${id}/tok`;
    const opts = { enginePaths: { claude: FAKE, cursor: FAKE_CURSOR }, appMcpUrl: appUrl, mcpUrlFor: browserUrl, env: { CLAUDE_CONFIG_DIR: e.home, FAKE_CLAUDE_LOG: e.argLog, FAKE_CURSOR_LOG: curLog, CURSOR_CONFIG_DIR: tmp('cursor-user') } };
    const { m, em } = manager(e, opts);
    const old = await m.create({ harness: 'claude', cwd: e.cwd, prompt: 'hello', title: 'Orchestrator', orchestrator: true });
    await waitFor(() => results(m, old.id).length === 1 && m.list()[0]?.state === 'idle', 'claude orchestrator turn');
    expect(argvs(e)[0]?.join(' ')).toContain('--allowedTools mcp__second-brain-app');
    const work = await m.create({ harness: 'claude', cwd: e.cwd, title: 'Fix' });

    const before = em.of('chat:updated').length;
    expect((await m.create({ harness: 'cursor', cwd: e.cwd, orchestrator: true, replaces: work.id })).id).toBe(old.id); // only the Orchestrator is replaced
    const neu = await m.create({ harness: 'cursor', cwd: e.cwd, title: 'Orchestrator', orchestrator: true, replaces: old.id });
    expect(neu.isOrchestrator).toBe(true);
    expect(m.list().filter(c => c.isOrchestrator).map(c => c.id)).toEqual([neu.id]);
    const updates = em.of('chat:updated').slice(before);
    expect(updates.some(u => u.id === old.id && !u.isOrchestrator)).toBe(true);
    expect(updates.some(u => u.id === neu.id && u.isOrchestrator)).toBe(true);
    const stored = JSON.parse(fs.readFileSync(path.join(e.userData, 'chats.json'), 'utf8')) as { chats: { id: string; isOrchestrator: boolean }[] };
    expect(stored.chats.map(c => [c.id, c.isOrchestrator])).toEqual([[old.id, false], [work.id, false], [neu.id, true]]);
    // the old Orchestrator is not deleted: its idle process ends, its history stays
    await waitFor(() => m.list().find(c => c.id === old.id)?.state === 'closed', 'old orchestrator process closed');
    expect(m.items(old.id).some(i => i.kind === 'user' && i.text === 'hello')).toBe(true);

    // the Cursor Orchestrator receives the app-control server (app_create_chat) next to its browser endpoint
    await waitFor(() => cursorLog(curLog).some(l => l.method === 'session/new'), 'cursor session/new');
    expect(cursorLog(curLog).find(l => l.method === 'session/new')?.params?.mcpServers).toEqual([
      { type: 'http', name: 'second-brain', url: browserUrl(neu.id), headers: [] },
      { type: 'http', name: 'second-brain-app', url: appUrl(neu.id), headers: [] },
    ]);

    // a normal Cursor chat never gets it; the former Orchestrator resumes without --allowedTools for the app
    await m.create({ harness: 'cursor', cwd: e.cwd, title: 'Lavoro' });
    await waitFor(() => cursorLog(curLog).filter(l => l.method === 'session/new').length === 2, 'second cursor session');
    expect(cursorLog(curLog).filter(l => l.method === 'session/new')[1]?.params?.mcpServers).toEqual([{ type: 'http', name: 'second-brain', url: expect.stringContaining('/mcp/chat/'), headers: [] }]);
    await m.send(old.id, 'again');
    await waitFor(() => results(m, old.id).length === 2, 'former orchestrator resumed');
    expect(argvs(e).at(-1)?.join(' ')).not.toContain('mcp__second-brain-app');
  });

  it('raises the cost of a chat while its turn runs (live estimate), then settles it to the real cost', async () => {
    const e = env();
    const { m } = manager(e);
    const c = await m.create({ harness: 'claude', cwd: e.cwd, prompt: 'meter' });
    const mid = await waitFor(() => m.list().find(x => x.id === c.id && (x.costLiveUsd ?? 0) > 0), 'live cost');
    expect(mid.costUsd).toBe(mid.costLiveUsd);
    expect(mid.state).toBe('running');
    const done = await waitFor(() => m.list().find(x => x.id === c.id && results(m, c.id).length === 1 && x.costLiveUsd === undefined), 'settled');
    expect(done.costUsd).toBe(0.01);
    // a second turn starts from the settled 0.01, never from the old estimate
    await m.send(c.id, 'meter');
    await waitFor(() => (m.list().find(x => x.id === c.id)?.costLiveUsd ?? 0) > 0, 'second live cost');
    const s2 = m.list().find(x => x.id === c.id)!;
    expect(s2.costUsd).toBeCloseTo(0.01 + (s2.costLiveUsd ?? 0), 9);
    await waitFor(() => results(m, c.id).length === 2 && m.list().find(x => x.id === c.id)?.costLiveUsd === undefined, 'second result');
    expect(m.list().find(x => x.id === c.id)?.costUsd).toBe(0.02);
  });

  it('corrects the live cost with get_usage mid-turn and keeps it as spent when the CLI dies mid-turn', async () => {
    const e = env();
    const { m } = manager(e, { onRateLimit: () => {}, usageEveryMs: 200 });
    const c = await m.create({ harness: 'claude', cwd: e.cwd, prompt: 'meter die' });
    // the fake's tracker says 0.05 mid-turn: the real figure replaces the token estimate
    await waitFor(() => m.list().find(x => x.id === c.id && x.costLiveUsd === 0.05), 'real running cost');
    // no result will come: the cost stays, without the "still running" mark
    const s = await waitFor(() => m.list().find(x => x.id === c.id && x.state === 'error'), 'crashed');
    expect(s.costLiveUsd).toBeUndefined();
    expect(s.costUsd).toBe(0.05);
  });

  it('a CLI that dies mid-turn calls onCrash once with its error (no result, so no onDone); a close does not', async () => {
    const e = env();
    const crashes: [string, string][] = [];
    const done: string[] = [];
    const { m } = manager(e, { onCrash: (id, err) => crashes.push([id, err]), onDone: id => done.push(id) });
    const c = await m.create({ harness: 'claude', cwd: e.cwd, prompt: 'meter die' });
    await waitFor(() => m.list().find(x => x.id === c.id && x.state === 'error'), 'crashed');
    await waitFor(() => crashes.length === 1, 'onCrash');
    expect(crashes[0]![0]).toBe(c.id);
    expect(crashes[0]![1]).toContain('fake crash mid-turn');
    expect(done).toEqual([]);
    const ok = await m.create({ harness: 'claude', cwd: e.cwd, prompt: 'hello' });
    await waitFor(() => results(m, ok.id).length === 1, 'result');
    await m.close(ok.id);
    expect(crashes).toHaveLength(1);
  });

  it('asks get_usage on its own every usageEveryMs while a Claude chat is open (plan windows during long turns)', async () => {
    const e = env();
    const rate: unknown[] = [];
    const { m } = manager(e, { onRateLimit: msg => rate.push(msg), usageEveryMs: 200 });
    await m.create({ harness: 'claude', cwd: e.cwd, prompt: 'meter' });
    await waitFor(() => rate.filter(x => !!(x as { rate_limits?: unknown }).rate_limits).length >= 2, 'two get_usage answers mid-turn', 8000);
    expect(results(m, m.list()[0]!.id)).toHaveLength(0); // still in its first turn (the meter pause)
  });

  it('an idle chat with an explicitly complete census releases after the delay and resumes; never a Orchestrator', async () => {
    const e = env();
    // Simulate a provider that can prove there are no unobserved children. Real Claude's partial census is covered
    // by archive.test.ts and must not be interpreted as a complete zero by releaseIdle.
    const { m } = manager(e, { sessionFactory: (_h, options, sink) => new ClaudeSession({ ...options, claudePath: FAKE }, { ...sink, childrenCoverage: (coverage, reason) => sink.childrenCoverage?.(coverage === 'partial' ? 'complete' : coverage, reason) }) });
    const c = await m.create({ harness: 'claude', cwd: e.cwd, prompt: 'hello there' });
    const orchestrator = await m.create({ harness: 'claude', cwd: e.cwd, prompt: 'hello orchestrator', orchestrator: true });
    await waitFor(() => results(m, c.id).length === 1 && results(m, orchestrator.id).length === 1, 'both turns');
    await waitFor(() => m.list().every(x => x.state === 'idle'), 'both idle');
    expect(m.releaseIdle(60_000)).toBe(0); // not idle long enough
    expect(m.releaseIdle(60_000, Date.now() + 61_000)).toBe(1);
    await waitFor(() => m.engines().live.length === 1, 'one engine left (the Orchestrator)');
    expect(m.engines().live[0]?.chatId).toBe(orchestrator.id);
    expect(m.list().find(x => x.id === c.id)).toMatchObject({ state: 'idle' });
    await m.send(c.id, 'again');
    await waitFor(() => results(m, c.id).length === 2, 'resumed turn');
    expect(argvs(e).at(-1)?.join(' ')).toContain(`--resume=${c.sessionId}`);
  });

  it('typing into a chat whose engine was released resumes it ahead of the message (no turn); a live engine is left alone', async () => {
    const e = env();
    const { m } = manager(e, { sessionFactory: (_h, options, sink) => new ClaudeSession({ ...options, claudePath: FAKE }, { ...sink, childrenCoverage: (coverage, reason) => sink.childrenCoverage?.(coverage === 'partial' ? 'complete' : coverage, reason) }) });
    const c = await m.create({ harness: 'claude', cwd: e.cwd, prompt: 'hello there' });
    await waitFor(() => results(m, c.id).length === 1 && m.list().find(x => x.id === c.id)?.state === 'idle', 'first turn');
    expect(m.prewarm(c.id)).toBe(false); // its engine is up
    expect(m.releaseIdle(60_000, Date.now() + 61_000)).toBe(1);
    await waitFor(() => m.engines().live.length === 0, 'released');
    const before = argvs(e).length;
    expect(m.prewarm(c.id)).toBe(true);
    await waitFor(() => m.engines().live.length === 1 && argvs(e).length === before + 1, 'engine started while typing');
    expect(argvs(e).at(-1)?.join(' ')).toContain(`--resume=${c.sessionId}`);
    expect(results(m, c.id)).toHaveLength(1); // no turn, no tokens
    const spawns = argvs(e).length;
    await m.send(c.id, 'again');
    await waitFor(() => results(m, c.id).length === 2, 'the message used that engine');
    expect(argvs(e)).toHaveLength(spawns);
  });
});

