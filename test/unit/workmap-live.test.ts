// Unit tests of main/workmap/live.ts (ADR 0342, live status): pure, over plain chat summaries. One test per transition of
// a step's chat (starts, waits and for whom, fails, is interrupted, reports done, partial or blocked, is closed without a
// report, is gone), the chats it delegated, what nobody can vouch for (stale, with its time), and why a map is stopped.
// The same through the service: test/unit/workmap-live-service.test.ts.
import { describe, expect, it } from 'vitest';
import type { ChatSummary, PendingRequest } from '../../src/shared/contract';
import type { PlanStep, StrategyPlan } from '../../src/shared/strategy';
import { liveWords, type WorkMap, type WorkMapLive, type WorkBoxLive } from '../../src/shared/work-map';
import { liveOf, movesBelow, readingOf, STALE_MS, type LiveInput } from '../../src/main/workmap/live';
import { settle } from '../../src/main/workmap/follow';

const NOW = 10 * 3600_000;
function chat(id: string, extra: Partial<ChatSummary> = {}): ChatSummary {
  return { id, harness: 'claude', origin: 'app', title: `Chat ${id}`, state: 'idle', pending: 0, lastText: '', updatedAt: 0, ...extra } as unknown as ChatSummary;
}
const turn = (at: number, extra: object = {}) => ({ lastResult: { at, isError: false, ...extra } }) as unknown as Partial<ChatSummary>;
const reported = (outcome: 'done' | 'partial' | 'blocked', at = NOW - 10) => ({ run: { runId: 'r', goal: 'g', startedAt: 1, report: { outcome, at } }, ...turn(at) }) as unknown as Partial<ChatSummary>;
const kid = (id: string, extra: Partial<ChatSummary> = {}) => chat(id, { parentId: 'own', ...extra });
const step = (state: PlanStep['state'], chatIds?: string[], extra: Partial<PlanStep> = {}): PlanStep => ({ title: 'Passo', state, ...(chatIds ? { chatIds } : {}), ...extra });
function map(steps: PlanStep[], extra: Partial<WorkMap> = {}): WorkMap {
  const plan: StrategyPlan = { phase: 'running', at: 100, clarified: [], steps };
  return settle({ id: 'wm_live01', version: 3, title: 'Sconti', touches: [], plan, owner: { chatId: 'own', task: 't' }, createdAt: 1, updatedAt: 500, by: 'app', summary: '', ...extra });
}
const ask = (chatId: string): PendingRequest => ({ id: `q-${chatId}`, chatId, type: 'question', title: '?', at: 1 }) as unknown as PendingRequest;
function live(m: WorkMap, chats: ChatSummary[], x: Partial<LiveInput> = {}): { boxes: (WorkBoxLive | undefined)[]; map: WorkMapLive | undefined } {
  return liveOf(m, { chats, asks: [], now: NOW, confirmed: () => undefined, crashed: false, ...x });
}
/** One step under way whose only chat is this. */
const one = (k: ChatSummary | null, x: Partial<LiveInput> = {}) => live(map([step('now', ['k'])]), [chat('own', turn(NOW - 5)), ...(k ? [k] : [])], x);

