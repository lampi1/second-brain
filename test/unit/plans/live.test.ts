// Unit tests of main/plans/live.ts (ADR 0342, live status): pure, over plain chat summaries. One test per transition of
// a step's chat (starts, waits and for whom, fails, is interrupted, reports done, partial or blocked, is closed without a
// report, is gone), the chats it delegated, what nobody can vouch for (stale, with its time), why a map is stopped, and the
// questions of its chats (asksOf).
// The same through the service: test/unit/plans/live-service.test.ts.
import { describe, expect, it } from 'vitest';
import type { ChatSummary, PendingRequest } from '../../../src/shared/contract';
import type { StrategyPlan } from '../../../src/shared/strategy';
import type { PlanStep } from '../../../src/shared/plan-steps';
import type { LadderQuestion } from '../../../src/shared/question-ladder';
import { liveWords, type Plan, type PlanLive, type StepLive } from '../../../src/shared/plan';
import { asksOf, liveOf, movesBelow, readingOf, STALE_MS, type LiveInput } from '../../../src/main/plans/live';
import { settle } from '../../../src/main/plans/follow';

const NOW = 10 * 3600_000;
function chat(id: string, extra: Partial<ChatSummary> = {}): ChatSummary {
  return { id, harness: 'claude', origin: 'app', title: `Chat ${id}`, state: 'idle', pending: 0, lastText: '', updatedAt: 0, ...extra } as unknown as ChatSummary;
}
const turn = (at: number, extra: object = {}) => ({ lastResult: { at, isError: false, ...extra } }) as unknown as Partial<ChatSummary>;
const reported = (outcome: 'done' | 'partial' | 'blocked', at = NOW - 10) => ({ run: { runId: 'r', goal: 'g', startedAt: 1, report: { outcome, at } }, ...turn(at) }) as unknown as Partial<ChatSummary>;
const kid = (id: string, extra: Partial<ChatSummary> = {}) => chat(id, { parentId: 'own', ...extra });
let stepSeq = 0;
const step = (state: PlanStep['state'], chatIds?: string[], extra: Partial<PlanStep> = {}): PlanStep => ({ id: `s${++stepSeq}`, title: 'Passo', state, ...(state === 'done' ? { proof: { at: 1, by: 'report' as const, text: 'ok' } } : {}), ...(chatIds ? { chatIds } : {}), ...extra });
function map(steps: PlanStep[], extra: Partial<Plan> = {}): Plan {
  const plan: StrategyPlan = { phase: 'running', at: 100, clarified: [], steps };
  return settle({ id: 'pl_live01', version: 3, title: 'Sconti', constraints: [], links: [], plan, owner: { chatId: 'own', task: 't' }, createdAt: 1, updatedAt: 500, by: 'app', summary: '', ...extra });
}
const ask = (chatId: string): PendingRequest => ({ id: `q-${chatId}`, chatId, type: 'question', title: '?', at: 1 }) as unknown as PendingRequest;
function live(m: Plan, chats: ChatSummary[], x: Partial<LiveInput> = {}): { boxes: (StepLive | undefined)[]; map: PlanLive | undefined } {
  return liveOf(m, { chats, asks: [], now: NOW, confirmed: () => undefined, crashed: false, ...x });
}
/** A question of the chat, held at that level (user = it reached him). */
const asked = (level: LadderQuestion['level'], via: LadderQuestion['via'] = 'message'): Partial<ChatSummary> => ({ questions: [{ id: 'q-1', asks: [{ question: 'Anche i resi?', options: ['Sì', 'No'] }], level, ...(level === 'user' ? {} : { holder: 'own' }), at: 1, levelAt: 1, trail: [], via }] });
/** One step under way whose only chat is this. */
const one = (k: ChatSummary | null, x: Partial<LiveInput> = {}) => live(map([step('now', ['k'])]), [chat('own', turn(NOW - 5)), ...(k ? [k] : [])], x);

