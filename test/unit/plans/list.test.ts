// Unit tests of what the plans' screens know without a screen (lib/plans.ts, ADR 0361): the list by group with what waits
// for the user on top and the finished last, the project filter, sort; which plan is a chat's; the buttons, only those of
// PlanInfo.can, and the IPC call of each; the steps in turns (what runs together).
import { describe, expect, it } from 'vitest';
import { planInfo, planStateOf, PLAN_STATES, type Plan, type PlanAction, type PlanInfo, type PlanState, type PlanStepView } from '../../../src/shared/plan';
import { allProjects, arrange, buttonsOf, callOf, chatsOf, earlier, groupOf, heldBy, liveKind, mapOfChat, turnsOf, PLAN_BUTTONS, PLAN_GROUPS, PLAN_SORTS, type PlanFilter } from '../../../src/renderer/lib/plans';

const info = (id: string, state: PlanState, p: Partial<PlanInfo> = {}): PlanInfo => ({ id: `pl_${id}`, title: id, state, steps: 0, done: 0, now: 0, blocked: 0, partial: 0, check: 0, percent: 0, ready: 0, createdAt: 1, updatedAt: 1, can: [], ...p });
const F: PlanFilter = { trash: false, query: '', project: '', sort: 'recent' };
const shape = (infos: PlanInfo[], f: Partial<PlanFilter> = {}) => arrange(infos, { ...F, ...f }).map(g => `${g.group}: ${g.items.map(i => i.title).join(' ')}`);
const ALL: PlanState[] = [...PLAN_STATES];

describe('the list by group', () => {
  it('opens on what waits for the user, then under way, stopped, ideas; the finished are last', () => {
    const infos = [...ALL].reverse().map((s, n) => info(s, s, { updatedAt: n }));
    expect(shape(infos)).toEqual(['wait: toApprove', 'running: running', 'stopped: stopped', 'idea: idea planned', 'finished: finished archived']);
    expect(PLAN_GROUPS[0]).toBe('wait');
    expect(PLAN_GROUPS[PLAN_GROUPS.length - 1]).toBe('finished');
    expect(ALL.every(state => PLAN_GROUPS.includes(groupOf({ state })))).toBe(true);
  });
  it('a plan under way whose chat waits for the user is with what waits; a question an agent holds is not', () => {
    const live = (waits: 'user' | 'parent' | 'orchestrator') => ({ say: 'waiting' as const, waits, working: [], waiting: [], failed: [], lost: [] });
    const infos = [info('his', 'running', { live: live('user') }), info('held', 'running', { live: live('orchestrator') }), info('parent', 'running', { live: live('parent') }), info('asking', 'idea', { live: live('user') }), info('stop', 'stopped', { live: live('user') })];
    expect(shape(infos)).toEqual(['wait: asking his', 'running: held parent', 'stopped: stop']);
    expect((['user', 'parent', 'orchestrator'] as const).map(w => liveKind({ say: 'waiting', waits: w }))).toEqual(['you', 'wait', 'wait']);
    expect([liveKind({ say: 'working' }), liveKind({ say: 'failed' }), liveKind({ say: 'done' }), liveKind({ say: 'between', stale: 1 })]).toEqual(['work', 'bad', 'ok', 'dim']);
  });
  it('an open doubt holds the approval, the start and nothing else', () => {
    const can: PlanAction[] = ['approve', 'keep', 'start', 'replan'], base = { id: 'pl_1', can, planAt: 5 };
    expect(callOf({ ...base, doubts: { open: 1, total: 2, first: 'Scadono?' } }, 'approve')).toBeNull();
    expect(callOf({ ...base, doubts: { open: 1, total: 2 } }, 'keep')).toBeNull();
    expect(callOf({ ...base, doubts: { open: 1, total: 2 } }, 'start')).toBeNull();
    expect(callOf({ ...base, doubts: { open: 1, total: 2 } }, 'replan', 'Altro')).not.toBeNull();
    expect(callOf({ ...base, doubts: { open: 0, total: 2 } }, 'approve')).not.toBeNull();
    expect([heldBy({ doubts: { open: 2, total: 2, first: 'Scadono?' } }), heldBy({ doubts: { open: 0, total: 2 } }), heldBy({})]).toEqual([{ n: 2, first: 'Scadono?' }, null, null]);
  });
  it('a step carries its chats and those below that move or failed', () => {
    const w = (chatId: string, say: 'working' | 'done' | 'failed', below?: true) => ({ chatId, title: chatId, say, ...(below ? { below } : {}) });
    expect(chatsOf({ chatIds: ['a'], live: { say: 'working', chats: [w('own', 'working'), w('a', 'done'), w('k', 'working', true), w('x', 'done', true), w('f', 'failed', true)] } })).toEqual(['a', 'k', 'f']);
  });
  it('keeps every plan in exactly one group', () => {
    const infos = Array.from({ length: 60 }, (_, n) => info(`m${n}`, ALL[n % ALL.length]!));
    const ids = arrange(infos, F).flatMap(g => g.items.map(i => i.id));
    expect(ids.sort()).toEqual(infos.map(i => i.id).sort());
  });
  it('sorts inside each group; by progress the most advanced is first', () => {
    const infos = [info('b', 'running', { updatedAt: 2, steps: 4, done: 2, percent: 50 }), info('a', 'running', { updatedAt: 3, steps: 2, done: 2, percent: 99 }), info('c', 'running', { updatedAt: 1 })];
    expect(Object.fromEntries(PLAN_SORTS.map(sort => [sort, shape(infos, { sort })[0]]))).toEqual({
      recent: 'running: a b c', oldest: 'running: c b a', title: 'running: a b c', progress: 'running: a b c',
    });
  });
  it('filters by project', () => {
    const infos = [info('one', 'running', { project: 'shop' }), info('two', 'idea', { project: 'shop' }), info('three', 'idea', { project: 'app' }), info('four', 'idea')];
    expect(allProjects(infos)).toEqual(['app', 'shop']);
    expect(shape(infos, { project: 'shop' })).toEqual(['running: one', 'idea: two']);
    expect(shape(infos, { project: 'app' })).toEqual(['idea: three']);
  });
  it('the trash is its own flat list and never mixed with the others', () => {
    const infos = [info('live', 'running'), info('gone', 'idea', { deleted: true }), info('gone2', 'finished', { deleted: true, updatedAt: 5 })];
    expect(shape(infos)).toEqual(['running: live']);
    expect(shape(infos, { trash: true })).toEqual(['finished: gone2 gone']);
  });
});