describe('a step follows its chat', () => {
  it('starts: at work, on the step and on the map\'s row', () => {
    const l = one(kid('k', { state: 'running' }));
    expect(l.boxes[0]).toEqual({ say: 'working', chats: [{ chatId: 'k', title: 'Chat k', say: 'working', n: 1 }] });
    expect(l.map).toMatchObject({ say: 'working', working: [{ chatId: 'k', n: 1 }], waiting: [], failed: [], lost: [] });
    expect(one(kid('k', { state: 'starting' })).boxes[0]!.say).toBe('working');
    // its turn is over and its own background work goes on
    expect(one(kid('k', { background: 1 })).boxes[0]!.say).toBe('working');
  });

  it('waits for the user: an open request, or its last answer says so', () => {
    for (const l of [one(kid('k', { state: 'waiting', pending: 1 })), one(kid('k', { state: 'running' }), { asks: [ask('k')] }), one(kid('k', { waitsOn: 'user', ...turn(NOW - 5) }))]) {
      expect(l.boxes[0]).toMatchObject({ say: 'waiting', waits: 'user' });
      expect(l.map).toMatchObject({ say: 'waiting', waits: 'user', waiting: [{ chatId: 'k', waits: 'user' }], working: [] });
    }
  });

  it('waits for the chat that delegated it, for colleagues, for work still running', () => {
    expect(one(kid('k', { askedParentAt: NOW - 9, ...turn(NOW - 5) })).boxes[0]).toMatchObject({ say: 'waiting', waits: 'parent' });
    expect(one(kid('k', { waitsOn: 'colleagues', ...turn(NOW - 5) })).map).toMatchObject({ say: 'waiting', waits: 'colleagues' });
    expect(one(kid('k', { waitsOnWork: true, ...turn(NOW - 5) } as Partial<ChatSummary>)).boxes[0]).toMatchObject({ say: 'waiting', waits: 'work' });
  });

  it('fails: its turn ended on an error, or its engine died', () => {
    for (const k of [kid('k', turn(NOW - 5, { isError: true })), kid('k', { state: 'error' })]) {
      const l = one(k);
      expect(l.boxes[0]).toMatchObject({ say: 'failed' });
      expect(l.map).toMatchObject({ say: 'failed', failed: [{ chatId: 'k', n: 1 }], working: [] });
    }
  });

  it('is interrupted', () => {
    const l = one(kid('k', turn(NOW - 5, { interrupted: true })));
    expect(l.boxes[0]).toMatchObject({ say: 'interrupted' });
    expect(l.boxes[0]!.stale).toBeUndefined();
  });

  it('reports done, partial or blocked', () => {
    expect(one(kid('k', reported('blocked'))).boxes[0]).toMatchObject({ say: 'blocked' });
    // two chats: one reported, the other goes on
    for (const outcome of ['done', 'partial'] as const) {
      const l = live(map([step('now', ['k', 'j'])]), [chat('own', turn(NOW - 5)), kid('k', reported(outcome)), kid('j', { state: 'running' })]);
      expect(l.boxes[0]).toMatchObject({ say: 'working', chats: [{ chatId: 'j', say: 'working' }, { chatId: 'k', say: outcome }] });
    }
    // all reported and the step still open: the Strategist carries it on
    const its = live(map([step('now', ['k'])]), [chat('own', { state: 'running' }), kid('k', reported('done'))]);
    expect(its.boxes[0]).toMatchObject({ say: 'working', chats: [{ chatId: 'own' }, { chatId: 'k', say: 'done' }] });
    // a done step says nothing more than its state
    expect(live(map([step('done', ['k']), step('todo')]), [chat('own', { state: 'running' }), kid('k', reported('done'))]).boxes).toEqual([undefined, undefined]);
  });

  it('works again after its report', () => {
    expect(live(map([step('done', ['k']), step('todo')]), [chat('own', turn(NOW - 5)), kid('k', { ...reported('done'), state: 'running' })]).boxes[0]).toMatchObject({ say: 'working' });
  });

  it('is closed without a report', () => {
    const l = one(kid('k', { state: 'closed', closedAt: NOW - 3, closedBy: 'user' }));
    expect(l.boxes[0]).toMatchObject({ say: 'closed' });
    expect(l.map).toMatchObject({ say: 'closed', lost: [{ chatId: 'k', say: 'closed', n: 1 }] });
    // closed after its report: what it reported
    expect(one(kid('k', { ...reported('partial'), closedAt: NOW - 3, closedBy: 'auto' })).boxes[0]!.chats.find(w => w.chatId === 'k')).toMatchObject({ say: 'partial' });
  });

  it('is dead or missing: gone', () => {
    const l = one(null);
    expect(l.boxes[0]).toMatchObject({ say: 'gone', chats: [{ chatId: 'k', title: '', say: 'gone' }] });
    expect(l.map!.lost).toMatchObject([{ chatId: 'k', say: 'gone' }]);
  });

  it('a step the Strategist does itself shows the Strategist', () => {
    const l = live(map([step('now'), step('todo')]), [chat('own', { state: 'running' })]);
    expect(l.boxes).toEqual([{ say: 'working', chats: [{ chatId: 'own', title: 'Chat own', say: 'working' }] }, undefined]);
  });
});

describe('the chats below', () => {
  const own = chat('own', turn(NOW - 5)), idle = kid('k', turn(NOW - 5));
  it('a grandchild at work counts for the step and the row', () => {
    const l = live(map([step('now', ['k'])]), [own, idle, chat('g', { parentId: 'k', state: 'running' })]);
    expect(l.boxes[0]).toMatchObject({ say: 'working', chats: [{ chatId: 'g', below: true, n: 1 }, { chatId: 'k', say: 'between' }] });
    expect(l.map).toMatchObject({ say: 'working', working: [{ chatId: 'g', below: true }] });
  });
  it('a grandchild that waits for the user is what the step shows', () => {
    const l = live(map([step('now', ['k'])]), [own, kid('k', { state: 'running' }), chat('g', { parentId: 'k', state: 'waiting', pending: 1 })]);
    expect(l.map).toMatchObject({ say: 'waiting', waits: 'user', working: [{ chatId: 'k' }], waiting: [{ chatId: 'g' }] });
    expect(l.boxes[0]).toMatchObject({ say: 'waiting', waits: 'user' });
  });
  it('a grandchild that failed does not hide that its parent works', () => {
    expect(live(map([step('now', ['k'])]), [own, kid('k', { state: 'running' }), chat('g', { parentId: 'k', state: 'error' })]).boxes[0]).toMatchObject({ say: 'working' });
  });
  it('one step that failed does not hide who works on another, and stays in the counts', () => {
    const l = live(map([step('now', ['k']), step('now', ['j'])]), [own, kid('k', turn(NOW - 5, { isError: true })), kid('j', { state: 'running' })]);
    expect(l.map).toMatchObject({ say: 'working', working: [{ chatId: 'j', n: 2 }], failed: [{ chatId: 'k', n: 1 }] });
  });
  it('a chat delegated outside the steps works for the job too', () => {
    expect(live(map([step('todo')]), [own, kid('x', { state: 'running' })]).map).toMatchObject({ say: 'working', working: [{ chatId: 'x' }] });
  });
  it('movesBelow: something under way below, at any depth', () => {
    expect(movesBelow('own', [own, idle, chat('g', { parentId: 'k', state: 'running' })], [])).toBe(true);
    expect(movesBelow('own', [own, idle], [])).toBe(false);
    expect(movesBelow('own', [own, kid('k', { state: 'running', closedAt: 4 })], [])).toBe(false);
  });
});

