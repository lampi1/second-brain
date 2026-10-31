// The user's ✕ cancels a chat's whole delegation tree (owner, 2026-10-31): children and grandchildren that run, wait
// for an answer or wait in the CPU queue are stopped, their engines closed with their own processes, their open
// questions withdrawn unanswered, their runs ended; nothing but the user's own message reopens them (no late report,
// mail, child result or app resume), the cleanup is idempotent, and chats outside the tree are never touched.
import { afterEach, describe, expect, it } from 'vitest';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionSink } from '../../../src/main/chats/session';
import type { AdmissionLimits, LoadSample } from '../../../src/main/chats/admission';
import { plainOwner } from '../../../src/main/agents/catalog';
import { FAKE, alive, fakeLog, killStray, recEmitter, tmp, waitFor } from './helpers';

const managers: ChatManager[] = [];
afterEach(async () => { await Promise.all(managers.splice(0).map(m => m.shutdown())); });

const ON: AdmissionLimits = { enabled: true, cpu: 75, ram: 15 };

/** What the fake engine of each chat was asked to do. */
interface Calls { interrupts: number; closes: { keepChildren: boolean }[]; sent: string[]; answered: number }

function fixture() {
  const dir = tmp('close-tree'), em = recEmitter();
  const load: LoadSample = { cpu: 10, freeRam: 80 };
  const calls = new Map<string, Calls>(), sinks = new Map<string, SessionSink>(), busy = new Map<string, boolean>();
  const of = (id: string) => { let c = calls.get(id); if (!c) calls.set(id, c = { interrupts: 0, closes: [], sent: [], answered: 0 }); return c; };
  const m = new ChatManager({ userData: dir, emitter: em, coldEveryMs: 0, runEveryMs: 0, env: { CLAUDE_CONFIG_DIR: `${dir}/home` },
    admission: { sampler: { sample: () => ({ ...load }) }, limits: () => ON, autoTick: false },
    sessionFactory: (harness, o, s) => {
      const id = o.chatId; sinks.set(id, s);
      let closed = false;
      const self = { harness, sessionId: null, pid: null, root: null, get alive() { return !closed; }, get busy() { return !!busy.get(id); },
        start() { s.childrenCoverage?.('complete'); s.changed({ state: 'idle' }); },
        send(text: string) {
          of(id).sent.push(text);
          // "keep-busy" keeps the turn running until the test ends it; anything else answers at once
          busy.set(id, true); s.changed({ state: 'running' });
          if (/keep-busy/.test(text)) return;
          s.item({ kind: 'assistant', id: `a-${id}-${of(id).sent.length}`, at: Date.now(), text: 'Ok.' }, false);
          s.item({ kind: 'result', id: `r-${id}-${of(id).sent.length}`, at: Date.now(), isError: false, costUsd: 0, durationMs: 1, turns: 1 }, false);
          busy.set(id, false); s.changed({ state: 'idle' });
        },
        interrupt: async () => {
          of(id).interrupts++;
          if (busy.get(id)) { busy.set(id, false); s.item({ kind: 'result', id: `x-${id}-${of(id).interrupts}`, at: Date.now(), isError: false, interrupted: true, costUsd: 0, durationMs: 1, turns: 1 }, false); s.changed({ state: 'idle' }); }
        },
        close: async (_grace?: number, keepChildren = false) => {
          of(id).closes.push({ keepChildren });
          if (closed) return;
          closed = true; busy.set(id, false); s.changed({ state: 'closed' }); s.exit({ code: 0, error: null });
        },
        killNow() {}, answer: () => { of(id).answered++; return true; },
        rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
      };
      return self as unknown as HarnessSession;
    } });
  managers.push(m);
  const owner = { ...plainOwner('claude', null), source: 'catalog' as const, id: 'strategist', version: 1 };
  const chat = (id: string) => m.list().find(c => c.id === id);
  /** Orchestrator, a root Strategist S under it, its children C1 (at work) and C2 (waiting for the user's answer), C1's
   *  child G (waiting in the CPU queue), and an unrelated root chat U at work. */
  const tree = async () => {
    const o = await m.create({ harness: 'claude', cwd: dir, orchestrator: true });
    const s = await m.create({ harness: 'claude', cwd: dir }, 'agent', { owner, instructions: 'Pianifica.', policy: null });
    await m.send(s.id, 'Pianifica il lavoro.', undefined, false, 'Orchestrator');
    const child = (parentId: string, goal: string, prompt?: string) => m.create({ harness: 'claude', cwd: dir, parentId, ...(prompt ? { prompt } : {}),
      delegation: { role: 'artisan', goal, doneWhen: ['Fatto'], at: Date.now() } }, 'agent', { owner: { ...owner, id: 'artisan' }, instructions: 'Fai.', policy: null });
    const c1 = await child(s.id, 'Implement', 'keep-busy: implementa');
    await waitFor(() => busy.get(c1.id), 'C1 at work', 5000);
    const c2 = await child(s.id, 'Ask', 'keep-busy: chiedi');
    await waitFor(() => busy.get(c2.id), 'C2 at work', 5000);
    // mid-turn it asks the user (AskUserQuestion)
    sinks.get(c2.id)!.pending({ id: 'q-c2', type: 'question', tool: 'AskUserQuestion', title: 'Quale cartella?', detail: '', input: {}, at: Date.now() });
    sinks.get(c2.id)!.changed({ state: 'waiting' });
    load.cpu = 95; // over the threshold: the grandchild's first turn waits in the CPU queue
    const g = await child(c1.id, 'Piece', 'keep-busy: un pezzo');
    const u = await m.create({ harness: 'claude', cwd: dir, prompt: 'keep-busy: altro' });
    await waitFor(() => busy.get(u.id), 'U at work', 5000);
    return { o, s, c1, c2, g, u };
  };
  return { m, em, dir, calls, of, busy, chat, tree, load };
}

