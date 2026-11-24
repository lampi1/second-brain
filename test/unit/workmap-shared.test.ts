// Unit tests of shared/work-map.ts (ADR 0342): the state a record is in, what can be done on it, the drawing made from the
// plan's steps, the list row, the text for an agent and the lenient reader of a saved file.
import { describe, expect, it } from 'vitest';
import type { PlanPhase, PlanStep, StrategyPlan } from '../../src/shared/strategy';
import { drawingOf, readWorkMap, WORK_MAP_STATES, workActions, workInfo, workStateOf, workText, type WorkMap } from '../../src/shared/work-map';

const step = (title: string, state: PlanStep['state'] = 'todo', extra: Partial<PlanStep> = {}): PlanStep => ({ title, state, ...extra });
const plan = (phase: PlanPhase, steps: PlanStep[] = [step('Uno'), step('Due')]): StrategyPlan => ({ phase, at: 50, clarified: [], steps });
const map = (extra: Partial<WorkMap> = {}): WorkMap => {
  const m: WorkMap = { id: 'wm_abc123', version: 1, title: 'Sconti', touches: [], state: 'idea', createdAt: 10, updatedAt: 20, by: 'app', summary: 's', ...extra };
  return { ...m, state: workStateOf(m) };
};
const owner = { chatId: 'c1', task: 't1' };

describe('workStateOf', () => {
  it('follows the plan phase, then what happened to the map', () => {
    expect(map().state).toBe('idea');
    expect(map({ owner }).state).toBe('running');
    const of = (p: StrategyPlan, extra: Partial<WorkMap> = {}) => map({ owner, plan: p, ...extra }).state;
    expect(of(plan('asking', []))).toBe('idea');
    expect(of(plan('proposed'))).toBe('toApprove');
    expect(of(plan('revising'))).toBe('idea');
    expect(of(plan('revising', [step('Uno', 'now')]))).toBe('running');
    expect(of(plan('approved'))).toBe('planned');
    expect(of(plan('running'))).toBe('running');
    expect(of(plan('done'))).toBe('finished');
    expect(of(plan('proposed'), { stopped: { at: 1, by: 'closed' } })).toBe('stopped');
    expect(of(plan('running'), { finishedAt: 9, stopped: { at: 1, by: 'user' } })).toBe('finished');
    expect(of(plan('running'), { finishedAt: 9, archivedAt: 10 })).toBe('archived');
  });
});

describe('workActions', () => {
  it('approve and start are two actions, on two states', () => {
    expect(workActions(map({ owner, plan: plan('proposed') }))).toEqual(['approve', 'keep', 'replan', 'archive']);
    expect(workActions(map({ owner, plan: plan('approved') }))).toEqual(['start', 'replan', 'archive']);
  });
  it('a job under way is stopped or replanned, never put away', () => {
    expect(workActions(map({ owner, plan: plan('running') }))).toEqual(['stop', 'replan']);
    expect(workActions(map({ owner }))).toEqual(['stop']);
    expect(workActions(map({ owner, plan: plan('proposed', [step('Uno', 'now')]) }))).toEqual(['approve', 'keep', 'replan', 'stop']);
  });
  it('an idea starts, a stopped job resumes, a finished one is seen, an archived one reopens', () => {
    expect(workActions(map())).toEqual(['start', 'archive']);
    expect(workActions(map({ owner, plan: plan('asking', []) }))).toEqual(['stop', 'replan', 'archive']);
    expect(workActions(map({ owner, stopped: { at: 1, by: 'gone' } }))).toEqual(['resume', 'archive']);
    expect(workActions(map({ owner, plan: plan('done'), finishedAt: 9 }))).toEqual(['seen', 'replan', 'archive']);
    expect(workActions(map({ owner, plan: plan('done'), finishedAt: 9, seenAt: 10 }))).toEqual(['replan', 'archive']);
    expect(workActions(map({ archivedAt: 9 }))).toEqual(['reopen']);
  });
});

