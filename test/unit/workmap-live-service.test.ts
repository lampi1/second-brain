// Unit tests of the live status kept by main/workmap/service.ts and live-memory.ts (ADR 0342), over plain chat summaries, an
// in-memory store and a clock the test moves: the page is told only of a real change and no version is written for it,
// an owner chat that died by itself tells the Orchestrator once (one closed by hand does not), a restart, what goes
// stale, and the user's stop and the approval never overwritten. The pure reading: test/unit/workmap-live.test.ts; on a
// real ChatManager: test/unit/agents/work-map-chats.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, errText: (e: unknown) => String(e) }));
import type { ChatSummary, PendingRequest } from '../../src/shared/contract';
import type { LadderQuestion } from '../../src/shared/question-ladder';
import type { PlanPhase, PlanStep, StrategyPlan } from '../../src/shared/strategy';
import type { WorkMap } from '../../src/shared/work-map';
import { STALE_MS } from '../../src/main/workmap/live';
import { LiveMemory } from '../../src/main/workmap/live-memory';
import { CRASH_GRACE_MS, WorkMaps } from '../../src/main/workmap/service';

let now: number, saved: WorkMap[], side: unknown, sideWrites: number, chats: ChatSummary[], asks: PendingRequest[], emitted: string[], told: { threadId: string; detail: string }[], untold: string[], takes: boolean, n: number;
beforeEach(() => { now = 1_000_000; saved = []; side = null; sideWrites = 0; chats = []; asks = []; emitted = []; told = []; untold = []; takes = true; n = 0; });

const step = (state: PlanStep['state'], ...ids: string[]): PlanStep => ({ title: 'Passo', state, ...(ids.length ? { chatIds: ids } : {}) });
const plan = (phase: PlanPhase, ...steps: PlanStep[]): StrategyPlan => ({ phase, at: 100, clarified: [], steps });
function chat(id: string, extra: Partial<ChatSummary> = {}): ChatSummary {
  return { id, harness: 'claude', origin: 'app', title: `Lavoro ${id}`, cwd: 'C:/repo', state: 'running', pending: 0, isOrchestrator: false, lastText: '', updatedAt: 0,
    agent: { id: 'strategist', source: 'catalog' }, run: { runId: `run-${id}`, goal: 'Sconti', startedAt: 900 }, ...extra } as unknown as ChatSummary;
}
const kid = (id: string, parentId: string, extra: Partial<ChatSummary> = {}) => chat(id, { parentId, agent: { id: 'artisan', source: 'catalog' } as unknown as ChatSummary['agent'], ...extra });
function maps(): WorkMaps {
  const w = new WorkMaps({
    store: { load: () => [...new Map(saved.map(m => [m.id, m])).values()].map(m => structuredClone(m)), save: m => { saved.push(structuredClone(m)); }, history: () => [], version: () => null,
      loadLive: () => side, saveLive: v => { side = structuredClone(v); sideWrites++; } },
    chats: { list: () => chats, pending: () => asks, planDecide: async () => {}, planStart: async () => {}, planReplan: async () => {}, planPutAway: () => {},
      planStop: async id => { const c = chats.find(x => x.id === id)!; put({ ...c, plan: { ...c.plan!, stopped: true } }); },
      planResume: async id => { const { closedAt: _a, closedBy: _b, ...open } = chats.find(x => x.id === id)!; saw(w, { ...open, state: 'running' } as ChatSummary); } },
    emit: id => emitted.push(id), now: () => now, newId: () => `wm_live${String(++n).padStart(2, '0')}`,
  });
  w.tellTo({ stalledWork: x => { if (takes) told.push(x); return takes; }, unstalled: id => untold.push(id) });
  return w;
}
const put = (c: ChatSummary): ChatSummary => { chats = [...chats.filter(x => x.id !== c.id), c]; return c; };
const saw = (w: WorkMaps, c: ChatSummary) => { w.observe('chat:updated', put(c)); };
const change = (w: WorkMaps, id: string, extra: Partial<ChatSummary>) => saw(w, { ...chats.find(c => c.id === id)!, ...extra });
const remove = (w: WorkMaps, id: string, by?: 'user' | 'agent') => { chats = chats.filter(c => c.id !== id); w.observe('chat:removed', { chatId: id, ...(by ? { by } : {}) }); };
const info = (w: WorkMaps) => w.list()[0]!;
/** A job under way: its owner chat between turns and one step's chat at work. */
function job(w: WorkMaps) {
  saw(w, chat('own', { plan: plan('running', step('now', 'k'), step('todo')), state: 'idle', lastResult: { at: now, isError: false } as unknown as ChatSummary['lastResult'] }));
  saw(w, kid('k', 'own'));
  emitted.length = 0;
  return w.ofChat('own')!.id;
}

