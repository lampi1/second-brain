// The app's small-sample statistics (shared/evidence-stats.ts): Wilson and Newcombe intervals against published values,
// a seeded bootstrap that repeats itself, verdicts only at a checkpoint, and the «k/n (IC)» text.
import { describe, expect, it } from 'vitest';
import { atCheckpoint, bootstrapDiff, newcombe, shareText, verdictOf, wilson } from '../../src/shared/evidence-stats';

describe('evidence stats', () => {
  it('Wilson matches the textbook values (95%: 2/2 = 34–100%, 7/10 = 40–89%)', () => {
    const z95 = 1.959963984540054;
    const a = wilson(2, 2, z95)!, b = wilson(7, 10, z95)!;
    expect(a.low).toBeCloseTo(0.342, 2); expect(a.high).toBeCloseTo(1, 5);
    expect(b.low).toBeCloseTo(0.397, 2); expect(b.high).toBeCloseTo(0.892, 2);
    expect(wilson(0, 0)).toBeNull();
  });

  it('Newcombe brackets the difference and widens with small n', () => {
    // Newcombe 1998, example (a): 56/70 vs 48/80, 95% CI 0.0524 to 0.3339
    const z95 = 1.959963984540054;
    const d = newcombe(56, 70, 48, 80, z95)!;
    expect(d.low).toBeCloseTo(0.0524, 3); expect(d.high).toBeCloseTo(0.3339, 3);
    const small = newcombe(4, 5, 3, 5)!, big = newcombe(80, 100, 60, 100)!;
    expect(small.high - small.low).toBeGreaterThan(big.high - big.low);
  });

  it('the bootstrap is seeded and finds a clear change', () => {
    const before = Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? 2 : 1));
    const after = Array.from({ length: 30 }, (_, i) => (i % 5 === 0 ? 1 : 0));
    const a = bootstrapDiff(before, after)!, b = bootstrapDiff(before, after)!;
    expect(a).toEqual(b);
    expect(a.high).toBeLessThan(0);
    expect(verdictOf(a, { before: 30, after: 30 }, 'lower')).toBe('aiuta');
    expect(verdictOf(a, { before: 30, after: 7 }, 'lower')).toBe('raccolta');
  });

  it('no effect only inside the margin; the text says when data are too few', () => {
    expect(verdictOf({ low: -0.05, high: 0.04 }, { before: 40, after: 40 }, 'lower', 0.1)).toBe('nessun-effetto');
    expect(verdictOf({ low: -0.3, high: 0.2 }, { before: 40, after: 40 }, 'lower', 0.1)).toBe('raccolta');
    expect(verdictOf({ low: 0.1, high: 0.3 }, { before: 40, after: 40 }, 'lower')).toBe('peggiora');
    expect(shareText(3, 5)).toBe('dati insufficienti (5/10)');
    expect(shareText(24, 30)).toMatch(/^80% · 24\/30 \(IC 90% \d+–\d+%\)$/);
  });

  it('a side is judged at its checkpoint, not at every new case', () => {
    expect([0, 19, 20, 23, 39, 40, 79, 80, 200].map(atCheckpoint)).toEqual([0, 0, 20, 20, 20, 40, 40, 80, 160]);
  });
});