describe('a chat\'s plan', () => {
  it('is the one of the job it is on, never a replaced one while another is on', () => {
    const left = info('left', 'stopped', { ownerChatId: 'c', stopped: { at: 1, by: 'replaced' } }), put = info('put', 'archived', { ownerChatId: 'c' }), on = info('on', 'running', { ownerChatId: 'c' });
    expect(mapOfChat([left, put, on], 'c')).toBe(on);
    expect(mapOfChat([left, put], 'c')).toBe(put);
    expect(mapOfChat([on], 'other')).toBeNull();
    expect(mapOfChat([{ ...on, deleted: true }], 'c')).toBeNull();
  });
});

describe('buttons and calls', () => {
  it('shows only what PlanInfo.can allows, whatever the state says', () => {
    for (const state of ALL) {
      expect(buttonsOf({ ...info('m', state), can: [] })).toEqual([]);
      expect(buttonsOf({ ...info('m', state), can: ['archive', 'approve', 'seen'] })).toEqual(['approve', 'archive']);
    }
  });
  it('draws every action the model allows in each state, «seen» apart', () => {
    const base = { id: 'pl_abcdef', version: 1, title: 'M', state: 'idea', createdAt: 1, updatedAt: 1, by: 'app', summary: '' } as unknown as Plan;
    const steps = [{ id: 's1', title: 'a', state: 'now' as const }];
    const plans: Partial<Plan>[] = [{}, { owner: { chatId: 'c', task: 't' } }, { owner: { chatId: 'c', task: 't' }, stopped: { at: 1, by: 'user' } }, { finishedAt: 1 }, { archivedAt: 1 }, { deletedAt: 1 },
      ...(['asking', 'proposed', 'approved', 'running', 'revising', 'done'] as const).map(phase => ({ owner: { chatId: 'c', task: 't' }, plan: { phase, at: 7, clarified: [], steps } }))] as Partial<Plan>[];
    for (const p of plans) {
      const m = { ...base, ...p } as Plan, i = planInfo({ ...m, state: planStateOf(m) });
      expect([...buttonsOf(i)].sort()).toEqual(i.can.filter(a => a !== 'seen').sort());
      for (const a of buttonsOf(i)) expect(callOf(i, a, 'cambia')?.args.id).toBe('pl_abcdef');
    }
  });
  it('each action is its own IPC call; approving carries the revision on screen', () => {
    const can: PlanAction[] = [...PLAN_BUTTONS, 'seen'], i = info('m', 'toApprove', { can, planAt: 42 }), id = 'pl_m';
    expect(callOf(i, 'approve')).toEqual({ channel: 'plans:approve', args: { id, at: 42 } });
    expect(callOf(i, 'keep')).toEqual({ channel: 'plans:keep', args: { id, at: 42 } });
    expect(callOf(i, 'replan', '  prima i test ')).toEqual({ channel: 'plans:replan', args: { id, text: 'prima i test' } });
    for (const a of ['start', 'stop', 'resume', 'archive', 'reopen', 'seen', 'delete', 'restore'] as const) expect(callOf(i, a)).toEqual({ channel: `plans:${a}`, args: { id } });
  });
  it('makes no call the plan does not allow, with no revision to approve or no words to replan', () => {
    const i = info('m', 'toApprove', { can: ['approve', 'keep', 'replan'] });
    expect(callOf(i, 'start')).toBeNull();
    expect(callOf(i, 'approve')).toBeNull();
    expect(callOf(i, 'keep')).toBeNull();
    expect(callOf(i, 'replan', ' \n')).toBeNull();
  });
});

describe('the versions of a plan', () => {
  it('list the earlier ones, the newest first: the last is «Adesso», never twice, whatever version is on screen', () => {
    const v = (version: number) => ({ version });
    expect(earlier([v(1), v(2), v(3)]).map(x => x.version)).toEqual([2, 1]);
    expect(earlier([v(3), v(1), v(2)]).map(x => x.version)).toEqual([2, 1]);
    expect(earlier([v(1)])).toEqual([]);
    expect(earlier([])).toEqual([]);
  });
});

describe('the steps in turns', () => {
  it('one turn per row; steps of one turn run together; what a replan takes away is apart', () => {
    const step = (n: number, turn: number, p: Partial<PlanStepView> = {}): PlanStepView => ({ n, id: `s${n}`, title: `s${n}`, turn, state: 'todo', after: [], waitsFor: [], opens: [], touches: [], chatIds: [], ...p });
    const r = turnsOf([step(1, 1), step(2, 2), step(3, 2), step(4, 3), step(5, 2, { drop: true })]);
    expect(r.turns.map(t => [t.turn, t.steps.map(s => s.n), t.together])).toEqual([[1, [1], false], [2, [2, 3], true], [3, [4], false]]);
    expect(r.dropped.map(s => s.n)).toEqual([5]);
    expect(r.lanes).toBe(2);
  });
});