describe('the page is told of a real change, and no version is written for it', () => {
  it('each thing a step\'s chat does is one event and no version', () => {
    const w = maps(), id = job(w), versions = saved.length;
    const says = () => w.view(id)!.boxes[0]!.live;
    expect(info(w).live).toMatchObject({ say: 'working', working: [{ chatId: 'k' }] });
    const held: LadderQuestion = { id: 'q-1', asks: [{ question: 'Anche i resi?', options: [] }], level: 'strategist', holder: 'own', at: now, levelAt: now, trail: [], via: 'message' };
    const steps: [Partial<ChatSummary>, object][] = [
      [{ state: 'waiting', pending: 1 }, { say: 'waiting', waits: 'user' }],
      [{ state: 'running', pending: 0 }, { say: 'working' }],
      [{ state: 'idle', questions: [held] }, { say: 'waiting', waits: 'parent' }],
      [{ questions: [{ ...held, level: 'orchestrator' }] }, { say: 'waiting', waits: 'orchestrator' }],
      [{ questions: [{ ...held, level: 'user', holder: undefined }] }, { say: 'waiting', waits: 'user' }],
      [{ questions: [], lastResult: { at: now, isError: true } as unknown as ChatSummary['lastResult'] }, { say: 'failed' }],
      [{ state: 'closed', closedAt: now, closedBy: 'user', lastResult: { at: now, isError: false } as unknown as ChatSummary['lastResult'] }, { say: 'closed' }],
    ];
    for (const [extra, want] of steps) {
      emitted.length = 0;
      change(w, 'k', extra);
      expect(says()).toMatchObject(want);
      expect(emitted).toEqual([id]);
    }
    expect(saved).toHaveLength(versions);
  });

  it('nothing changed: no event, no version, no write, at the chat\'s events and at every tick', () => {
    const w = maps();
    job(w);
    w.tick();
    const versions = saved.length, writes = sideWrites;
    emitted.length = 0;
    change(w, 'k', { lastText: 'ancora', updatedAt: 7, costUsd: 3 } as Partial<ChatSummary>);
    change(w, 'own', { lastText: 'x' });
    w.observe('chat:item', { chatId: 'k' });
    w.tick();
    w.tick();
    expect([emitted, saved.length, sideWrites]).toEqual([[], versions, writes]);
  });

  it('a chat of no map tells nothing', () => {
    const w = maps();
    job(w);
    saw(w, kid('z', 'elsewhere'));
    change(w, 'z', { state: 'error' });
    expect(emitted).toEqual([]);
  });

  it('a grandchild shows on the step at once, and so does its question', () => {
    const w = maps(), id = job(w);
    change(w, 'k', { state: 'idle', lastResult: { at: now, isError: false } as unknown as ChatSummary['lastResult'] });
    emitted.length = 0;
    saw(w, kid('g', 'k'));
    expect(w.view(id)!.boxes[0]!.live).toMatchObject({ say: 'working', chats: [{ chatId: 'g', below: true }, { chatId: 'k' }] });
    asks = [{ id: 'q', chatId: 'g', type: 'question' } as unknown as PendingRequest];
    w.observe('pending:added', asks[0]);
    expect(w.view(id)!.boxes[0]!.live).toMatchObject({ say: 'waiting', waits: 'user' });
    asks = [];
    w.observe('pending:resolved', { chatId: 'g', requestId: 'q' });
    expect(w.view(id)!.boxes[0]!.live).toMatchObject({ say: 'working' });
    expect(emitted).toEqual([id, id, id]);
  });

  it('a step\'s chat that leaves the app is gone from its step at once', () => {
    const w = maps(), id = job(w);
    remove(w, 'k', 'user');
    expect(w.view(id)!.boxes[0]!.live).toMatchObject({ say: 'gone' });
    expect(info(w).live).toMatchObject({ lost: [{ chatId: 'k', say: 'gone' }] });
    expect(emitted).toEqual([id]);
  });

  it('a durable change and what it changes of the live status are one event', () => {
    const w = maps(), id = job(w);
    change(w, 'own', { plan: plan('running', step('done', 'k'), step('now')), state: 'running' });
    expect(emitted).toEqual([id]);
  });

  it('an earlier version has no live status', () => {
    const w = maps(), id = job(w);
    expect(w.view(id)!.info.live).toBeDefined();
    expect(saved.at(-1)).not.toHaveProperty('live');
  });
});

