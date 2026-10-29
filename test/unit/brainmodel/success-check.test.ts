// «Riuscito se…» (ADR 0194, M4, brainmodel/success-check.ts): the criterion is checked and defaulted, said in words, and
// measured a week before vs a week after a change: corrections per run, verified success share, log lines of a group,
// uses of a skill; too few runs on a side → unknown; nothing before the week after is over.
import { describe, expect, it } from 'vitest';
import type { AgentRun } from '../../../src/shared/agents';
import { checkChange, checkWords, defaultSuccess, fewerCount, lowerIsBetter, parseSuccess, successText, WINDOW_MS } from '../../../src/main/brainmodel/success-check';

const AT = Date.parse('2026-10-10T12:00:00Z'), H = 3_600_000;
let n = 0;
const run = (o: Partial<AgentRun> & { end: number }): AgentRun => {
  const { end, ...rest } = o;
  return { runId: `r${++n}`, chatId: 'c', agentId: 'artisan', goal: 'g', startedAt: end - H, endedAt: end, ...rest } as AgentRun;
};
const corr = (end: number, k: number, agentId = 'artisan') => run({ end, agentId, corrections: { tagged: k, afterReport: 0 } as AgentRun['corrections'] });
const verdict = (end: number, v: 'success' | 'failure') => run({ end, outcome: { verdict: v, basis: 'human', at: end } as AgentRun['outcome'] });
const NOW = AT + WINDOW_MS + H;

describe('the criterion', () => {
  it('accepts only the fixed metrics with what each needs', () => {
    expect(parseSuccess(undefined)).toBeUndefined();
    expect(parseSuccess({ metric: 'fewer-corrections', role: 'artisan' })).toEqual({ metric: 'fewer-corrections', role: 'artisan' });
    expect(parseSuccess({ metric: 'skill-used', skill: 'note-rilascio', n: 2 })).toEqual({ metric: 'skill-used', skill: 'note-rilascio', n: 2 });
    expect(() => parseSuccess({ metric: 'happier-user' })).toThrow(/success.metric/);
    expect(() => parseSuccess({ metric: 'more-verified' })).toThrow(/role/);
    expect(() => parseSuccess({ metric: 'fewer-log-errors' })).toThrow(/logKey/);
    expect(() => parseSuccess({ metric: 'skill-used', skill: 'Not Kebab' })).toThrow(/kebab/);
    expect(() => parseSuccess({ metric: 'skill-used', skill: 'x', n: 0 })).toThrow(/success.n/);
    expect(() => parseSuccess({ metric: 'fewer-corrections', role: 'nobody' })).toThrow(/role id/);
  });
  it('defaults a brain change: a skill is used, else corrections go down', () => {
    expect(defaultSuccess({ target: 'skill', name: 'x', text: 't' })).toEqual({ metric: 'skill-used', skill: 'x', n: 3 });
    expect(defaultSuccess({ target: 'rule', role: 'scout', text: 't' })).toEqual({ metric: 'fewer-corrections', role: 'scout' });
    expect(defaultSuccess(undefined)).toBeUndefined();
  });
  it('says it in the user\'s words', () => {
    expect(successText({ metric: 'skill-used', skill: 'x', n: 2 }, 'it')).toBe('Riuscito se la skill «x» viene usata almeno 2 volte nella settimana dopo.');
    expect(successText({ metric: 'fewer-corrections' }, 'en')).toMatch(/^Worked if the corrections per job go down/);
  });
});

describe('the comparison', () => {
  it('lower is better with the evidence layer\'s margin; counts need a quarter and two lines more', () => {
    expect(lowerIsBetter(1, 1.2)).toBe('same');
    expect(lowerIsBetter(1, 1.3)).toBe('worse');
    expect(lowerIsBetter(1, 0.7)).toBe('better');
    expect(lowerIsBetter(0, 0.11)).toBe('worse');
    expect(fewerCount(4, 6)).toBe('same');
    expect(fewerCount(4, 7)).toBe('worse');
    expect(fewerCount(1, 3)).toBe('same');
    expect(fewerCount(4, 0)).toBe('better');
  });
});

