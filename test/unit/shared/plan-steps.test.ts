// The steps of a plan (shared/plan-steps.ts, ADR 0363): the turns that follow from what each step waits for, circles, the steps
// that may run together and touch the same thing, which steps may start now, the percentage done (and the time, one after the
// other and in parallel), the proof, and the reader of a saved plan, the one of before included (par, outcome, no proof).
import { describe, expect, it } from 'vitest';
import { circleOf, clashes, ended, nextStepId, overlap, opens, progressOf, proved, readProof, readSteps, readySteps, timeOf, together, turnsOf, waitingFor, type PlanStep } from '../../../src/shared/plan-steps';

const s = (id: string, state: PlanStep['state'] = 'todo', extra: Partial<PlanStep> = {}): PlanStep => ({ id, title: `Passo ${id}`, state, ...(state === 'done' && !extra.proof ? { proof: { at: 1, by: 'report' as const, text: 'ok' } } : {}), ...extra });

describe('turns and what runs together', () => {
  it('a turn is one more than the last step it waits for; steps with nothing to wait for share the first', () => {
    const steps = [s('s1'), s('s2'), s('s3', 'todo', { after: ['s1', 's2'] }), s('s4', 'todo', { after: ['s3'] }), s('s5', 'todo', { after: ['s3'] })];
    expect(turnsOf(steps)).toEqual([1, 1, 2, 3, 3]);
    expect(turnsOf([])).toEqual([]);
    // a name that is no step is no dependency
    expect(turnsOf([s('s1', 'todo', { after: ['s9'] })])).toEqual([1]);
  });
  it('ids: the next free one, whatever the order', () => {
    expect(nextStepId([])).toBe('s1');
    expect(nextStepId([s('s3'), s('s1')])).toBe('s4');
  });
  it('a circle is found and told by numbers; a plan with none says null', () => {
    expect(circleOf([s('s1', 'todo', { after: ['s2'] }), s('s2', 'todo', { after: ['s3'] }), s('s3', 'todo', { after: ['s1'] })])).toEqual([1, 2, 3]);
    expect(circleOf([s('s1'), s('s2', 'todo', { after: ['s1'] })])).toBeNull();
    // a circle in a broken file counts as no dependency when the turns are worked out
    expect(turnsOf([s('s1', 'todo', { after: ['s2'] }), s('s2', 'todo', { after: ['s1'] })]).every(n => n >= 1)).toBe(true);
  });
  it('two steps may run together unless one waits for the other, at any depth', () => {
    const steps = [s('s1'), s('s2', 'todo', { after: ['s1'] }), s('s3', 'todo', { after: ['s2'] }), s('s4')];
    expect(together(steps, 's1', 's4')).toBe(true);
    expect(together(steps, 's1', 's3')).toBe(false);
    expect(together(steps, 's3', 's1')).toBe(false);
    expect(together(steps, 's2', 's2')).toBe(false);
  });
  it('a folder and a file of it are the same thing; two steps that may run together on one of them clash, the others do not', () => {
    expect(overlap('src/a', 'src/a/b.ts')).toBe(true);
    expect(overlap('SRC\\a\\', 'src/a')).toBe(true);
    expect(overlap('src/a', 'src/ab')).toBe(false);
    const both = [s('s1', 'todo', { touches: ['src/a'] }), s('s2', 'todo', { touches: ['src/a/b.ts'] })];
    expect(clashes(both)).toEqual([{ a: 1, b: 2, on: 'src/a' }]);
    expect(clashes([both[0]!, { ...both[1]!, after: ['s1'] }])).toEqual([]);
    expect(clashes([both[0]!, { ...both[1]!, state: 'done', proof: { at: 1, by: 'report', text: 'ok' } }])).toEqual([]);
    expect(clashes([both[0]!, { ...both[1]!, drop: true }])).toEqual([]);
  });
});

describe('which steps may start', () => {
  const steps = [s('s1', 'done'), s('s2', 'now'), s('s3', 'todo', { after: ['s1'] }), s('s4', 'todo', { after: ['s1', 's2'] }), s('s5', 'todo', { after: ['s3'] }), s('s6', 'todo', { drop: true })];
  it('waits for the steps not ended yet, as numbers; nothing to wait for = may start', () => {
    expect(waitingFor(steps, 2)).toEqual([]);
    expect(waitingFor(steps, 3)).toEqual([2]);
    expect(waitingFor(steps, 4)).toEqual([3]);
  });
  it('the ready ones are the steps to do with nothing to wait for; the dropped and the started are not', () => {
    expect(readySteps(steps)).toEqual([2]);
    expect(readySteps(steps.map(x => (x.id === 's2' ? { ...x, state: 'done' as const, proof: { at: 1, by: 'report' as const, text: 'ok' } } : x)))).toEqual([2, 3]);
  });
  it('what a step opens when it ends: only the steps it was the last to hold back', () => {
    expect(opens(steps, 0)).toEqual([3]);
    expect(opens(steps, 1)).toEqual([4]);
    expect(opens(steps, 2)).toEqual([5]);
  });
  it('done, partly done and cancelled have ended; the others have not', () => {
    expect(['done', 'partial', 'cancelled'].every(state => ended({ state: state as PlanStep['state'] }))).toBe(true);
    expect(['todo', 'now', 'blocked', 'check'].some(state => ended({ state: state as PlanStep['state'] }))).toBe(false);
  });
});