describe('what nobody can vouch for is stale, with its time', () => {
  it('after a restart: unknown, not confirmed since it was last seen', () => {
    const l = one(kid('k', { state: 'closed' }), { confirmed: id => (id === 'k' ? NOW - 7000 : undefined) });
    expect(l.boxes[0]).toMatchObject({ say: 'unknown', stale: NOW - 7000 });
    expect(l.map).toMatchObject({ stale: NOW - 7000 });
    expect(liveWords(l.boxes[0]!)).toBe(`unknown, not confirmed since ${new Date(NOW - 7000).toISOString()}`);
  });
  it('never seen: since the step started', () => {
    expect(live(map([step('now', ['k'], { startedAt: 321 })]), [chat('own', turn(NOW - 5)), kid('k', { state: 'closed' })]).boxes[0]).toMatchObject({ say: 'unknown', stale: 321 });
  });
  it('a turn over with no report is taken at its word for a while only', () => {
    expect(one(kid('k', turn(NOW - STALE_MS))).boxes[0]).toEqual(expect.not.objectContaining({ stale: expect.anything() }));
    expect(one(kid('k', turn(NOW - STALE_MS - 1))).boxes[0]).toMatchObject({ say: 'between', stale: NOW - STALE_MS - 1 });
  });
  it('a chat at work, or that waits, is never stale', () => {
    for (const k of [kid('k', { state: 'running' }), kid('k', { waitsOn: 'user', ...turn(1) }), kid('k', { state: 'error' })]) expect(one(k).map!.stale).toBeUndefined();
  });
  it('the row of a job with no step under way goes by its owner chat', () => {
    expect(live(map([step('todo')]), [chat('own', turn(5))]).map).toMatchObject({ say: 'between', stale: 5 });
    expect(live(map([step('todo')]), [chat('own', { state: 'running' })]).map!.stale).toBeUndefined();
  });
  it('a chat that reported is never read again as unknown', () => {
    expect(readingOf(kid('k', { ...reported('done'), state: 'closed' }), [])).toEqual({ say: 'done' });
  });
});

describe('a stopped map says why', () => {
  const m = (by: 'user' | 'closed' | 'gone' | 'replaced') => map([step('now', ['k'])], { stopped: { at: 400, by } });
  const why = (x: WorkMap, chats: ChatSummary[], i: Partial<LiveInput> = {}) => live(x, chats, i).map?.why;
  it('by the user, replaced', () => {
    expect(why(m('user'), [chat('own')])).toBe('user');
    expect(why(m('replaced'), [chat('own', { state: 'running' })])).toBe('replaced');
  });
  it('closed by the user, by the app, its engine dead', () => {
    expect(why(m('closed'), [chat('own', { closedAt: 400, closedBy: 'user' })])).toBe('closedByUser');
    expect(why(m('closed'), [chat('own', { closedAt: 400, closedBy: 'auto' })])).toBe('closedByApp');
    expect(why(m('closed'), [chat('own', { state: 'error' })], { crashed: true })).toBe('crash');
  });
  it('gone, and who removed it when that was seen', () => {
    expect(why(m('gone'), [])).toBe('gone');
    expect(why(m('gone'), [], { removedBy: 'user' })).toBe('closedByUser');
    expect(why(m('gone'), [], { removedBy: 'agent' })).toBe('closedByAgent');
  });
  it('a stopped map still says who works for it', () => {
    expect(live(m('user'), [chat('own'), kid('k', { state: 'running' })]).map).toMatchObject({ why: 'user', working: [{ chatId: 'k' }] });
    expect(live(m('user'), [chat('own'), kid('k', { state: 'running' })]).map!.say).toBeUndefined();
  });
  it('a map of an idea alone, or finished with nothing moving, has no live status', () => {
    const { owner: _o, plan: _p, ...bare } = map([]);
    expect(live(settle(bare as WorkMap), []).map).toBeUndefined();
    expect(live(map([step('done', ['k'])], { finishedAt: 5 }), [chat('own', { closedAt: 6 })]).map).toBeUndefined();
  });
});
