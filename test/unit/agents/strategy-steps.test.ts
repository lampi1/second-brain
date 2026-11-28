// The steps of a Strategist's plan (ADR 0361), rewritten from the tests of the old model (parallel marks, outcomes on done steps,
// a lost chat blocking its step): what a step waits for (`after`) and so which steps run together; what moves a step (a report, a
// reopened chat, the Strategist's own update); that «fatto» needs its proof and a lost chat or a closed plan never changes a step;
// what the app refuses in a delegation (a step that waits, a ready step left out of the call); how old saved plans are read;
// the Strategist's flow text. Pure functions of shared/strategy.ts and shared/plan-steps.ts, then the same on a real ChatManager.
import { describe, expect, it } from 'vitest';
import { stepPresetOf } from '../../../src/main/agents/strategy-tools';
import { progressOf, readySteps, turnsOf, type PlanStep } from '../../../src/shared/plan-steps';
import { afterReopen, afterReport, checkProposal, checkRevision, ENOUGH_QUESTIONS, finishPlan, PARALLEL_RULE, readPlan, STRATEGY_FLOW, stepGate, withDelegated, withStep, type StepReport, type StrategyPlan } from '../../../src/shared/strategy';
import { answerPanel, decide, fixture, PLAN, planOf } from './strategy-fixture';

const proof = { at: 1, by: 'report' as const, text: 'ok' };
const step = (id: string, state: PlanStep['state'] = 'todo', extra: Partial<PlanStep> = {}): PlanStep => ({ id, title: `Passo ${id}`, state, ...(state === 'done' && !extra.proof ? { proof } : {}), ...extra });
const plan = (steps: PlanStep[] = [step('s1', 'todo', { role: 'scout' }), step('s2', 'todo', { role: 'scout', after: ['s1'] }), step('s3', 'todo', { role: 'artisan', after: ['s2'] })], phase: StrategyPlan['phase'] = 'running'): StrategyPlan => ({ phase, at: 1, clarified: [], steps });
const report = (outcome: StepReport['outcome'], at = 9): StepReport => ({ outcome, summary: `fatto: ${outcome}`, at });

describe('what a step waits for', () => {
  it('`after` says it, the steps that wait for nothing run together, and the turns follow from it (ADR 0361)', () => {
    const steps = checkProposal({ steps: [{ title: 'a', after: [] }, { title: 'b', after: [] }, { title: 'c', after: [1, 2] }, { title: 'd', after: [3] }, { title: 'e', after: [3] }, { title: 'f', after: [4, 5] }] }).steps;
    expect(steps.map(x => x.after?.length ?? 0)).toEqual([0, 0, 2, 1, 1, 2]);
    expect(turnsOf(steps)).toEqual([1, 1, 2, 3, 3, 4]);
    expect(readySteps(steps)).toEqual([0, 1]);
    // saved and read back with its links
    const saved: StrategyPlan = { phase: 'running', at: 1, clarified: [], steps };
    expect(readPlan(JSON.parse(JSON.stringify(saved)))!.steps.map(x => x.after)).toEqual(steps.map(x => x.after));
  });
  it('a step with no `after` is refused: the Strategist says so for every step, [] when it starts at once', () => {
    expect(() => checkProposal({ steps: [{ title: 'x' }] })).toThrow(/after/);
    expect(() => checkProposal({ steps: [{ title: 'x', after: 'uno' }] })).toThrow(/after/);
    expect(() => checkProposal({ steps: [{ title: 'x', par: true, after: [] }] })).toThrow(/unknown field par/);
  });
  it('two steps that may run together and touch the same thing are refused; one waiting for the other is fine', () => {
    expect(() => checkProposal({ steps: [{ title: 'a', after: [], touches: ['src/x.ts'] }, { title: 'b', after: [], touches: ['src/x.ts'] }] })).toThrow(/same time and both touch/);
    expect(checkProposal({ steps: [{ title: 'a', after: [], touches: ['src/x.ts'] }, { title: 'b', after: [1], touches: ['src/x.ts'] }] }).steps).toHaveLength(2);
  });
  it('steps that wait for each other in a circle are refused', () => {
    expect(() => checkProposal({ steps: [{ title: 'a', after: [2] }, { title: 'b', after: [1] }] })).toThrow(/circle/);
  });
});