describe('the owner chat dead by itself', () => {
  it('its engine died and did not come back: stopped after the grace, the Orchestrator told once', async () => {
    const w = maps(), id = job(w);
    change(w, 'k', { ...({ delegation: { at: 1, result: { outcome: 'done', at: now } } } as unknown as Partial<ChatSummary>), state: 'closed', closedAt: now, closedBy: 'auto' });
    change(w, 'own', { state: 'error' });
    expect(info(w)).toMatchObject({ state: 'running', live: { failed: [{ chatId: 'own' }] } });
    now += CRASH_GRACE_MS - 1; w.tick();
    expect(w.get(id)!.state).toBe('running');
    now += 1; w.tick();
    expect(info(w)).toMatchObject({ state: 'stopped', stopped: { by: 'closed' }, live: { why: 'crash' } });
    expect(told).toMatchObject([{ threadId: id }]);
    expect(told[0]!.detail).toMatch(/action resume/);
    now += 1e6; w.tick(); w.tick();
    change(w, 'own', { lastText: 'x' });
    expect(told).toHaveLength(1);
    // taken up again: not stopped any more, and the next stop is told again
    await w.act(id, 'resume', {}, 'Orchestrator');
    expect(w.get(id)!.state).toBe('running');
    expect(untold).toEqual([id]);
    change(w, 'own', { state: 'closed', closedAt: now, closedBy: 'auto' });
    expect(told).toHaveLength(2);
  });

  it('back by itself within the grace, or with a chat at work below: nothing stops', () => {
    const w = maps(), id = job(w);
    change(w, 'own', { state: 'error' });
    now += CRASH_GRACE_MS; w.tick();
    expect(w.get(id)!.state).toBe('running');
    change(w, 'own', { state: 'running' });
    change(w, 'k', { state: 'closed', closedAt: now, closedBy: 'user' });
    now += CRASH_GRACE_MS; w.tick();
    expect(w.get(id)!.state).toBe('running');
    expect(told).toEqual([]);
  });

  it('comes back later by itself: the map goes on', () => {
    const w = maps(), id = job(w);
    remove(w, 'k', 'user');
    change(w, 'own', { state: 'error' });
    now += CRASH_GRACE_MS; w.tick();
    expect(w.get(id)!.state).toBe('stopped');
    change(w, 'own', { state: 'running' });
    expect(w.get(id)!.state).toBe('running');
    expect(untold).toEqual([id]);
  });

  it('closed by the app with steps open, or dropped by it: told once', () => {
    const w = maps(), id = job(w);
    change(w, 'own', { state: 'closed', closedAt: now, closedBy: 'auto' });
    expect(info(w)).toMatchObject({ state: 'stopped', live: { why: 'closedByApp' } });
    remove(w, 'own');
    expect(info(w)).toMatchObject({ state: 'stopped', stopped: { by: 'gone' }, live: { why: 'gone' } });
    expect(told.map(t => t.threadId)).toEqual([id]);
    saw(w, chat('b', { plan: plan('running', step('todo')) }));
    remove(w, 'b');
    expect(told).toHaveLength(2);
  });

  it('closed by the user, or by an agent: stopped with resume, nobody told', () => {
    const w = maps(), id = job(w);
    change(w, 'own', { state: 'closed', closedAt: now, closedBy: 'user' });
    expect(info(w)).toMatchObject({ state: 'stopped', can: expect.arrayContaining(['resume']), live: { why: 'closedByUser' } });
    // later it leaves the app: still closed by the user
    remove(w, 'own');
    expect(info(w)).toMatchObject({ id, live: { why: 'closedByUser' } });
    saw(w, chat('b', { plan: plan('running', step('todo')) }));
    remove(w, 'b', 'user');
    saw(w, chat('c', { plan: plan('running', step('todo')) }));
    remove(w, 'c', 'agent');
    expect(w.list().map(i => i.live?.why).sort()).toEqual(['closedByAgent', 'closedByUser', 'closedByUser']);
    now += 1e7; w.tick();
    expect(told).toEqual([]);
  });

  it('a plan that waits for the user, closed by him and dropped later, is never told as dead', () => {
    const w = maps();
    saw(w, chat('p', { plan: plan('proposed', step('todo')), state: 'closed', closedAt: now, closedBy: 'user' }));
    remove(w, 'p');
    expect(told).toEqual([]);
  });

  it('not taken (no Orchestrator): told at a later tick, once', () => {
    const w = maps(), id = job(w);
    takes = false;
    change(w, 'own', { state: 'closed', closedAt: now, closedBy: 'auto' });
    w.tick();
    expect(told).toEqual([]);
    takes = true;
    w.tick(); w.tick();
    expect(told.map(t => t.threadId)).toEqual([id]);
  });

  it('moved again before it was told: nothing to tell', () => {
    const w = maps();
    job(w);
    takes = false;
    change(w, 'own', { state: 'closed', closedAt: now, closedBy: 'auto' });
    change(w, 'own', { state: 'running', closedAt: undefined, closedBy: undefined });
    takes = true;
    w.tick();
    expect(told).toEqual([]);
  });
});

