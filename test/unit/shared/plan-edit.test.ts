// Editing the steps of a plan by explicit operations (shared/plan-edit.ts, ADR 0363): a save names what changes and nothing
// else changes; a step goes only by its own «remove» (never one that started) or «cancel»; «fatto» comes with a proof; all the
// operations of a save apply together or none does; a circle or two steps that may run together on the same thing are refused.
import { describe, expect, it } from 'vitest';
import { applySteps, type StepOp } from '../../../src/shared/plan-edit';
import type { PlanStep } from '../../../src/shared/plan-steps';
import type { StrategyPlan } from '../../../src/shared/strategy';

const s = (id: string, state: PlanStep['state'] = 'todo', extra: Partial<PlanStep> = {}): PlanStep => ({ id, title: `Passo ${id}`, state, ...(state === 'done' && !extra.proof ? { proof: { at: 1, by: 'report' as const, text: 'ok' } } : {}), ...extra });
const plan = (steps: PlanStep[], phase: StrategyPlan['phase'] = 'proposed'): StrategyPlan => ({ phase, at: 5, clarified: [{ q: 'Dove?', a: 'Negli ordini' }], steps });
const base = () => plan([s('s1', 'done'), s('s2', 'now', { chatIds: ['c1'] }), s('s3', 'todo', { after: ['s2'] }), s('s4', 'todo', { after: ['s2'] })], 'running');
const apply = (ops: StepOp[], p = base()) => applySteps(p, ops, 100);
const ids = (p: StrategyPlan) => p.steps.map(x => x.id);

describe('what a save changes', () => {
  it('changes only what it names: every other step, the answers and the plan itself stay as they were', () => {
    const before = base();
    const after = apply([{ op: 'set', step: 3, title: 'Applico lo sconto' }]);
    expect(after.steps[2]).toMatchObject({ id: 's3', title: 'Applico lo sconto', state: 'todo', after: ['s2'] });
    expect([after.steps[0], after.steps[1], after.steps[3]]).toEqual([before.steps[0], before.steps[1], before.steps[3]]);
    expect(after.clarified).toEqual(before.clarified);
    expect(after.phase).toBe('running');
    // the plan given is not touched
    expect(before.steps[2]!.title).toBe('Passo s3');
  });
  it('a step is named by its number as the page shows it, or by its id; a name that is none refuses the save', () => {
    expect(apply([{ op: 'set', step: 's4', detail: 'a mano' }]).steps[3]!.detail).toBe('a mano');
    expect(apply([{ op: 'set', step: 4, detail: 'a mano' }]).steps[3]!.detail).toBe('a mano');
    expect(() => apply([{ op: 'set', step: 9, title: 'x' }])).toThrow(/il passo 9 non c’è/);
    expect(() => apply([{ op: 'set', step: 's9', title: 'x' }])).toThrow(/non c’è/);
    expect(() => apply([])).toThrow(/Da 1 a/);
  });
  it('all the operations apply together or none does', () => {
    const p = base();
    expect(() => apply([{ op: 'set', step: 3, title: 'Cambiato' }, { op: 'set', step: 9, title: 'x' }], p)).toThrow();
    expect(p).toEqual(base());
    const ok = apply([{ op: 'set', step: 3, title: 'Cambiato' }, { op: 'add', title: 'Nuovo', after: [1] }]);
    expect(ok.steps.map(x => x.title)).toEqual(['Passo s1', 'Passo s2', 'Cambiato', 'Passo s4', 'Nuovo']);
  });
});

describe('adding, moving, removing, cancelling', () => {
  it('adds a step with the next free id, at the end or at a place; found while it runs it is marked «added»', () => {
    const r = apply([{ op: 'add', title: 'Cerco ancora', after: ['s1'] }, { op: 'add', title: 'In testa', at: 1 }]);
    expect(ids(r)).toEqual(['s6', 's1', 's2', 's3', 's4', 's5']);
    expect(r.steps[5]).toMatchObject({ id: 's5', title: 'Cerco ancora', after: ['s1'], added: true, state: 'todo' });
    expect(apply([{ op: 'add', title: 'x' }], plan([s('s1')], 'proposed')).steps[1]).not.toHaveProperty('added');
  });
  it('moves a step to do; one that started stays where it is', () => {
    expect(ids(apply([{ op: 'move', step: 's4', to: 3 }]))).toEqual(['s1', 's2', 's4', 's3']);
    expect(() => apply([{ op: 'move', step: 2, to: 1 }])).toThrow(/già partito/);
  });
  it('removes only a step that has not started, and the steps that waited for it no longer wait for it', () => {
    const r = apply([{ op: 'remove', step: 's3' }]);
    expect(ids(r)).toEqual(['s1', 's2', 's4']);
    const chain = apply([{ op: 'remove', step: 's3' }], plan([s('s1'), s('s2', 'todo', { after: ['s1'] }), s('s3', 'todo', { after: ['s2', 's1'] })]));
    expect(chain.steps[1]!.after).toEqual(['s1']);
    expect(() => apply([{ op: 'remove', step: 2 }])).toThrow(/si annulla \(cancel\)/);
    expect(() => apply([{ op: 'remove', step: 1 }])).toThrow(/già partito/);
  });
  it('cancels a step that has not ended and keeps it, with its history; a finished one cannot be cancelled', () => {
    const r = apply([{ op: 'cancel', step: 2 }]);
    expect(r.steps[1]).toMatchObject({ id: 's2', state: 'cancelled', endedAt: 100, chatIds: ['c1'] });
    expect(ids(r)).toEqual(['s1', 's2', 's3', 's4']);
    expect(() => apply([{ op: 'cancel', step: 1 }])).toThrow(/già finito/);
  });
  it('a started step keeps its role and what it waits for: only its title and detail change', () => {
    expect(() => apply([{ op: 'set', step: 2, after: ['s1'] }])).toThrow(/già partito/);
    expect(() => apply([{ op: 'set', step: 2, role: 'scout' }])).toThrow(/già partito/);
    expect(apply([{ op: 'set', step: 2, title: 'Nuovo titolo', detail: 'più chiaro' }]).steps[1]).toMatchObject({ title: 'Nuovo titolo', detail: 'più chiaro', state: 'now', chatIds: ['c1'] });
  });
});

