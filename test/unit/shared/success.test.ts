// The one success definition (src/shared/success.ts, ADR 0186): verified verdicts only, a partial counts half, no share
// under MIN_SUCCESS_SAMPLE verdicts.
import { describe, expect, it } from 'vitest';
import { countedVerdict, enoughVerdicts, MIN_SUCCESS_SAMPLE, runsSuccess, successInterval, successShare } from '../../../src/shared/success';
import type { AgentRun } from '../../../src/shared/agents';

const run = (verdict: string, basis: string) => ({ endedAt: 1, counters: { reopened: 0 }, outcome: { verdict, basis, at: 1, by: 'x' } }) as unknown as AgentRun;

describe('success', () => {
  it('counts only the user\'s and a verified review\'s verdicts', () => {
    expect(countedVerdict(run('success', 'human'))).toBe('success');
    expect(countedVerdict(run('partial', 'reviewed-evidence'))).toBe('partial');
    for (const basis of ['orchestrator-opinion', 'self-report', 'receipts', 'unknown']) expect(countedVerdict(run('success', basis)), basis).toBeNull();
    expect(countedVerdict(run('unknown', 'human'))).toBeNull();
  });
  it('a partial counts half; no verdict = no value', () => {
    expect(successShare(['success', 'partial', 'fail', 'fail'])).toEqual({ value: 0.375, n: 4 });
    expect(successShare([])).toEqual({ value: null, n: 0 });
    expect(runsSuccess([run('success', 'human'), run('partial', 'human'), run('success', 'self-report')])).toEqual({ value: 0.75, n: 2 });
  });
  it('a share needs MIN_SUCCESS_SAMPLE verdicts', () => {
    expect(MIN_SUCCESS_SAMPLE).toBe(5);
    expect(enoughVerdicts({ n: 4 })).toBe(false);
    expect(enoughVerdicts({ n: 5 })).toBe(true);
  });
  it('a share\'s 90% interval stays within 0-100% and narrows with the sample', () => {
    expect(successInterval({ value: 1, n: 4 })).toBeNull();
    expect(successInterval({ value: null, n: 9 })).toBeNull();
    const all = successInterval({ value: 1, n: 5 })!;
    expect(all.high).toBe(1);
    expect(all.low).toBeCloseTo(0.65, 2);
    const five = successInterval({ value: 0.8, n: 5 })!, fifty = successInterval({ value: 0.8, n: 50 })!;
    expect(five.low).toBeLessThan(0.8); expect(five.high).toBeGreaterThan(0.8);
    expect(fifty.high - fifty.low).toBeLessThan(five.high - five.low);
  });
});
