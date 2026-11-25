// Unit tests of what the work maps' screens know without a screen (lib/plans.ts, ADR 0343): the list by status with
// what waits for the user on top and the finished apart, search in both, project filter, sort; the place in the Mappa
// page; which map is a chat's; the buttons, only those of PlanInfo.can, and the IPC call of each; the plan in rows.
import { describe, expect, it } from 'vitest';
import { planInfo, planStateOf, PLAN_STATES, type WorkBox, type Plan, type PlanAction, type PlanInfo, type PlanState } from '../../src/shared/plan';
import { allProjects, arrange, buttonsOf, callOf, chatsOf, earlier, groupOf, heldBy, liveKind, mapOfChat, rowsOf, planPlace, planPlaceOf, PLAN_BUTTONS, WORK_GROUPS, PLAN_SORTS, type PlanFilter } from '../../src/renderer/lib/plans';

const info = (id: string, state: PlanState, p: Partial<PlanInfo> = {}): PlanInfo => ({ id: `wm_${id}`, title: id, touches: [], state, steps: 0, done: 0, now: 0, blocked: 0, createdAt: 1, updatedAt: 1, can: [], ...p });
const F: PlanFilter = { tab: 'open', query: '', project: '', sort: 'recent' };
const shape = (infos: PlanInfo[], f: Partial<PlanFilter> = {}) => arrange(infos, { ...F, ...f }).map(g => `${g.group}: ${g.items.map(i => i.title).join(' ')}`);
const ALL: PlanState[] = [...PLAN_STATES];