describe('«fatto» and the end of a plan', () => {
  it('a step is done with a proof, from the one who gives it; without one the save is refused', () => {
    const r = applySteps(base(), [{ op: 'done', step: 2, proof: 'riletto a mano: gli sconti tornano' }], 100, 'strategist');
    expect(r.steps[1]).toMatchObject({ state: 'done', endedAt: 100, proof: { at: 100, by: 'strategist', text: 'riletto a mano: gli sconti tornano' } });
    expect(() => apply([{ op: 'done', step: 2, proof: ' ' }])).toThrow(/serve un testo/);
    expect(() => apply([{ op: 'cancel', step: 3 }, { op: 'done', step: 3, proof: 'x' }])).toThrow(/annullato/);
  });
  it('every step ended ends a running plan; a step added to a finished plan reopens it', () => {
    const last = apply([{ op: 'done', step: 2, proof: 'ok' }, { op: 'done', step: 3, proof: 'ok' }, { op: 'cancel', step: 4 }]);
    expect(last.phase).toBe('done');
    expect(apply([{ op: 'add', title: 'Ancora una cosa' }], last)).toMatchObject({ phase: 'running' });
    // a plan still waiting for the user's ok is not started by an edit
    expect(apply([{ op: 'set', step: 2, title: 'x' }], plan([s('s1'), s('s2')], 'proposed')).phase).toBe('proposed');
  });
});

describe('what a save refuses', () => {
  it('steps that wait for each other in a circle', () => {
    expect(() => apply([{ op: 'set', step: 3, after: [4] }, { op: 'set', step: 4, after: [3] }])).toThrow(/si aspettano a vicenda/);
  });
  it('steps that may run together and touch the same thing', () => {
    const p = plan([s('s1', 'todo', { touches: ['src/a.ts'] }), s('s2', 'todo', { touches: ['src/b.ts'] })]);
    expect(() => apply([{ op: 'set', step: 2, touches: ['src/a.ts'] }], p)).toThrow(/possono andare insieme e toccano entrambi/);
    expect(apply([{ op: 'set', step: 2, touches: ['src/a.ts'], after: [1] }], p).steps[1]).toMatchObject({ after: ['s1'] });
  });
  it('text too long, a bad role or preset, a bad estimate, too many steps', () => {
    expect(() => apply([{ op: 'add', title: 'x'.repeat(161) }])).toThrow(/al massimo 160/);
    expect(() => apply([{ op: 'add', title: 'x', role: 'judge' as never }])).toThrow(/ruolo/);
    expect(() => apply([{ op: 'add', title: 'x', preset: 'huge' as never }])).toThrow(/min, base o max/);
    expect(() => apply([{ op: 'add', title: 'x', minutes: 0 }])).toThrow(/minuti/);
    expect(() => apply(Array.from({ length: 61 }, () => ({ op: 'add', title: 'x' }) as StepOp))).toThrow(/Da 1 a 60/);
  });
  it('a field set to null is taken away, by name; the others stay', () => {
    const p = plan([s('s1', 'todo', { detail: 'a', role: 'scout', preset: 'max', minutes: 5, touches: ['x'] })]);
    const r = apply([{ op: 'set', step: 1, detail: null, minutes: null }], p).steps[0]!;
    expect(r).not.toHaveProperty('detail');
    expect(r).not.toHaveProperty('minutes');
    expect(r).toMatchObject({ role: 'scout', preset: 'max', touches: ['x'] });
  });
});

describe('taking in the steps of another plan', () => {
  it('imports them with new ids and their own dependencies, after the ones already there, and changes none of the others', () => {
    const other = [s('s1', 'todo'), s('s2', 'todo', { after: ['s1'] })];
    const r = apply([{ op: 'import', steps: other }]);
    expect(ids(r)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
    expect(r.steps[5]).toMatchObject({ id: 's6', after: ['s5'] });
    expect(r.steps.slice(0, 4)).toEqual(base().steps);
    expect(() => apply([{ op: 'import', steps: Array.from({ length: 401 }, (_, i) => s(`s${i + 1}`)) }])).toThrow(/più di 400/);
  });
});