describe('the questions of a map', () => {
  const q = (id: string, at: number, extra: Partial<LadderQuestion> = {}): LadderQuestion => ({ id, asks: [{ question: id, options: [] }], level: 'strategist', holder: 'own', at, levelAt: at, trail: [], via: 'message', ...extra });
  const done = (at: number) => ({ answered: { by: 'strategist' as const, name: 'S', answer: 'Sì', why: 'brief', at } });
  it('his first, then the held ones, then the answered, each with its step and its chat', () => {
    const chats = [chat('own', { questions: [q('own-q', 600)] }), kid('k', { questions: [q('old', 10, done(900)), q('his', 700, { level: 'user' })] }), chat('deep', { parentId: 'k', questions: [q('deep-q', 650)] })];
    expect(asksOf(map([step('now', ['k'])]), chats).map(a => [a.question.id, a.chatId, a.n])).toEqual([['his', 'k', 1], ['deep-q', 'deep', 1], ['own-q', 'own', undefined], ['old', 'k', 1]]);
  });
  it('a chat outside the steps counts only in the time of the job; another job\'s chat never', () => {
    const chats = [chat('own', { questions: [q('before', 0), q('after', 5000)] }), kid('x', { questions: [q('in', 50)] }), chat('other', { questions: [q('other-q', 50)] })];
    expect(asksOf(map([step('done')], { createdAt: 1, finishedAt: 1000 }), chats).map(a => a.question.id)).toEqual(['in']);
    expect(asksOf(map([]), []).length).toBe(0);
  });
});

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
    expect(one(kid('k', { ...asked('strategist'), ...turn(NOW - 5) })).boxes[0]).toMatchObject({ say: 'waiting', waits: 'parent' });
    expect(one(kid('k', { waitsOn: 'colleagues', ...turn(NOW - 5) })).map).toMatchObject({ say: 'waiting', waits: 'colleagues' });
    expect(one(kid('k', { waitsOnWork: true, ...turn(NOW - 5) } as Partial<ChatSummary>)).boxes[0]).toMatchObject({ say: 'waiting', waits: 'work' });
  });

  it('a question an agent holds is never the user\'s: it waits for its holder, until it reaches him', () => {
    const says = (k: ChatSummary) => { const b = one(k).boxes[0]!; return [b.say, b.waits]; };
    expect(says(kid('k', { ...asked('strategist'), ...turn(NOW - 5) }))).toEqual(['waiting', 'parent']);
    expect(says(kid('k', { ...asked('orchestrator'), ...turn(NOW - 5) }))).toEqual(['waiting', 'orchestrator']);
    // the engine's own question held open: the chat reads as running, or as waiting, and waits for its holder either way
    for (const state of ['running', 'waiting'] as const) expect(says(kid('k', { state, ...asked('strategist', 'request') }))).toEqual(['waiting', 'parent']);
    // it asked and goes on with other work
    expect(says(kid('k', { state: 'running', ...asked('strategist') }))).toEqual(['working', undefined]);
    // its last answer says it waits: for the one that holds the question
    expect(says(kid('k', { waitsOn: 'user', ...asked('orchestrator'), ...turn(NOW - 5) }))).toEqual(['waiting', 'orchestrator']);
    // it reached him, or a permission of the same chat is his
    expect(says(kid('k', { ...asked('user'), ...turn(NOW - 5) }))).toEqual(['waiting', 'user']);
    expect(says(kid('k', { state: 'waiting', pending: 1, ...asked('strategist', 'request') }))).toEqual(['waiting', 'user']);
    // answered: nothing waits
    const q = asked('strategist').questions!.map(x => ({ ...x, answered: { by: 'strategist' as const, name: 'S', answer: 'Sì', why: 'brief', at: 2 } }));
    expect(says(kid('k', { questions: q, ...turn(NOW - 5) }))).toEqual(['between', undefined]);
    // the words an agent reads
    expect(liveWords({ say: 'waiting', waits: 'orchestrator' })).toBe('waiting for orchestrator');
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
  const why = (x: Plan, chats: ChatSummary[], i: Partial<LiveInput> = {}) => live(x, chats, i).map?.why;
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
    expect(live(settle(bare as Plan), []).map).toBeUndefined();
    expect(live(map([step('done', ['k'])], { finishedAt: 5 }), [chat('own', { closedAt: 6 })]).map).toBeUndefined();
  });
});