describe('checkChange', () => {
  it('waits until the week after is over', () => {
    expect(checkChange(AT, { metric: 'fewer-corrections' }, { runs: [] }, AT + WINDOW_MS - 1)).toBeNull();
  });
  it('fewer-corrections: the mean per run of the role, each side, worse past the margin', () => {
    const runs = [corr(AT - 2 * H, 0), corr(AT - 3 * H, 1), corr(AT - 4 * H, 0), corr(AT - 5 * H, 2, 'scout'),
      corr(AT + 2 * H, 2), corr(AT + 3 * H, 1), corr(AT + 4 * H, 2), corr(AT - WINDOW_MS - H, 9)];
    const k = checkChange(AT, { metric: 'fewer-corrections', role: 'artisan' }, { runs }, NOW)!;
    expect(k).toMatchObject({ nBefore: 3, nAfter: 3, verdict: 'worse' });
    expect(k.before).toBeCloseTo(1 / 3); expect(k.after).toBeCloseTo(5 / 3);
    expect(checkWords({ metric: 'fewer-corrections' }, k, 'it')).toBe('Correzioni per lavoro: prima 0,33 (3 lavori), dopo 1,67 (3 lavori).');
    // every role: scout's run counts too; a run started before the change is not «after»
    const all = checkChange(AT, { metric: 'fewer-corrections' }, { runs: [...runs, run({ end: AT + H, startedAt: AT - H, corrections: { tagged: 9, afterReport: 0 } as AgentRun['corrections'] })] }, NOW)!;
    expect(all).toMatchObject({ nBefore: 4, nAfter: 3 });
  });
  it('too few runs on a side: unknown', () => {
    expect(checkChange(AT, { metric: 'fewer-corrections' }, { runs: [corr(AT - H, 0), corr(AT + 2 * H, 5)] }, NOW)).toMatchObject({ verdict: 'unknown', nBefore: 1, nAfter: 1 });
  });
  it('more-verified: the share of verified successes among judged runs', () => {
    const runs = [verdict(AT - H, 'success'), verdict(AT - 2 * H, 'success'), verdict(AT - 3 * H, 'success'), verdict(AT - 4 * H, 'failure'),
      verdict(AT + 2 * H, 'failure'), verdict(AT + 3 * H, 'success'), verdict(AT + 4 * H, 'failure'), run({ end: AT + 5 * H })];
    const k = checkChange(AT, { metric: 'more-verified', role: 'artisan' }, { runs }, NOW)!;
    expect(k).toMatchObject({ before: 0.75, nBefore: 4, nAfter: 3, verdict: 'worse' });
    expect(k.after).toBeCloseTo(1 / 3);
  });
  it('fewer-log-errors: the group\'s lines in each week; without logs unknown', () => {
    const counts: [number, number][] = [];
    const k = checkChange(AT, { metric: 'fewer-log-errors', logKey: 'k' }, { runs: [], logCount: (_k, from, to) => { counts.push([from, to]); return from < AT ? 2 : 9; } }, NOW)!;
    expect(k).toMatchObject({ before: 2, after: 9, verdict: 'worse' });
    expect(counts).toEqual([[AT - WINDOW_MS, AT], [AT, AT + WINDOW_MS]]);
    expect(checkChange(AT, { metric: 'fewer-log-errors', logKey: 'k' }, { runs: [] }, NOW)).toMatchObject({ verdict: 'unknown' });
  });
  it('skill-used: at least n runs loaded it in the week after', () => {
    const used = (end: number) => run({ end, tags: { skills: ['note-rilascio'] } as AgentRun['tags'] });
    const c = { metric: 'skill-used' as const, skill: 'note-rilascio', n: 2 };
    expect(checkChange(AT, c, { runs: [used(AT + H), used(AT + 2 * H)] }, NOW)).toMatchObject({ nAfter: 2, verdict: 'better' });
    const k = checkChange(AT, c, { runs: [used(AT + H), used(AT + WINDOW_MS + 2 * H)] }, NOW)!;
    expect(k).toMatchObject({ nAfter: 1, verdict: 'worse' });
    expect(checkWords(c, k, 'it')).toBe('La skill «note-rilascio» è stata usata 1 volta nella settimana dopo (ne servivano 2).');
  });
});
