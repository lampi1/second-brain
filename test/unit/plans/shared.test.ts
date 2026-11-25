// Unit tests of shared/plan.ts (ADR 0361): the state a record is in, what can be done on it, the steps as the page shows them
// (turn, what each waits for, what it opens), the list row with its percentage, the text for an agent and the lenient reader
// of a saved file.
import { describe, expect, it } from 'vitest';
import type { PlanPhase, StrategyPlan } from '../../../src/shared/strategy';
import type { PlanStep } from '../../../src/shared/plan-steps';
import { readPlanRecord, PLAN_STATES, planActions, planInfo, planStateOf, planText, stepViews, type Plan } from '../../../src/shared/plan';

let seq = 0;
const step = (title: string, state: PlanStep['state'] = 'todo', extra: Partial<PlanStep> = {}): PlanStep => ({ id: `s${++seq}`, title, state, ...(state === 'done' && !extra.proof ? { proof: { at: 1, by: 'report' as const, text: 'ok' } } : {}), ...extra });
const plan = (phase: PlanPhase, steps: PlanStep[] = [step('Uno'), step('Due')]): StrategyPlan => ({ phase, at: 50, clarified: [], steps });
const map = (extra: Partial<Plan> = {}): Plan => {
  const m: Plan = { id: 'pl_abc123', version: 1, title: 'Sconti', constraints: [], links: [], state: 'idea', createdAt: 10, updatedAt: 20, by: 'app', summary: 's', ...extra };
  return { ...m, state: planStateOf(m) };
};
const owner = { chatId: 'c1', task: 't1' };