describe('what moves a step', () => {
  it('times are kept; «fatto» needs its proof; every step ended ends the plan; a reopened one reopens it', () => {
    let p = withStep(plan(), 0, 'now', 10);
    expect(p.steps[0]).toMatchObject({ state: 'now', startedAt: 10 });
    expect(() => withStep(p, 0, 'done', 20)).toThrow(/prova/);
    p = withStep(p, 0, 'done', 20, proof);
    expect(p.steps[0]).toMatchObject({ state: 'done', startedAt: 10, endedAt: 20, proof });
    p = withStep(withStep(p, 1, 'done', 30, proof), 2, 'done', 40, proof);
    expect(p.phase).toBe('done');
    p = withStep(p, 2, 'now', 50);
    expect(p.phase).toBe('running');
    expect(p.steps[2]!.endedAt).toBeUndefined();
    expect(p.steps[2]!.proof).toBeUndefined();
  });
  it('a report moves only the step that delegated the chat, and only when every chat of the step reported', () => {
    const p = withDelegated(plan(), 1, ['a', 'b'], 5);
    expect(afterReport(p, 'zz', () => report('done'), 9)).toBe(p);
    expect(afterReport(p, 'a', id => (id === 'a' ? report('done') : undefined), 9)).toBe(p);
    const next = afterReport(p, 'a', id => (id === 'a' ? report('done') : report('partial')), 9);
    expect(next.steps[1]).toMatchObject({ state: 'partial', proof: { by: 'report', chatId: 'a' } });
    expect(afterReport(p, 'a', () => report('done'), 9).steps[1]).toMatchObject({ state: 'done', proof: { text: 'fatto: done' } });
    expect(afterReport(p, 'a', id => (id === 'a' ? report('done') : report('blocked')), 9).steps[1]!.state).toBe('blocked');
  });
  it('a partial report ends the step «in parte» with its proof; the plan can end, and reads back whole', () => {
    const p: StrategyPlan = { phase: 'running', at: 1, clarified: [], steps: [step('s1', 'now', { chatIds: ['a'] })] };
    const done = afterReport(p, 'a', () => report('partial'), 9);
    expect(done.phase).toBe('done');
    expect(done.steps[0]).toMatchObject({ state: 'partial', endedAt: 9, proof: { by: 'report' } });
    expect(readPlan(JSON.parse(JSON.stringify(done)))).toEqual(done);
    expect(progressOf(done.steps).percent).toBe(99 === 99 ? 50 : 0);
    expect(readPlan({ ...done, steps: [{ ...done.steps[0], state: 'odd' }] })).toBeNull();
  });
  it('a chat that works again takes its blocked step back; a step the Strategist blocked itself stays', () => {
    const blocked = afterReport(plan([step('s1', 'now', { chatIds: ['c'] }), step('s2', 'todo')]), 'c', () => report('blocked'), 9);
    expect(blocked.steps[0]!.state).toBe('blocked');
    expect(afterReopen(blocked, 'c').steps[0]).toMatchObject({ state: 'now' });
    const own = plan([step('s1', 'blocked', { chatIds: ['c'] })]);
    expect(afterReopen(own, 'c')).toBe(own);
  });
  it('the Strategist\'s final report ends the plan and changes no step; a stop or a put-away goes with it', () => {
    const p = plan([step('s1', 'done'), step('s2', 'blocked'), step('s3', 'todo')]);
    const done = finishPlan({ ...p, stopped: true, putAway: true }, 20);
    expect(done.phase).toBe('done');
    expect(done.steps.map(s => s.state)).toEqual(['done', 'blocked', 'todo']);
    expect(done.stopped).toBeUndefined();
    expect(done.putAway).toBeUndefined();
    expect(readPlan(done)).toEqual(done);
    expect(progressOf(done.steps).percent).toBe(33);
  });
  it('a reused child moves to the new step; the step it left keeps its state and proof', () => {
    const p: StrategyPlan = { phase: 'done', at: 1, clarified: [], steps: [step('s1', 'done', { chatIds: ['child'] }), step('s2', 'partial', { endedAt: 1, proof })] };
    const next = withDelegated(p, 1, ['child'], 2);
    expect(next.phase).toBe('running');
    expect(next.steps[0]).toMatchObject({ state: 'done', chatIds: [], proof });
    expect(next.steps[1]).toMatchObject({ state: 'now', chatIds: ['child'] });
    expect(next.steps[1]!.endedAt).toBeUndefined();
    expect(next.steps[1]!.proof).toBeUndefined();
    expect(afterReport(next, 'child', () => report('done'), 3).phase).toBe('done');
  });
});