describe('the user\'s ✕ cancels the chat\'s whole delegation tree', () => {
  it('stops children and grandchildren at work, waiting for an answer or queued, and leaves others alone', async () => {
    const f = fixture(), t = await f.tree();
    expect(f.chat(t.g.id)?.queued).toBeTruthy();
    expect(f.m.pending().map(p => p.chatId)).toContain(t.c2.id);
    await f.m.archive(t.s.id, { undoable: true });
    for (const id of [t.s.id, t.c1.id, t.c2.id, t.g.id]) expect(f.chat(id)).toMatchObject({ state: 'closed', closedBy: 'user' });
    // C1's turn was stopped and its engine closed with its own processes (never kept alive)
    expect(f.of(t.c1.id).interrupts).toBe(1);
    expect(f.of(t.c1.id).closes).toEqual([{ keepChildren: false }]);
    expect(f.chat(t.c1.id)?.run).toMatchObject({ endReason: 'closed' });
    // C2's question is withdrawn, never answered
    expect(f.m.pending().filter(p => p.chatId === t.c2.id)).toEqual([]);
    expect(f.em.of('pending:resolved')).toContainEqual({ chatId: t.c2.id, requestId: 'q-c2' });
    expect(f.of(t.c2.id).answered).toBe(0);
    expect(f.of(t.c2.id).closes).toEqual([{ keepChildren: false }]);
    // G's queued first turn is dropped: it never starts, not even when the load falls
    expect(f.m.queueState()?.waiting.map(w => w.chatId) ?? []).not.toContain(t.g.id);
    f.load.cpu = 10;
    const q = (f.m as unknown as { admission: { tick(): void } }).admission;
    q.tick(); q.tick(); q.tick();
    await new Promise(r => setTimeout(r, 50));
    expect(f.of(t.g.id).sent).toEqual([]);
    expect(f.chat(t.g.id)?.closedAt).toBeDefined();
    // the transcripts stay
    expect(f.m.items(t.c1.id).some(i => i.kind === 'user')).toBe(true);
    // outside the tree: untouched
    expect(f.chat(t.u.id)).toMatchObject({ state: 'running' });
    expect(f.chat(t.u.id)?.closedAt).toBeUndefined();
    expect(f.of(t.u.id)).toMatchObject({ interrupts: 0, closes: [] });
    expect(f.chat(t.o.id)?.closedAt).toBeUndefined();
  });

  it('is idempotent: closing again, then the final close, change nothing more', async () => {
    const f = fixture(), t = await f.tree();
    await f.m.archive(t.s.id, { undoable: true });
    const before = JSON.stringify([t.c1.id, t.c2.id, t.g.id].map(id => f.of(id)));
    await f.m.archive(t.s.id, { undoable: true });
    await f.m.close(t.s.id);
    await f.m.close(t.s.id).catch(() => {}); // already gone from the app
    expect(JSON.stringify([t.c1.id, t.c2.id, t.g.id].map(id => f.of(id)))).toBe(before);
    for (const id of [t.c1.id, t.c2.id, t.g.id]) expect(f.chat(id)).toMatchObject({ state: 'closed', closedBy: 'user' });
    expect(f.chat(t.s.id)).toBeUndefined();
    expect(f.chat(t.u.id)?.closedAt).toBeUndefined();
  });

  it('nothing late resurrects a cancelled chat: reports, mail, assignments, app resume; the user\'s own message does', async () => {
    const f = fixture(), t = await f.tree();
    await f.m.archive(t.s.id);
    expect(() => f.m.reportDelegation(t.c1.id, { outcome: 'done', summary: 'Fatto tardi', output: 'x', doneWhen: [] })).toThrow(/closed this chat/);
    await expect(f.m.send(t.c2.id, 'Posta tardiva', undefined, false, 'Strategist')).rejects.toThrow(/chiusa dall’utente/);
    await expect(f.m.send(t.s.id, 'riprendi', undefined, true)).rejects.toThrow(/chiusa dall’utente/);
    await expect(f.m.send(t.s.id, 'Risultato', undefined, false, undefined, false, { kind: 'chat', chatId: t.o.id })).rejects.toThrow(/chiusa dall’utente/);
    await expect(f.m.assignTask(t.s.id, 'Ancora', { mode: 'continue', source: { kind: 'chat', chatId: t.o.id } })).rejects.toThrow(/user closed this chat/);
    f.m.noteMail(t.s.id, t.o.id, 'Tutto fatto');
    for (const id of [t.s.id, t.c1.id, t.c2.id, t.g.id]) expect(f.chat(id)?.closedAt).toBeDefined();
    expect(f.of(t.s.id).sent).toHaveLength(1); // its first assignment only: nothing late reached its engine
    // the user's own message reopens the chat it is written to, and only that one
    await f.m.send(t.s.id, 'Riprendi tu');
    expect(f.chat(t.s.id)?.closedAt).toBeUndefined();
    for (const id of [t.c1.id, t.c2.id, t.g.id]) expect(f.chat(id)?.closedAt).toBeDefined();
  });

  it('an agent never reopens a cancelled chat by writing to it (app_send_to_chat); an explicit reopen does, that chat only', async () => {
    const f = fixture(), t = await f.tree();
    await f.m.archive(t.s.id);
    // exactly what app_send_to_chat sends (appctl/tools.ts): the Orchestrator's title and its chat as the source
    await expect(f.m.send(t.c1.id, 'Continua', undefined, false, 'Orchestrator', false, { kind: 'chat', chatId: t.o.id })).rejects.toThrow(/app_reopen_chat/);
    expect(f.chat(t.c1.id)?.closedAt).toBeDefined();
    await f.m.reopen(t.c1.id); // app_reopen_chat, when the user asks
    expect(f.chat(t.c1.id)?.closedAt).toBeUndefined();
    // reopened, the usual rules apply again: a role chat's follow-up goes through app_assign_task
    await expect(f.m.send(t.c1.id, 'Continua', undefined, false, 'Orchestrator', false, { kind: 'chat', chatId: t.o.id })).rejects.toThrow(/app_assign_task/);
    for (const id of [t.s.id, t.c2.id, t.g.id]) expect(f.chat(id)?.closedAt).toBeDefined();
  });

  it('closing one child cancels its subtree only: the parent and the siblings go on', async () => {
    const f = fixture(), t = await f.tree();
    await f.m.archive(t.c1.id, { undoable: true });
    expect(f.chat(t.c1.id)).toMatchObject({ closedBy: 'user' });
    expect(f.chat(t.g.id)).toMatchObject({ closedBy: 'user' });
    expect(f.chat(t.s.id)?.closedAt).toBeUndefined();
    expect(f.chat(t.c2.id)?.closedAt).toBeUndefined();
    expect(f.m.pending().map(p => p.chatId)).toContain(t.c2.id);
    // the cancelled child's late report never reaches its parent
    expect(() => f.m.reportDelegation(t.c1.id, { outcome: 'done', summary: 'Fatto tardi', output: 'x', doneWhen: [] })).toThrow(/closed this chat/);
    expect(f.m.items(t.s.id).some(i => i.kind === 'user' && i.text.includes('Fatto tardi'))).toBe(false);
  });

  it('the automatic close and a progress mail never cascade', async () => {
    const f = fixture(), t = await f.tree();
    f.m.noteMail(t.s.id, t.o.id, 'Avanzamento: due figli al lavoro.');
    expect(f.chat(t.s.id)?.closedAt).toBeUndefined();
    await expect(f.m.archive(t.s.id, { auto: true })).rejects.toThrow();
    for (const id of [t.s.id, t.c1.id, t.c2.id, t.g.id]) expect(f.chat(id)?.closedAt).toBeUndefined();
    expect(f.of(t.c1.id)).toMatchObject({ interrupts: 0, closes: [] });
  });
});