describe('how far it is', () => {
  it('the percentage: done counts one, partly done half, the rest nothing; the cancelled and the dropped are not counted', () => {
    expect(progressOf([s('s1', 'done'), s('s2', 'partial'), s('s3'), s('s4', 'now')])).toEqual({ done: 1, total: 4, percent: 37 });
    expect(progressOf([s('s1', 'done'), s('s2', 'cancelled'), s('s3', 'todo', { drop: true }), s('s4')])).toEqual({ done: 1, total: 2, percent: 50 });
    expect(progressOf([s('s1', 'check'), s('s2', 'blocked')])).toEqual({ done: 0, total: 2, percent: 0 });
    expect(progressOf([])).toEqual({ done: 0, total: 0, percent: 0 });
  });
  it('100 only when every step is done, never rounded up to it', () => {
    expect(progressOf([s('s1', 'done'), s('s2', 'done')]).percent).toBe(100);
    const almost = Array.from({ length: 300 }, (_, i) => s(`s${i + 1}`, i < 299 ? 'done' : 'partial'));
    expect(progressOf(almost).percent).toBe(99);
    expect(progressOf([s('s1', 'done'), s('s2', 'partial')]).percent).toBe(75);
  });
  it('the time, one after the other and in parallel; none when a step has no estimate', () => {
    const steps = [s('s1', 'todo', { minutes: 10 }), s('s2', 'todo', { minutes: 20 }), s('s3', 'todo', { minutes: 5, after: ['s1', 's2'] })];
    expect(timeOf(steps)).toEqual({ row: 35, parallel: 25 });
    expect(timeOf([...steps, s('s4')])).toBeNull();
    expect(timeOf([])).toBeNull();
  });
});

describe('a saved plan\'s steps, read', () => {
  it('a step with an id keeps its own dependencies and proof; a bad one makes the whole list no list', () => {
    const out = readSteps([{ id: 's1', title: 'a', state: 'done', proof: { at: 5, by: 'report', text: 'ok', chatId: 'c_1' } }, { id: 's2', title: 'b', state: 'todo', after: ['s1', 's9', 's2'], touches: ['x'], minutes: 5 }])!;
    expect(out[0]).toMatchObject({ id: 's1', state: 'done', proof: { by: 'report', chatId: 'c_1' } });
    expect(out[1]).toMatchObject({ id: 's2', after: ['s1', 's9'], touches: ['x'], minutes: 5 });
    expect(readSteps([{ id: 's1', title: '', state: 'todo' }])).toBeNull();
    expect(readSteps([{ id: 's1', title: 'a', state: 'odd' }])).toBeNull();
    expect(readSteps('x')).toBeNull();
    expect(readSteps(Array.from({ length: 401 }, (_, i) => ({ title: `t${i}`, state: 'todo' })))).toBeNull();
  });
  it('a step saved before ids: its id is made, `par` becomes the dependency it meant, a done step with no proof is «da verificare»', () => {
    const out = readSteps([{ title: 'a', state: 'done' }, { title: 'b', state: 'todo', par: true }, { title: 'c', state: 'todo' }, { title: 'd', state: 'done', outcome: 'partial' }, { title: 'e', state: 'done', outcome: 'blocked' }])!;
    expect(out.map(x => x.id)).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(out.map(x => x.state)).toEqual(['check', 'todo', 'todo', 'partial', 'blocked']);
    expect(turnsOf(out)).toEqual([1, 1, 2, 3, 4]);
    expect(out[2]!.after).toEqual(['s1', 's2']);
  });
  it('a proof is read whole or not at all', () => {
    expect(readProof({ at: 1, by: 'user', text: 'visto' })).toEqual({ at: 1, by: 'user', text: 'visto' });
    expect(readProof({ at: 1, by: 'nobody', text: 'x' })).toBeNull();
    expect(readProof({ at: 1, by: 'user', text: '' })).toBeNull();
    expect(readProof({ at: 0, by: 'user', text: 'x' })).toBeNull();
    expect(readProof(null)).toBeNull();
  });
  it('a step to verify is proved by the report of its chats, or stays to verify while one cannot be read', () => {
    const steps = [s('s1', 'check', { chatIds: ['a', 'b'] }), s('s2', 'check', { chatIds: ['c'] }), s('s3', 'check'), s('s4', 'todo', { chatIds: ['a'] })];
    const out = proved(steps, id => (id === 'a' ? { outcome: 'done', summary: 'trovato', at: 7 } : id === 'b' ? { outcome: 'partial', summary: 'a metà', at: 8 } : null));
    expect(out[0]).toMatchObject({ state: 'partial', proof: { by: 'report', text: 'a metà', chatId: 'b', at: 8 } });
    expect(out[1]!.state).toBe('check');
    expect(out[2]!.state).toBe('check');
    expect(out[3]!.state).toBe('todo');
    expect(proved(steps, () => ({ outcome: 'blocked', summary: 'no', at: 1 }))[0]!.state).toBe('blocked');
  });
});
