// The doubts of a Strategist's plan, the pure part (ADR 0342, shared/plan-doubts.ts): how each is closed and with which
// source, what keeps one open, the approval gate and the check of a saved list.
import { describe, expect, it } from 'vitest';
import { approvalGate, checkDoubts, closeAnswered, openDoubts, openDoubtsNote, readDoubts, type DoubtEvidence, type PlanDoubt } from '../../src/shared/plan-doubts';
import { readPlan } from '../../src/shared/strategy';

const none: DoubtEvidence = { clarified: [], said: [], mayChoose: false };
const one = (d: Record<string, unknown>, ev: Partial<DoubtEvidence> = {}, prior?: PlanDoubt[]) => checkDoubts([d], prior, { ...none, ...ev })![0]!;
const open = (text: string): PlanDoubt => ({ text, state: 'open' });

describe('how a doubt is closed', () => {
  it('by code or brain, with its answer and its source; without one it is refused', () => {
    expect(one({ text: 'Vale sui resi?', by: 'code', answer: 'Sì', source: 'src/cart.ts:12' })).toEqual({ text: 'Vale sui resi?', state: 'closed', by: 'code', answer: 'Sì', source: 'src/cart.ts:12' });
    expect(one({ text: 'Vale sui resi?', by: 'brain', answer: 'No', source: 'now.md' })).toMatchObject({ by: 'brain', source: 'now.md' });
    expect(() => one({ text: 'Vale sui resi?', by: 'code', answer: 'Sì' })).toThrow(/source/);
    expect(() => one({ text: 'Vale sui resi?', by: 'brain', source: 'now.md' })).toThrow(/answer/);
  });
  it('by the user only with what the app recorded: his interview answer or his own words', () => {
    const ev = { clarified: [{ q: 'Vale sui resi?', a: 'No' }], said: ['ciao, lo sconto vale solo online'] };
    // the answer is the recorded one, never the Strategist's
    expect(one({ text: 'vale  sui resi', by: 'user', answer: 'Sì' }, ev)).toMatchObject({ state: 'closed', by: 'user', answer: 'No' });
    expect(one({ text: 'Solo online?', by: 'user', source: 'lo sconto vale solo online' }, ev)).toMatchObject({ by: 'user', answer: 'lo sconto vale solo online' });
    expect(() => one({ text: 'Solo online?', by: 'user', answer: 'Sì' }, ev)).toThrow(/did not answer/);
    expect(() => one({ text: 'Solo online?', by: 'user', source: 'va bene per i negozi' }, ev)).toThrow(/did not answer/);
    expect(() => one({ text: 'Solo online?', by: 'user', source: 'ciao' }, ev)).toThrow(/did not answer/);
    // an interview line cut to size still matches its whole question
    const long = `Lo sconto ${'molto '.repeat(30)}grande vale?`;
    expect(one({ text: long, by: 'user' }, { clarified: [{ q: `${long.slice(0, 119)}…`, a: 'Sì' }] })).toMatchObject({ answer: 'Sì' });
  });
  it('left open, an answer the app already recorded closes it; a doubt he closed stays his', () => {
    expect(one({ text: 'Vale sui resi?' }, { clarified: [{ q: 'Vale sui resi?', a: 'No' }] })).toMatchObject({ state: 'closed', by: 'user', answer: 'No' });
    const his: PlanDoubt = { text: 'Vale sui resi?', state: 'closed', by: 'user', answer: 'No', source: 'Vale sui resi?' };
    expect(one({ text: 'Vale sui resi?' }, {}, [his])).toEqual(his);
    expect(one({ text: 'Vale sui resi?', by: 'user', answer: 'Sì' }, {}, [his])).toEqual(his);
    expect(one({ text: 'Altro?' })).toEqual(open('Altro?'));
  });
  it('by the Strategist\'s own choice only after «Basta domande» or in night mode, with why', () => {
    const d = { text: 'Vale sui resi?', by: 'choice', answer: 'No', source: 'più prudente' };
    expect(() => one(d)).toThrow(/Basta domande/);
    expect(one(d, { mayChoose: true })).toMatchObject({ state: 'closed', by: 'choice', source: 'più prudente' });
  });
  it('asked with its own words, the answer closes it', () => {
    const list = [open('Vale sui resi?'), open('Solo online?')];
    expect(closeAnswered(list, ' vale sui  resi? ', 'No')).toEqual([{ text: 'Vale sui resi?', state: 'closed', by: 'user', answer: 'No', source: 'vale sui resi?' }, open('Solo online?')]);
    expect(closeAnswered(list, 'Altro?', 'No')).toEqual(list);
  });
});