describe('what the app refuses in a delegation', () => {
  const p: StrategyPlan = plan([step('s1', 'todo', { role: 'scout' }), step('s2', 'todo', { role: 'scout' }), step('s3', 'todo'), step('s4', 'todo', { role: 'artisan', after: ['s1', 's2'] })]);
  it('a step that waits for another is refused, and says which', () => {
    expect(stepGate(p, [3])).toMatch(/step 4 waits for step 1, 2, not ended yet/);
    expect(stepGate(p, [3], 'agent_assign_task')).toMatch(/waits for/);
  });
  it('every step a role does that can start now starts in the same call; the Strategist\'s own steps and started ones are aside', () => {
    expect(stepGate(p, [0])).toMatch(/step 2 can start now too.*one call/s);
    expect(stepGate(p, [0, 1])).toBeNull(); // step 3 is the Strategist's own
    expect(stepGate(p, [])).toBeNull();
    // a reused child on one step with agent_assign_task leaves the rest alone
    expect(stepGate(p, [0], 'agent_assign_task')).toBeNull();
    // the second one already started: the first may go alone
    expect(stepGate({ ...p, steps: p.steps.map((x, i) => (i === 1 ? { ...x, state: 'now' as const } : x)) }, [0])).toBeNull();
  });
  it('after the first steps ended, the one that waited may start', () => {
    const ready = { ...p, steps: p.steps.map((x, i) => (i < 2 ? { ...x, state: 'done' as const, proof } : x)) };
    expect(stepGate(ready, [3])).toBeNull();
  });
});