describe('the drawing', () => {
  it('has a box per step with role, preset and its turn, never a model; boxes of one turn run together', () => {
    const { boxes, links } = drawingOf(map({ owner, plan: plan('running', [step('Cerco', 'done', { role: 'scout', chatIds: ['k1'] }), step('Faccio', 'now', { role: 'artisan', preset: 'max' }), step('Provo', 'todo', { par: true }), step('Scrivo')]) }));
    expect(boxes.map(b => [b.n, b.title, b.wave, b.par ?? false, b.state])).toEqual([[1, 'Cerco', 1, false, 'done'], [2, 'Faccio', 2, true, 'now'], [3, 'Provo', 2, true, 'todo'], [4, 'Scrivo', 3, false, 'todo']]);
    expect(boxes[0]).toMatchObject({ role: 'scout', chatIds: ['k1'] });
    expect(boxes[0]).not.toHaveProperty('model');
    expect(boxes[1]).toMatchObject({ role: 'artisan', preset: 'max' });
    expect(links).toEqual([{ from: 1, to: 2 }, { from: 1, to: 3 }, { from: 2, to: 4 }, { from: 3, to: 4 }]);
  });
  it('a step the replan takes away is drawn, with no arrow', () => {
    const { boxes, links } = drawingOf(map({ owner, plan: plan('proposed', [step('Cerco', 'done'), step('Faccio'), step('Via', 'now', { drop: true })]) }));
    expect(boxes[2]).toMatchObject({ title: 'Via', drop: true });
    expect(links).toEqual([{ from: 1, to: 2 }]);
  });
  it('a map with no steps is one box, the job itself', () => {
    expect(drawingOf(map()).boxes).toEqual([{ n: 1, title: 'Sconti', wave: 1, state: 'todo', chatIds: [] }]);
    expect(drawingOf(map({ owner })).boxes[0]).toMatchObject({ state: 'now', chatIds: ['c1'] });
    expect(drawingOf(map({ owner, finishedAt: 9, archivedAt: 10 })).boxes[0]).toMatchObject({ state: 'done', endedAt: 9 });
  });
});

describe('the list row and the text', () => {
  it('counts the steps that stay, says the revision to approve and when a plan replaces one under way', () => {
    const i = workInfo(map({ owner, project: 'negozio', plan: plan('proposed', [step('a', 'done'), step('b', 'now'), step('c', 'blocked'), step('d'), step('e', 'now', { drop: true })]) }));
    expect(i).toMatchObject({ state: 'toApprove', project: 'negozio', ownerChatId: 'c1', planAt: 50, steps: 4, done: 1, now: 1, blocked: 1, replanned: true });
    expect(workInfo(map({ owner, plan: plan('asking', []) }))).toMatchObject({ state: 'idea', planning: true });
    expect(workInfo(map())).not.toHaveProperty('planning');
  });
  it('workText tells an agent the state, the steps and what can be done now', () => {
    const m = map({ owner, idea: 'Sconti in percentuale', plan: { ...plan('approved', [step('Cerco', 'todo', { role: 'scout', preset: 'max' })]), clarified: [{ q: 'Dove?', a: 'Negli ordini' }] } });
    const text = workText({ map: m, info: workInfo(m), ...drawingOf(m), history: [], questions: [] });
    expect(text).toContain('Sconti (wm_abc123, version 1): approved, kept for later');
    expect(text).toContain('1. [turn 1] Cerco · todo · scout · max');
    expect(text).toContain('- Dove? → Negli ordini');
    expect(text).toContain('Now: start, replan, archive');
  });
});

describe('readWorkMap', () => {
  it('reads back what was saved, with the state worked out again', () => {
    for (const m of [map(), map({ owner, plan: plan('approved'), project: 'negozio', touches: ['negozio'], past: ['c0'] }), map({ owner, plan: plan('running'), stopped: { at: 5, by: 'closed' } }), map({ owner, plan: plan('done'), finishedAt: 5, seenAt: 6, archivedAt: 7 })]) {
      expect(readWorkMap(JSON.parse(JSON.stringify(m)), m.id)).toEqual(m);
      expect(WORK_MAP_STATES).toContain(m.state);
    }
    expect(readWorkMap({ ...map(), state: 'finished' }, 'wm_abc123')!.state).toBe('idea');
  });
  it('leaves out what it does not understand, and refuses what is not a map', () => {
    expect(readWorkMap({ ...map(), owner: 'x', stopped: { at: 1, by: 'nobody' }, touches: 'x', finishedAt: -1, plan: { phase: 'odd' } }, 'wm_abc123')).toEqual(map());
    expect(readWorkMap(map(), 'wm_other1')).toBeNull();
    expect(readWorkMap({ ...map(), title: ' ' }, 'wm_abc123')).toBeNull();
    expect(readWorkMap({ ...map(), version: 0 }, 'wm_abc123')).toBeNull();
    for (const v of [null, 1, [], 'x']) expect(readWorkMap(v, 'wm_abc123')).toBeNull();
  });
});