describe('what keeps a doubt', () => {
  it('an open one cannot disappear from the list; left out, the whole list stays', () => {
    const prior = [open('Vale sui resi?')];
    expect(() => checkDoubts([], prior, none)).toThrow(/still open/);
    expect(checkDoubts(undefined, prior, none)).toEqual(prior);
    expect(checkDoubts(undefined, undefined, none)).toBeUndefined();
    expect(checkDoubts([], undefined, none)).toEqual([]);
  });
  it('a malformed list is refused', () => {
    expect(() => checkDoubts('x', undefined, none)).toThrow(/list/);
    expect(() => checkDoubts([1], undefined, none)).toThrow(/object/);
    expect(() => one({ text: ' ' })).toThrow(/required/);
    expect(() => one({ text: 'x'.repeat(301) })).toThrow(/at most/);
    expect(() => one({ text: 'x', state: 'closed' })).toThrow(/unknown field state/);
    expect(() => one({ text: 'x', by: 'agent', answer: 'a', source: 's' })).toThrow(/one of/);
    expect(() => checkDoubts([{ text: 'A?' }, { text: 'a' }], undefined, none)).toThrow(/twice/);
    expect(() => checkDoubts(Array.from({ length: 21 }, (_, i) => ({ text: `d${i}` })), undefined, none)).toThrow(/at most 20/);
  });
  it('one open doubt blocks the approval and says which', () => {
    expect(approvalGate({})).toBeNull();
    expect(approvalGate({ doubts: [] })).toBeNull();
    expect(approvalGate({ doubts: [{ ...open('A?'), state: 'closed' }, open('Vale sui resi?')] })).toContain('«Vale sui resi?»');
    expect(openDoubts({ doubts: [open('A?')] })).toHaveLength(1);
    expect(openDoubtsNote([open('A?')], false)).toMatch(/«A\?».*not shown for approval.*ask the user/s);
    expect(openDoubtsNote([open('A?'), open('B?')], true)).toMatch(/2 doubts.*recommended choice/s);
  });
});

describe('a saved list', () => {
  it('comes back as it was; what is not readable as closed is open, never lost', () => {
    const closed: PlanDoubt = { text: 'A?', state: 'closed', by: 'code', answer: 'Sì', source: 'a.ts' };
    expect(readDoubts(JSON.parse(JSON.stringify([closed, open('B?')])))).toEqual([closed, open('B?')]);
    expect(readDoubts([{ text: 'A?', state: 'closed', by: 'code' }])).toEqual([open('A?')]);
    expect(readDoubts('x')).toBeNull();
    expect(readDoubts([null])).toBeNull();
  });
  it('the plan keeps it; a damaged list blocks the approval, an older plan has none', () => {
    const plan = { phase: 'proposed', at: 1, clarified: [], steps: [{ title: 'x', state: 'todo' }] };
    expect(readPlan({ ...plan, doubts: [open('A?')] })!.doubts).toEqual([open('A?')]);
    expect(approvalGate(readPlan({ ...plan, doubts: 'x' })!)).not.toBeNull();
    expect(readPlan(plan)).not.toHaveProperty('doubts');
  });
});