describe('the ✕ ends the real engines of the tree, never another chat\'s', () => {
  it('a parent and its delegated child at work: both CLI processes end, an unrelated one lives', async () => {
    const userData = tmp('close-tree-ud'), home = tmp('close-tree-home'), cwd = tmp('close-tree-cwd'), argLog = `${userData}/argv.jsonl`;
    const m = new ChatManager({ emitter: recEmitter(), userData, enginePaths: { claude: FAKE }, claudeHome: home,
      env: { CLAUDE_CONFIG_DIR: home, FAKE_CLAUDE_LOG: argLog, FAKE_CLAUDE_DELAY: '50', FAKE_CLAUDE_CHILD_MS: '60000' } });
    managers.push(m);
    const pidOf = async (n: number) => (await waitFor(() => fakeLog(argLog).filter(l => l.argv)[n], `engine ${n}`)).pid;
    const parent = await m.create({ harness: 'claude', cwd, prompt: 'slow' });
    const p1 = await pidOf(0);
    const child = await m.create({ harness: 'claude', cwd, parentId: parent.id, prompt: 'slow', delegation: { role: 'artisan', goal: 'Piece', doneWhen: ['Fatto'], at: Date.now() } }, 'agent');
    const p2 = await pidOf(1);
    const other = await m.create({ harness: 'claude', cwd, prompt: 'slow' });
    const p3 = await pidOf(2);
    try {
      await waitFor(() => m.list().filter(c => c.state === 'running').length === 3, 'three turns running');
      await m.archive(parent.id, { undoable: true });
      await waitFor(() => !alive(p1) && !alive(p2), 'the parent\'s and the child\'s engines ended');
      expect(m.list().find(c => c.id === child.id)).toMatchObject({ state: 'closed', closedBy: 'user' });
      expect(alive(p3)).toBe(true);
      expect(m.list().find(c => c.id === other.id)?.state).toBe('running');
    } finally { for (const p of [p1, p2]) killStray(p); }
  });
});