describe('planStateOf', () => {
  it('follows the plan phase, then what happened to the plan', () => {
    expect(map().state).toBe('idea');
    expect(map({ owner }).state).toBe('running');
    const of = (p: StrategyPlan, extra: Partial<Plan> = {}) => map({ owner, plan: p, ...extra }).state;
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

describe('planActions', () => {
  it('approve and start are two actions, on two states', () => {
    expect(planActions(map({ owner, plan: plan('proposed') }))).toEqual(['approve', 'keep', 'replan', 'archive']);
    expect(planActions(map({ owner, plan: plan('approved') }))).toEqual(['start', 'replan', 'archive']);
  });
  it('a plan under way is stopped or replanned, never put away', () => {
    expect(planActions(map({ owner, plan: plan('running') }))).toEqual(['stop', 'replan']);
    expect(planActions(map({ owner }))).toEqual(['stop']);
    expect(planActions(map({ owner, plan: plan('proposed', [step('Uno', 'now')]) }))).toEqual(['approve', 'keep', 'replan', 'stop']);
  });
  it('an idea starts, a stopped plan resumes, a finished one is seen, an archived one reopens, a deleted one is restored', () => {
    expect(planActions(map())).toEqual(['start', 'archive']);
    expect(planActions(map({ owner, plan: plan('asking', []) }))).toEqual(['stop', 'replan', 'archive']);
    expect(planActions(map({ owner, stopped: { at: 1, by: 'gone' } }))).toEqual(['resume', 'archive']);
    expect(planActions(map({ owner, plan: plan('done'), finishedAt: 9 }))).toEqual(['seen', 'replan', 'archive']);
    expect(planActions(map({ owner, plan: plan('done'), finishedAt: 9, seenAt: 10 }))).toEqual(['replan', 'archive']);
    expect(planActions(map({ archivedAt: 9 }))).toEqual(['reopen', 'delete']);
    expect(planActions(map({ deletedAt: 9 }))).toEqual(['restore']);
  });
});

describe('the steps as shown', () => {
  it('every step has its turn, what it waits for and what it opens; steps of one turn run together; never a model', () => {
    const a = step('Cerco', 'done', { role: 'scout', chatIds: ['k1'] }), b = step('Faccio', 'now', { role: 'artisan', preset: 'max', after: [a.id] }), c = step('Provo', 'todo', { after: [a.id] }), d = step('Scrivo', 'todo', { after: [b.id, c.id] });
    const v = stepViews(plan('running', [a, b, c, d]));
    expect(v.map(s => [s.n, s.title, s.turn, s.par ?? false, s.state])).toEqual([[1, 'Cerco', 1, false, 'done'], [2, 'Faccio', 2, true, 'now'], [3, 'Provo', 2, true, 'todo'], [4, 'Scrivo', 3, false, 'todo']]);
    expect(v[0]).toMatchObject({ role: 'scout', chatIds: ['k1'], opens: [3] });
    expect(v[0]).not.toHaveProperty('model');
    expect(v[1]).toMatchObject({ role: 'artisan', preset: 'max', after: [1], waitsFor: [] });
    expect(v[3]).toMatchObject({ after: [2, 3], waitsFor: [2, 3] });
  });
  it('a step the replan takes away is shown, apart', () => {
    const v = stepViews(plan('proposed', [step('Cerco', 'done'), step('Faccio'), step('Via', 'now', { drop: true })]));
    expect(v[2]).toMatchObject({ title: 'Via', drop: true });
  });
  it('a plan with no steps shows none', () => {
    expect(stepViews(undefined)).toEqual([]);
    expect(stepViews(plan('asking', []))).toEqual([]);
  });
});

describe('the list row and the text', () => {
  it('counts the steps that stay, the percentage, the revision to approve and when a plan replaces one under way', () => {
    const i = planInfo(map({ owner, project: 'negozio', plan: plan('proposed', [step('a', 'done'), step('b', 'now'), step('c', 'blocked'), step('d'), step('e', 'now', { drop: true })]) }));
    expect(i).toMatchObject({ state: 'toApprove', project: 'negozio', ownerChatId: 'c1', planAt: 50, steps: 4, done: 1, now: 1, blocked: 1, percent: 25, replanned: true });
    expect(planInfo(map({ owner, plan: plan('asking', []) }))).toMatchObject({ state: 'idea', planning: true, percent: 0 });
    expect(planInfo(map())).not.toHaveProperty('planning');
    expect(planInfo(map({ deletedAt: 3 })).deleted).toBe(true);
  });
  it('planText tells an agent the state, the percentage, the steps and what can be done now', () => {
    const m = map({ owner, idea: 'Sconti in percentuale', plan: { ...plan('approved', [step('Cerco', 'todo', { role: 'scout', preset: 'max' })]), clarified: [{ q: 'Dove?', a: 'Negli ordini' }] } });
    const text = planText({ record: m, info: planInfo(m), steps: stepViews(m.plan), history: [], questions: [] });
    expect(text).toContain('Sconti (pl_abc123, version 1): approved, kept for later');
    expect(text).toContain('Progress: 0%');
    expect(text).toContain('1. [turn 1] Cerco · da fare · scout · max');
    expect(text).toContain('- Dove? → Negli ordini');
    expect(text).toContain('Now: start, replan, archive');
  });
});

describe('readPlanRecord', () => {
  it('reads back what was saved, with the state worked out again', () => {
    for (const m of [map(), map({ owner, plan: plan('approved'), project: 'negozio', past: ['c0'], from: ['old map'] }), map({ owner, plan: plan('running'), stopped: { at: 5, by: 'closed' } }), map({ owner, plan: plan('done'), finishedAt: 9 }), map({ deletedAt: 4 })]) {
      expect(readPlanRecord(JSON.parse(JSON.stringify(m)), m.id)).toEqual(m);
      expect(PLAN_STATES).toContain(m.state);
    }
    expect(readPlanRecord({ ...map(), state: 'finished' }, 'pl_abc123')!.state).toBe('idea');
  });
  it('leaves out what it does not understand, and refuses what is not a plan', () => {
    expect(readPlanRecord({ ...map(), owner: 'x', stopped: { at: 1, by: 'nobody' }, constraints: 'x', finishedAt: -1, plan: { phase: 'odd' } }, 'pl_abc123')).toEqual(map());
    expect(readPlanRecord(map(), 'pl_other1')).toBeNull();
    expect(readPlanRecord({ ...map(), title: ' ' }, 'pl_abc123')).toBeNull();
    expect(readPlanRecord({ ...map(), version: 0 }, 'pl_abc123')).toBeNull();
    for (const v of [null, 1, [], 'x']) expect(readPlanRecord(v, 'pl_abc123')).toBeNull();
  });
});