describe('the list by status', () => {
  it('opens on what waits for the user, then under way, stopped, planned, ideas; the finished are apart', () => {
    const infos = [...ALL].reverse().map((s, n) => info(s, s, { updatedAt: n }));
    expect(shape(infos)).toEqual(['wait: toApprove', 'running: running', 'stopped: stopped', 'planned: planned', 'idea: idea']);
    expect(shape(infos, { tab: 'finished' })).toEqual(['finished: archived finished'].map(() => 'finished: finished archived'));
    expect(WORK_GROUPS[0]).toBe('wait');
    expect(ALL.every(state => WORK_GROUPS.includes(groupOf({ state })))).toBe(true);
  });
  it('a job under way whose chat waits for the user is with what waits; a question an agent holds is not', () => {
    const live = (waits: 'user' | 'parent' | 'orchestrator') => ({ say: 'waiting' as const, waits, working: [], waiting: [], failed: [], lost: [] });
    const infos = [info('his', 'running', { live: live('user') }), info('held', 'running', { live: live('orchestrator') }), info('parent', 'running', { live: live('parent') }), info('asking', 'idea', { live: live('user') }), info('stop', 'stopped', { live: live('user') })];
    expect(shape(infos)).toEqual(['wait: asking his', 'running: held parent', 'stopped: stop']);
    expect((['user', 'parent', 'orchestrator'] as const).map(w => liveKind({ say: 'waiting', waits: w }))).toEqual(['you', 'wait', 'wait']);
    expect([liveKind({ say: 'working' }), liveKind({ say: 'failed' }), liveKind({ say: 'done' }), liveKind({ say: 'between', stale: 1 })]).toEqual(['work', 'bad', 'ok', 'dim']);
  });
  it('an open doubt holds the approval, the start and nothing else', () => {
    const can: PlanAction[] = ['approve', 'keep', 'start', 'replan'], base = { id: 'wm_1', can, planAt: 5 };
    expect(callOf({ ...base, doubts: { open: 1, total: 2, first: 'Scadono?' } }, 'approve')).toBeNull();
    expect(callOf({ ...base, doubts: { open: 1, total: 2 } }, 'keep')).toBeNull();
    expect(callOf({ ...base, doubts: { open: 1, total: 2 } }, 'start')).toBeNull();
    expect(callOf({ ...base, doubts: { open: 1, total: 2 } }, 'replan', 'Altro')).not.toBeNull();
    expect(callOf({ ...base, doubts: { open: 0, total: 2 } }, 'approve')).not.toBeNull();
    expect([heldBy({ doubts: { open: 2, total: 2, first: 'Scadono?' } }), heldBy({ doubts: { open: 0, total: 2 } }), heldBy({})]).toEqual([{ n: 2, first: 'Scadono?' }, null, null]);
  });
  it('a box carries its chats and those below that move or failed', () => {
    const w = (chatId: string, say: 'working' | 'done' | 'failed', below?: true) => ({ chatId, title: chatId, say, ...(below ? { below } : {}) });
    expect(chatsOf({ chatIds: ['a'], live: { say: 'working', chats: [w('own', 'working'), w('a', 'done'), w('k', 'working', true), w('x', 'done', true), w('f', 'failed', true)] } })).toEqual(['a', 'k', 'f']);
  });
  it('keeps every map in exactly one section', () => {
    const infos = Array.from({ length: 60 }, (_, n) => info(`m${n}`, ALL[n % ALL.length]!));
    const ids = (['open', 'finished'] as const).flatMap(tab => arrange(infos, { ...F, tab }).flatMap(g => g.items.map(i => i.id)));
    expect(ids.sort()).toEqual(infos.map(i => i.id).sort());
  });
  it('sorts inside each section', () => {
    const infos = [info('b', 'running', { updatedAt: 2, steps: 4, done: 1 }), info('a', 'running', { updatedAt: 3, steps: 2, done: 2 }), info('c', 'running', { updatedAt: 1 })];
    expect(Object.fromEntries(PLAN_SORTS.map(sort => [sort, shape(infos, { sort })[0]]))).toEqual({
      recent: 'running: a b c', oldest: 'running: c b a', title: 'running: a b c', progress: 'running: a b c',
    });
  });
  it('filters by project: its label or a project map it touches', () => {
    const infos = [info('one', 'running', { project: 'shop' }), info('two', 'idea', { touches: ['shop', 'app'] }), info('three', 'idea')];
    expect(allProjects(infos)).toEqual(['app', 'shop']);
    expect(shape(infos, { project: 'shop' })).toEqual(['running: one', 'idea: two']);
    expect(shape(infos, { project: 'app' })).toEqual(['idea: two']);
  });
  it('with words looks in the open and in the finished together', () => {
    const infos = [info('now', 'running'), info('old', 'archived')];
    expect(shape(infos, { query: 'x' })).toEqual(['running: now', 'finished: old']);
    expect(shape(infos, { query: 'x', tab: 'finished', project: 'none' })).toEqual([]);
    expect(shape(infos, { query: '  ' })).toEqual(['running: now']);
  });
});

describe('the place of the maps', () => {
  it('reads back', () => {
    expect(planPlaceOf(planPlace())).toEqual({ id: null });
    expect(planPlaceOf(planPlace('wm_abcdef'))).toEqual({ id: 'wm_abcdef' });
    expect(planPlaceOf('lavori/')).toEqual({ id: null });
    for (const other of ['links', 'lavorix', '', null, undefined]) expect(planPlaceOf(other)).toBeNull();
  });
  it('a chat\'s map is the one of the job it is on', () => {
    const left = info('left', 'stopped', { ownerChatId: 'c', stopped: { at: 1, by: 'replaced' } }), put = info('put', 'archived', { ownerChatId: 'c' }), on = info('on', 'running', { ownerChatId: 'c' });
    expect(mapOfChat([left, put, on], 'c')).toBe(on);
    expect(mapOfChat([left, put], 'c')).toBe(put);
    expect(mapOfChat([on], 'other')).toBeNull();
  });
});

