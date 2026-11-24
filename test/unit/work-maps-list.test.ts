// Unit tests of what the work maps' screens know without a screen (lib/work-maps.ts, ADR 0343): the list by status with
// what waits for the user on top and the finished apart, search in both, project filter, sort; the place in the Mappa
// page; which map is a chat's; the buttons, only those of WorkMapInfo.can, and the IPC call of each; the plan in rows.
import { describe, expect, it } from 'vitest';
import { workInfo, workStateOf, WORK_MAP_STATES, type WorkBox, type WorkMap, type WorkMapAction, type WorkMapInfo, type WorkMapState } from '../../src/shared/work-map';
import { allProjects, arrange, buttonsOf, callOf, groupOf, mapOfChat, rowsOf, workPlace, workPlaceOf, WORK_BUTTONS, WORK_GROUPS, WORK_SORTS, type WorkFilter } from '../../src/renderer/lib/work-maps';

const info = (id: string, state: WorkMapState, p: Partial<WorkMapInfo> = {}): WorkMapInfo => ({ id: `wm_${id}`, title: id, touches: [], state, steps: 0, done: 0, now: 0, blocked: 0, createdAt: 1, updatedAt: 1, can: [], ...p });
const F: WorkFilter = { tab: 'open', query: '', project: '', sort: 'recent' };
const shape = (infos: WorkMapInfo[], f: Partial<WorkFilter> = {}) => arrange(infos, { ...F, ...f }).map(g => `${g.group}: ${g.items.map(i => i.title).join(' ')}`);
const ALL: WorkMapState[] = [...WORK_MAP_STATES];

describe('the list by status', () => {
  it('opens on what waits for the user, then under way, stopped, planned, ideas; the finished are apart', () => {
    const infos = [...ALL].reverse().map((s, n) => info(s, s, { updatedAt: n }));
    expect(shape(infos)).toEqual(['wait: toApprove', 'running: running', 'stopped: stopped', 'planned: planned', 'idea: idea']);
    expect(shape(infos, { tab: 'finished' })).toEqual(['finished: archived finished'].map(() => 'finished: finished archived'));
    expect(WORK_GROUPS[0]).toBe('wait');
    expect(ALL.every(state => WORK_GROUPS.includes(groupOf({ state })))).toBe(true);
  });
  it('keeps every map in exactly one section', () => {
    const infos = Array.from({ length: 60 }, (_, n) => info(`m${n}`, ALL[n % ALL.length]!));
    const ids = (['open', 'finished'] as const).flatMap(tab => arrange(infos, { ...F, tab }).flatMap(g => g.items.map(i => i.id)));
    expect(ids.sort()).toEqual(infos.map(i => i.id).sort());
  });
  it('sorts inside each section', () => {
    const infos = [info('b', 'running', { updatedAt: 2, steps: 4, done: 1 }), info('a', 'running', { updatedAt: 3, steps: 2, done: 2 }), info('c', 'running', { updatedAt: 1 })];
    expect(Object.fromEntries(WORK_SORTS.map(sort => [sort, shape(infos, { sort })[0]]))).toEqual({
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
    expect(workPlaceOf(workPlace())).toEqual({ id: null });
    expect(workPlaceOf(workPlace('wm_abcdef'))).toEqual({ id: 'wm_abcdef' });
    expect(workPlaceOf('lavori/')).toEqual({ id: null });
    for (const other of ['links', 'lavorix', '', null, undefined]) expect(workPlaceOf(other)).toBeNull();
  });
  it('a chat\'s map is the one of the job it is on', () => {
    const left = info('left', 'stopped', { ownerChatId: 'c', stopped: { at: 1, by: 'replaced' } }), put = info('put', 'archived', { ownerChatId: 'c' }), on = info('on', 'running', { ownerChatId: 'c' });
    expect(mapOfChat([left, put, on], 'c')).toBe(on);
    expect(mapOfChat([left, put], 'c')).toBe(put);
    expect(mapOfChat([on], 'other')).toBeNull();
  });
});

describe('buttons and calls', () => {
  it('shows only what WorkMapInfo.can allows, whatever the state says', () => {
    for (const state of ALL) {
      expect(buttonsOf({ ...info('m', state), can: [] })).toEqual([]);
      expect(buttonsOf({ ...info('m', state), can: ['archive', 'approve', 'seen'] })).toEqual(['approve', 'archive']);
    }
  });
  it('draws every action main allows in each state, «seen» apart', () => {
    const base: WorkMap = { id: 'wm_abcdef', version: 1, title: 'M', touches: [], state: 'idea', createdAt: 1, updatedAt: 1, by: 'app', summary: '' };
    const steps = [{ title: 'a', state: 'now' as const }];
    const maps: Partial<WorkMap>[] = [{}, { owner: { chatId: 'c', task: 't' } }, { owner: { chatId: 'c', task: 't' }, stopped: { at: 1, by: 'user' } }, { finishedAt: 1 }, { archivedAt: 1 },
      ...(['asking', 'proposed', 'approved', 'running', 'revising', 'done'] as const).map(phase => ({ owner: { chatId: 'c', task: 't' }, plan: { phase, at: 7, clarified: [], steps } }))];
    for (const p of maps) {
      const m = { ...base, ...p } as WorkMap, i = workInfo({ ...m, state: workStateOf(m) });
      expect([...buttonsOf(i)].sort()).toEqual(i.can.filter(a => a !== 'seen').sort());
      for (const a of buttonsOf(i)) expect(callOf(i, a, 'cambia')?.args.id).toBe('wm_abcdef');
    }
  });
  it('each action is its own IPC call; approving carries the revision on screen', () => {
    const can: WorkMapAction[] = [...WORK_BUTTONS, 'seen'], i = info('m', 'toApprove', { can, planAt: 42 }), id = 'wm_m';
    expect(callOf(i, 'approve')).toEqual({ channel: 'workmap:approve', args: { id, at: 42 } });
    expect(callOf(i, 'keep')).toEqual({ channel: 'workmap:keep', args: { id, at: 42 } });
    expect(callOf(i, 'replan', '  prima i test ')).toEqual({ channel: 'workmap:replan', args: { id, text: 'prima i test' } });
    for (const a of ['start', 'stop', 'resume', 'archive', 'reopen', 'seen'] as const) expect(callOf(i, a)).toEqual({ channel: `workmap:${a}`, args: { id } });
  });
  it('makes no call the map does not allow, with no revision to approve or no words to replan', () => {
    const i = info('m', 'toApprove', { can: ['approve', 'keep', 'replan'] });
    expect(callOf(i, 'start')).toBeNull();
    expect(callOf(i, 'approve')).toBeNull();
    expect(callOf(i, 'keep')).toBeNull();
    expect(callOf(i, 'replan', ' \n')).toBeNull();
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