describe('old saved plans and the flow text', () => {
  it('an old plan (no ids, a parallel group, an outcome on a done step) is read into the new model; a step never keeps a model (ADR 0346)', () => {
    const saved = JSON.parse(JSON.stringify({ phase: 'running', at: 1, clarified: [], doneWhen: 'fatto', steps: [
      { title: 'Cerco', role: 'scout', state: 'done', outcome: 'done', chatIds: ['c_1'], startedAt: 2, endedAt: 3, model: 'sonnet-x' },
      { title: 'Cerco ancora', role: 'scout', state: 'todo', par: true },
      { title: 'Applico', role: 'artisan', state: 'todo' },
      { title: 'Provo', role: 'sentinel', state: 'done', outcome: 'partial' },
    ] }));
    const old = readPlan(saved)!;
    expect(old.steps.map(x => x.id)).toEqual(['s1', 's2', 's3', 's4']);
    expect(old.steps.every(x => x.preset === undefined && !('model' in x))).toBe(true);
    // done with no proof is «da verificare»; a partial one is «fatto in parte»; nothing is called done without its proof
    expect(old.steps.map(x => x.state)).toEqual(['check', 'todo', 'todo', 'partial']);
    // the old group (step 2 marked parallel with step 1) is kept: they share the first turn
    expect(turnsOf(old.steps)).toEqual([1, 1, 2, 3]);
    // a revision keeps what started and changes the rest
    const { steps, doneWhen } = checkRevision(old, { steps: [{ keep: 1 }, { keep: 2 }, { keep: 3 }, { keep: 4 }] });
    expect(doneWhen).toBe('fatto');
    expect(steps[0]).toMatchObject({ id: 's1', title: 'Cerco', state: 'check', chatIds: ['c_1'], startedAt: 2, endedAt: 3 });
    // the app fills the preset on every step, never a model: a started one from its chat, the others from the card
    const of = stepPresetOf(id => (id === 'c_1' ? { model: 'sonnet-x', run: { runId: 'r', presetChoice: { preset: 'min' } } } as never : id === 'me' ? { model: 'opus-x' } as never : undefined),
      (_role, preset) => ({ preset: preset ?? 'base' }));
    expect(steps.map(x => of('me', x))).toEqual(['min', 'base', 'base', 'base']);
    expect(of('me', step('s9', 'todo'))).toBeUndefined();
    const next: StrategyPlan = { ...old, phase: 'proposed', steps: steps.map(x => ({ ...x, preset: of('me', x)! })) };
    expect(readPlan(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });
  it('reads a saved plan only when it is whole', () => {
    const p = withDelegated(plan(), 0, ['c_1'], 5);
    expect(readPlan(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(readPlan({ ...p, phase: 'other' })).toBeNull();
    expect(readPlan({ ...p, steps: [{ id: 's1', title: 'x', state: 'now', role: 'wizard' }] })).toBeNull();
    // a retired role (judge) reads as its successor since eca2b5d: a saved plan with it stays readable
    expect(readPlan({ ...p, steps: [{ id: 's1', title: 'x', state: 'now', role: 'judge' }] })?.steps[0]?.role).toBe('sentinel');
    expect(readPlan({ ...p, steps: [{ id: 's1', title: 'x', state: 'now', chatIds: ['../x'] }] })).toBeNull();
    expect(readPlan(null)).toBeNull();
  });
  it('the flow text asks for the most parallelism that is real: what each step waits for and touches, a join, no weaker review, «aggiorna il piano» with revise', () => {
    for (const re of [/`after`/, /`touches`/, /worktree slot, a test node, a local stack/, /Reading, searching and investigating always run in parallel/, /no fewer tests and no weaker review/, /Do not split what one head must hold together/]) expect(PARALLEL_RULE).toMatch(re);
    expect(STRATEGY_FLOW).toContain(PARALLEL_RULE);
    expect(STRATEGY_FLOW).toMatch(/one Sentinel with reviewOf|review of the whole/);
    expect(STRATEGY_FLOW).toMatch(/«aggiorna il piano».*revise: true.*keep/s);
    expect(STRATEGY_FLOW).not.toMatch(/at most \d+ (children|at once)|parallel limit/i);
  });
});

describe('the same on a real chat (ManagerChats)', () => {
  const kids = (f: ReturnType<typeof fixture>, id: string) => f.m.list().filter(c => c.parentId === id);
  const rep = (f: ReturnType<typeof fixture>, id: string, outcome: string) => f.call('agent_report', id, { outcome, summary: 'ok', output: 'o', doneWhen: [{ criterion: 'criterion A', met: outcome === 'done' }] });
  it('a delegated step is under way, done once its chats reported done with their proof, blocked when one did not; plan_update moves its own steps', async () => {
    const f = fixture(), s = await f.root('strategist');
    await answerPanel(f, s.id, 'Vuoi aggiungere vincoli?', ENOUGH_QUESTIONS);
    await f.call('plan_propose', s.id, { steps: [{ title: 'Cerco', role: 'scout', after: [] }, { title: 'Applico', role: 'artisan', after: [1] }, { title: 'Riepilogo', after: [2] }] });
    await decide(f, s.id, 'approve');
    await expect(f.call('agent_delegate', s.id, { tasks: [{ ...f.task('scout', 'Ordini · Dove'), step: 4 }] })).rejects.toThrow(/1 to 3/);
    await expect(f.call('agent_delegate', s.id, { tasks: [{ ...f.task('artisan', 'Ordini · Sconto'), step: 2 }] })).rejects.toThrow(/waits for step 1/);
    await f.call('agent_delegate', s.id, { tasks: [{ ...f.task('scout', 'Ordini · Dove'), step: 1 }, { ...f.task('scout', 'Resi · Dove'), step: 1 }] });
    const k = kids(f, s.id);
    expect(planOf(f, s.id).steps.map(x => x.state)).toEqual(['now', 'todo', 'todo']);
    expect(planOf(f, s.id).steps[0]!.chatIds).toEqual([k[0]!.id, k[1]!.id]);
    await rep(f, k[0]!.id, 'done');
    expect(planOf(f, s.id).steps[0]!.state).toBe('now'); // its sibling still works
    await rep(f, k[1]!.id, 'done');
    expect(planOf(f, s.id).steps[0]).toMatchObject({ state: 'done', proof: { by: 'report' } });
    expect(planOf(f, s.id).steps[0]!.endedAt).toBeGreaterThan(0);
    await f.call('agent_delegate', s.id, { tasks: [{ ...f.task('artisan', 'Ordini · Sconto'), step: 2 }] });
    await rep(f, kids(f, s.id)[2]!.id, 'blocked');
    expect(planOf(f, s.id).steps[1]!.state).toBe('blocked');
    await expect(f.call('plan_update', s.id, { step: 2, state: 'done' })).rejects.toThrow(/proof/);
    await f.call('plan_update', s.id, { step: 2, state: 'done', proof: 'riletto a mano: gli sconti tornano' });
    await expect(f.call('plan_update', s.id, { step: 3, state: 'finished' })).rejects.toThrow(/state/);
    const out = await f.call('plan_update', s.id, { step: 3, state: 'done', proof: 'scritto' });
    expect(out).toMatchObject({ done: 3, of: 3, finished: true });
    expect(planOf(f, s.id).phase).toBe('done');
  });
  it('a step whose sibling chat was closed without a result stays as it was, and its chat says it was closed', async () => {
    const f = fixture(), s = await f.root('strategist');
    await answerPanel(f, s.id, 'Vuoi aggiungere vincoli?', ENOUGH_QUESTIONS);
    await f.call('plan_propose', s.id, PLAN);
    await decide(f, s.id, 'approve');
    await f.call('agent_delegate', s.id, { tasks: [{ ...f.task('scout', 'Ordini · Dove'), step: 1 }, { ...f.task('scout', 'Resi · Dove'), step: 1 }] });
    const k = kids(f, s.id);
    await f.m.close(k[1]!.id);
    await rep(f, k[0]!.id, 'done');
    expect(planOf(f, s.id).steps[0]!.state).toBe('now');
  });
  it('steps that wait for nothing start in one call: a call that leaves one out is refused, the whole group starts, and the next step is its own call', async () => {
    const f = fixture(), s = await f.root('strategist');
    await answerPanel(f, s.id, 'Vuoi aggiungere vincoli?', ENOUGH_QUESTIONS);
    await f.call('plan_propose', s.id, { steps: [{ title: 'Cerco negli ordini', role: 'scout', after: [] }, { title: 'Cerco nei resi', role: 'scout', after: [] }, { title: 'Applico', role: 'artisan', after: [1, 2] }] });
    await decide(f, s.id, 'approve');
    await expect(f.call('agent_delegate', s.id, { tasks: [{ ...f.task('scout', 'Ordini · Dove'), step: 1 }] })).rejects.toThrow(/step 2 can start now too.*one call/s);
    expect(kids(f, s.id)).toEqual([]);
    await f.call('agent_delegate', s.id, { tasks: [{ ...f.task('scout', 'Ordini · Dove'), step: 1 }, { ...f.task('scout', 'Resi · Dove'), step: 2 }] });
    expect(planOf(f, s.id).steps.map(x => x.state)).toEqual(['now', 'now', 'todo']);
    const k = kids(f, s.id);
    await expect(f.call('agent_delegate', s.id, { tasks: [{ ...f.task('artisan', 'Ordini · Sconto'), step: 3 }] })).rejects.toThrow(/waits for step 1, 2/);
    await rep(f, k[0]!.id, 'done'); await rep(f, k[1]!.id, 'done');
    await f.call('agent_delegate', s.id, { tasks: [{ ...f.task('artisan', 'Ordini · Sconto'), step: 3 }] });
    expect(planOf(f, s.id).steps[2]!.state).toBe('now');
  });
});
