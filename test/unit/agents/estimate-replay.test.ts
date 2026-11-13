// The task estimate's replay on the synthetic history (test/fixtures/estimates/synthetic-jobs.ts, ADR 0186): the old
// estimator (median execution time of similar runs) reproduces the measured actual/estimate ratios (p25 1.03, p50 2.01,
// p75 4.21) and holds less than half the time; the new one (the job's elapsed time and tree cost, calibrated per kind)
// holds at least 60% of the time on the same history.
import { describe, expect, it } from 'vitest';
import { syntheticJobs } from '../../fixtures/estimates/synthetic-jobs';
import { estimateAccuracy } from '../../../src/main/agents/estimate-accuracy';
import { held, kindOfRun, quantile, SimilarIndex, estimateTask } from '../../../src/main/agents/task-estimate';

describe('estimate replay (synthetic)', () => {
  const runs = syntheticJobs(), roots = runs.filter(r => !r.parentRunId);
  const now = Math.max(...runs.map(r => r.endedAt!)) + 1;
  it('the old estimator gives the measured ratios and holds less than half the time', () => {
    const ratios: number[] = [];
    let hits = 0;
    for (const r of roots) {
      const past = roots.filter(x => x.endedAt! < r.startedAt && kindOfRun(x) === kindOfRun(r)).slice(-30).map(x => x.executionMs!).sort((a, b) => a - b);
      if (past.length < 3) continue;
      const est = quantile(past, 0.5), actual = r.endedAt! - r.startedAt;
      ratios.push(actual / est);
      if (held(est, actual)) hits++;
    }
    const q = [...ratios].sort((a, b) => a - b);
    expect(quantile(q, 0.25)).toBeGreaterThan(0.85); expect(quantile(q, 0.25)).toBeLessThan(1.25);
    expect(quantile(q, 0.5)).toBeGreaterThan(1.7); expect(quantile(q, 0.5)).toBeLessThan(2.4);
    expect(quantile(q, 0.75)).toBeGreaterThan(3.4); expect(quantile(q, 0.75)).toBeLessThan(5);
    expect(hits / ratios.length).toBeLessThan(0.5);
  });
  it('the new estimator holds at least 60% of the time', () => {
    const acc = estimateAccuracy(runs, now, 3);
    expect(acc.n).toBeGreaterThan(150);
    expect(acc.hitRate!).toBeGreaterThanOrEqual(0.6);
  });
  it('a feature job is measured with its children\'s cost', () => {
    const idx = new SimilarIndex(runs), job = roots.find(r => r.goal.startsWith('Aggiungi'))!;
    expect(idx.actual(job.runId)?.costUsd).toBeCloseTo(job.costUsd! + 0.2);
    expect(estimateTask(idx, { text: 'Aggiungi la funzione nuova al carrello', agentId: 'artisan' })).toMatchObject({ kind: 'app-feature', basis: 'agent-kind' });
  });
});