describe('buttons and calls', () => {
  it('shows only what PlanInfo.can allows, whatever the state says', () => {
    for (const state of ALL) {
      expect(buttonsOf({ ...info('m', state), can: [] })).toEqual([]);
      expect(buttonsOf({ ...info('m', state), can: ['archive', 'approve', 'seen'] })).toEqual(['approve', 'archive']);
    }
  });
  it('draws every action main allows in each state, «seen» apart', () => {
    const base: Plan = { id: 'wm_abcdef', version: 1, title: 'M', touches: [], state: 'idea', createdAt: 1, updatedAt: 1, by: 'app', summary: '' };
    const steps = [{ title: 'a', state: 'now' as const }];
    const maps: Partial<Plan>[] = [{}, { owner: { chatId: 'c', task: 't' } }, { owner: { chatId: 'c', task: 't' }, stopped: { at: 1, by: 'user' } }, { finishedAt: 1 }, { archivedAt: 1 },
      ...(['asking', 'proposed', 'approved', 'running', 'revising', 'done'] as const).map(phase => ({ owner: { chatId: 'c', task: 't' }, plan: { phase, at: 7, clarified: [], steps } }))];
    for (const p of maps) {
      const m = { ...base, ...p } as Plan, i = planInfo({ ...m, state: planStateOf(m) });
      expect([...buttonsOf(i)].sort()).toEqual(i.can.filter(a => a !== 'seen').sort());
      for (const a of buttonsOf(i)) expect(callOf(i, a, 'cambia')?.args.id).toBe('wm_abcdef');
    }
  });
  it('each action is its own IPC call; approving carries the revision on screen', () => {
    const can: PlanAction[] = [...PLAN_BUTTONS, 'seen'], i = info('m', 'toApprove', { can, planAt: 42 }), id = 'wm_m';
    expect(callOf(i, 'approve')).toEqual({ channel: 'plans:approve', args: { id, at: 42 } });
    expect(callOf(i, 'keep')).toEqual({ channel: 'plans:keep', args: { id, at: 42 } });
    expect(callOf(i, 'replan', '  prima i test ')).toEqual({ channel: 'plans:replan', args: { id, text: 'prima i test' } });
    for (const a of ['start', 'stop', 'resume', 'archive', 'reopen', 'seen'] as const) expect(callOf(i, a)).toEqual({ channel: `plans:${a}`, args: { id } });
  });
  it('makes no call the map does not allow, with no revision to approve or no words to replan', () => {
    const i = info('m', 'toApprove', { can: ['approve', 'keep', 'replan'] });
    expect(callOf(i, 'start')).toBeNull();
    expect(callOf(i, 'approve')).toBeNull();
    expect(callOf(i, 'keep')).toBeNull();
    expect(callOf(i, 'replan', ' \n')).toBeNull();
  });
});

describe('the versions of a map', () => {
  it('list the earlier ones, the newest first: the last is «Adesso», never twice, whatever version is on screen', () => {
    const v = (version: number) => ({ version });
    expect(earlier([v(1), v(2), v(3)]).map(x => x.version)).toEqual([2, 1]);
    expect(earlier([v(3), v(1), v(2)]).map(x => x.version)).toEqual([2, 1]);
    expect(earlier([v(1)])).toEqual([]);
    expect(earlier([])).toEqual([]);
  });
});

describe('the plan in rows', () => {
  it('one row per turn, with its arrows; what a replan takes away is apart', () => {
    const box = (n: number, wave: number, p: Partial<WorkBox> = {}): WorkBox => ({ n, title: `s${n}`, wave, state: 'todo', chatIds: [], ...p });
    const r = rowsOf([box(1, 1), box(2, 2, { par: true }), box(3, 2, { par: true }), box(4, 3), box(5, 2, { drop: true })], [{ from: 1, to: 2 }, { from: 1, to: 3 }, { from: 2, to: 4 }, { from: 3, to: 4 }]);
    expect(r.rows.map(x => [x.wave, x.boxes.map(b => b.n), x.in, x.out])).toEqual([[1, [1], false, true], [2, [2, 3], true, true], [3, [4], true, false]]);
    expect(r.dropped.map(b => b.n)).toEqual([5]);
  });
});
