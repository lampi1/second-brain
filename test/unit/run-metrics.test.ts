// The §5 read model (A6): every formula with its n and coverage, unknowns, v0 kept out of the all-versions row, reviewer
// findings grouped by reviewer version, and rollups that keep the counts of pruned runs.
import { describe, expect, it } from 'vitest';
import type { AgentRun } from '../../src/shared/agents';
import { REWORK_MS, SAMPLE_MAX, emptyTally, median, p90, rollUp, runMetrics } from '../../src/main/agents/run-metrics';

let seq = 0;
const H = 3600_000;
function run(o: Partial<AgentRun> = {}): AgentRun {
  seq++;
  return {
    runId: `r_${seq.toString(16).padStart(12, '0')}`, chatId: `c${seq}`, agentId: 'coder', version: 1, goal: 'g', startedBy: 'user', startedAt: 0, endedAt: H, endReason: 'completed',
    counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, costUsd: null, tokens: null, ...o,
  };
}
const outcome = (verdict: 'success' | 'partial' | 'fail' | 'unknown', basis: NonNullable<AgentRun['outcome']>['basis']) => ({ outcome: { verdict, basis, at: 1, by: 'user' } });
const one = (runs: AgentRun[], input = {}) => runMetrics(runs, input)[0]!;

describe('agent metrics', () => {
  it('success rate counts only human and reviewed evidence; opinion and self-report stay apart', () => {
    const m = one([
      run(outcome('success', 'human')), run(outcome('partial', 'reviewed-evidence')), run(outcome('fail', 'human')),
      run(outcome('success', 'orchestrator-opinion')), run(outcome('unknown', 'human')),
      run({ ...outcome('fail', 'self-report') }),
      run({ report: { at: 1, outcome: 'partial', verified: 'yes', summary: 's' } }),
      run(),
    ]).versions[0]!;
    expect(m.ended).toBe(8);
    expect(m.successRate).toEqual({ value: 0.5, n: 3, coverage: 3 / 8 });
    expect(m.opinion).toEqual({ value: 1, n: 1 });
    expect(m.selfReport).toEqual({ value: 0.25, n: 2 });
  });

  it('corrections per run rest only on runs that counted them; ai errors only when the file was read', () => {
    const runs = [run({ corrections: { tagged: 2, afterReport: 1 } }), run({ corrections: { tagged: 0, afterReport: 0 } }), run()];
    const m = one(runs).versions[0]!;
    expect(m.correctionsPerRun).toEqual({ value: 1.5, n: 2, coverage: 2 / 3 });
    expect(m.aiErrorsPerRun).toEqual({ value: null, n: 0, coverage: 0 });
    const withErrors = one(runs, { aiErrors: new Map([[runs[0]!.runId, 3]]) }).versions[0]!;
    expect(withErrors.aiErrorsPerRun).toEqual({ value: 1, n: 3, coverage: 1 });
  });

  it('rework: reopened, or reworked / continued by a run started within 7 days of the end', () => {
    const a = run(), b = run(), c = run({ counters: { questions: 0, permissions: 0, commands: 0, reopened: 1, contextPeak: null } }), d = run();
    const later = [run({ agentId: 'other', reworkOf: a.runId, startedAt: H + REWORK_MS }), run({ agentId: 'other', continuedFrom: b.runId, startedAt: H + REWORK_MS + 1 })];
    const m = runMetrics([a, b, c, d, ...later]).find(x => x.agentId === 'coder')!.versions[0]!;
    expect(m.reworkRate).toEqual({ value: 0.5, n: 4, coverage: 1 });
  });

  it('cost, tokens, context, time: medians on the known values, p90 by nearest rank, unknown stays out', () => {
    const tokens = (n: number) => ({ input: n, output: n * 2, cacheRead: 0, cacheWrite: 0 });
    const runs = [
      run({ costUsd: 1, tokens: tokens(10), counters: { questions: 2, permissions: 1, commands: 0, reopened: 0, contextPeak: 1000 }, executionMs: 100, startedAt: 0, endedAt: 4 * H }),
      run({ costUsd: 3, tokens: tokens(30), counters: { questions: 0, permissions: 1, commands: 3, reopened: 0, contextPeak: 3000 }, executionMs: 300, startedAt: 0, endedAt: 2 * H }),
      run({ costUsd: null, tokens: null, startedAt: 0, endedAt: H }),
    ];
    const m = runMetrics(runs, { windowOf: () => 4000 })[0]!.versions[0]!;
    expect(m.costPerRun).toEqual({ median: { value: 2, n: 2, coverage: 2 / 3 }, p90: 3, total: 4 });
    expect(m.tokensPerRun.output).toEqual({ value: 40, n: 2, coverage: 2 / 3 });
    expect(m.contextPeak).toEqual({ median: { value: 2000, n: 2, coverage: 2 / 3 }, max: 3000, ofWindow: 0.5 });
    expect(m.timeToDone.elapsed).toEqual({ value: 2 * H, n: 3, coverage: 1 });
    expect(m.timeToDone.execution).toEqual({ value: 200, n: 2, coverage: 2 / 3 });
    expect(m.questionsPerRun.value).toBeCloseTo(2 / 3);
    expect(m.permissionsPerRun.value).toBeCloseTo(2 / 3);
    expect(m.commandsPerRun).toEqual({ value: 1, n: 3, coverage: 1 });
    expect(median([5, 1, 3])).toBe(3);
    expect(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(9);
    expect(p90([])).toBeNull();
  });

  it('a version with no ended run has no values (unknown, never zero), open runs are counted apart', () => {
    const [m] = runMetrics([run({ endedAt: undefined, endReason: undefined })]);
    expect(m).toMatchObject({ agentId: 'coder', open: 1, versions: [], all: null });
  });

  it('every version has its own row and the all-versions row adds them up', () => {
    const m = one([run({ version: 1, ...outcome('success', 'human') }), run({ version: 2, ...outcome('partial', 'human') })]);
    expect(m.versions.map(v => v.version)).toEqual([1, 2]);
    expect(m.all).toMatchObject({ version: null, ended: 2, successRate: { value: 0.75, n: 2, coverage: 1 } });
  });

  it('reviewer findings: per reviewer version, the first parsed review of each run', () => {
    const target = run();
    const review = (version: number, at: number, findings?: number, blocking?: number) => run({ agentId: 'reviewer', version, reviewOf: target.runId,
      report: { at, outcome: 'done', verified: 'yes', summary: 's', ...(findings !== undefined ? { findings } : {}), ...(blocking !== undefined ? { blocking } : {}) } });
    const m = runMetrics([target, review(1, 20, 9, 9), review(1, 10, 4, 1), review(2, 5, 2), review(3, 5)]).find(x => x.agentId === 'coder')!.versions[0]!;
    expect(m.reviews).toEqual([
      { reviewer: { agentId: 'reviewer', version: 1 }, runs: 1, findingsPerRun: 4, blockingPerRun: { value: 1, n: 1, coverage: 1 } },
      { reviewer: { agentId: 'reviewer', version: 2 }, runs: 1, findingsPerRun: 2, blockingPerRun: { value: null, n: 0, coverage: 0 } },
    ]);
  });

  it('rollups keep the counts of pruned runs; `since` leaves them and older runs out', () => {
    const old = [run({ ...outcome('success', 'human'), costUsd: 1, endedAt: 10 }), run({ ...outcome('fail', 'human'), costUsd: 3, endedAt: 20 })];
    const kept = run({ ...outcome('success', 'human'), costUsd: 5, endedAt: 100 });
    const rollups = rollUp([], old, [...old, kept]);
    expect(rollups).toHaveLength(1);
    expect(rollups[0]).toMatchObject({ agentId: 'coder', version: 1, ended: 2, verdicts: { success: 1, fail: 1 }, cost: { n: 2, values: [1, 3] } });
    const all = one([kept], { rollups }).versions[0]!;
    expect(all.ended).toBe(3);
    expect(all.successRate.value).toBeCloseTo(2 / 3);
    expect(all.costPerRun.median.value).toBe(3);
    expect(one([kept], { rollups, since: 50 }).versions[0]!.ended).toBe(1);
  });

  it('a sample keeps its newest values only, with n counting them all', () => {
    const runs = Array.from({ length: SAMPLE_MAX + 5 }, (_, i) => run({ costUsd: i, endedAt: H + i }));
    const [t] = rollUp([emptyTally('coder', 1)], runs, runs);
    expect(t!.cost.n).toBe(SAMPLE_MAX + 5);
    expect(t!.cost.values).toHaveLength(SAMPLE_MAX);
    expect(t!.cost.values[0]).toBe(5);
  });
});