describe('what is never overwritten', () => {
  it('the user\'s stop: the chat that dies after it leaves it as it is, and nobody is told', async () => {
    const w = maps(), id = job(w);
    remove(w, 'k', 'user');
    await w.act(id, 'stop');
    const stop = w.get(id)!.stopped;
    expect(stop).toMatchObject({ by: 'user' });
    change(w, 'own', { state: 'error' });
    now += CRASH_GRACE_MS; w.tick();
    change(w, 'own', { state: 'closed', closedAt: now, closedBy: 'auto' });
    remove(w, 'own');
    expect(w.get(id)!.stopped).toEqual(stop);
    expect(info(w).live).toMatchObject({ why: 'user' });
    expect(told).toEqual([]);
  });

  it('a plan to approve, or approved and kept: its engine dead changes nothing', () => {
    for (const phase of ['proposed', 'approved'] as const) {
      const w = maps(), c = `own-${phase}`;
      saw(w, chat(c, { plan: plan(phase, step('todo')) }));
      const before = w.ofChat(c)!;
      change(w, c, { state: 'error' });
      now += CRASH_GRACE_MS; w.tick();
      expect(w.ofChat(c)).toEqual(before);
    }
    expect(told).toEqual([]);
  });
});

describe('time and a restart', () => {
  it('a turn over and no report since: stale from that turn, told to the page once, no version', () => {
    const w = maps(), id = job(w);
    const at = now, versions = saved.length;
    change(w, 'k', { state: 'idle', lastResult: { at, isError: false } as unknown as ChatSummary['lastResult'] });
    now += STALE_MS; w.tick();
    expect(w.view(id)!.boxes[0]!.live!.stale).toBeUndefined();
    emitted.length = 0;
    now += 1; w.tick();
    expect(w.view(id)!.boxes[0]!.live).toMatchObject({ say: 'between', stale: at });
    expect(info(w).live!.stale).toBe(at);
    now += STALE_MS; w.tick();
    expect(emitted).toEqual([id]);
    // confirmed again
    change(w, 'k', { state: 'running' });
    expect(info(w).live!.stale).toBeUndefined();
    expect(saved).toHaveLength(versions);
  });

  it('the app restarts with steps under way: unknown, stale since they were last seen, until they work again', () => {
    const w = maps(), id = job(w), seen = now += 5000;
    w.tick();
    w.stop();
    now += 60_000;
    chats = chats.map(c => ({ ...c, state: 'closed', lastResult: undefined }) as unknown as ChatSummary);
    const again = maps();
    again.adopt();
    expect(again.view(id)!.boxes[0]!.live).toMatchObject({ say: 'unknown', stale: seen });
    expect(again.get(id)!.state).toBe('running');
    change(again, 'k', { state: 'running' });
    expect(again.view(id)!.boxes[0]!.live).toMatchObject({ say: 'working' });
    expect(again.view(id)!.boxes[0]!.live!.stale).toBeUndefined();
  });

  it('a restart tells nothing twice, and keeps a dead engine\'s stop', () => {
    const w = maps(), id = job(w);
    remove(w, 'k', 'user');
    change(w, 'own', { state: 'error' });
    now += CRASH_GRACE_MS; w.tick();
    w.stop();
    const versions = saved.length;
    chats = chats.map(c => ({ ...c, state: 'closed' }) as ChatSummary);
    const again = maps();
    again.adopt(); again.tick();
    expect(info(again)).toMatchObject({ id, state: 'stopped', live: { why: 'crash' } });
    expect(saved).toHaveLength(versions);
    expect(told).toHaveLength(1);
  });

  it('the owner chat missing at start: stopped and told; closed by the user before, not told', () => {
    const w = maps();
    job(w);
    saw(w, chat('p', { plan: plan('approved', step('todo')), state: 'closed', closedAt: now, closedBy: 'user' }));
    w.stop();
    chats = [];
    const again = maps();
    again.adopt();
    expect(told.map(t => t.threadId)).toEqual([saved.find(m => m.owner?.chatId === 'own')!.id]);
  });

  it('what it remembers is read leniently, and only of chats and maps that are there', () => {
    for (const bad of [null, 3, 'x', { seen: 4, crashes: { a: 'x' }, gone: { b: 'nobody' }, stops: { m: null, o: { at: 'x' } } }]) {
      const l = new LiveMemory(bad);
      expect([l.confirmed('a'), l.crashed('a'), l.removedBy('b'), l.untold()]).toEqual([undefined, false, undefined, []]);
    }
    const l = new LiveMemory({ seen: { a: 5, b: 6 }, crashes: {}, gone: { own: 'user', old: 'agent' }, stops: { m: { at: 4, told: true } } });
    expect(l.toSave(id => id === 'a', id => id === 'own')).toEqual({ seen: { a: 5 }, crashes: {}, gone: { own: 'user' }, stops: { m: { at: 4, told: true } } });
    expect(l.toSave(id => id === 'a', id => id === 'own')).toBeNull();
  });
});
