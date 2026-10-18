// Strip estimates: the agent's medians, only with enough ended runs, only for an open run; time left counts down live.
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn() } }));
import type { AgentMetrics, Metric, VersionMetrics } from '../../src/shared/agents';
import { estimateOf, MIN_RUNS } from '../../src/renderer/lib/agent-estimates';

const m = (value: number | null, n: number): Metric => ({ value, n, coverage: null });
const metrics = (time: Metric, cost: Metric): AgentMetrics[] => [{ agentId: 'a', versions: [], open: 1,
  all: { timeToDone: { elapsed: time, execution: m(null, 0) }, costPerRun: { median: cost, p90: null } } as unknown as VersionMetrics }];
const run = { agentId: 'a', startedAt: 1_000 };

describe('agent run estimates', () => {
  it('uses the medians of enough ended runs and counts the time left', () => {
    const e = estimateOf(run, metrics(m(600_000, MIN_RUNS), m(0.4, 5)), 1_000 + 240_000)!;
    expect(e).toMatchObject({ timeMs: 600_000, costUsd: 0.4, leftMs: 360_000, over: false, timeRuns: MIN_RUNS, costRuns: 5 });
    expect(estimateOf(run, metrics(m(600_000, 3), m(0.4, 5)), 1_000 + 700_000)).toMatchObject({ leftMs: 0, over: true });
  });
  it('says nothing with too few runs, an ended run, an unknown agent or no metrics yet', () => {
    expect(estimateOf(run, metrics(m(600_000, MIN_RUNS - 1), m(0.4, 1)), 2_000)).toBeNull();
    expect(estimateOf({ ...run, endedAt: 5_000 }, metrics(m(600_000, 9), m(0.4, 9)), 6_000)).toBeNull();
    expect(estimateOf({ ...run, agentId: 'b' }, metrics(m(600_000, 9), m(0.4, 9)), 2_000)).toBeNull();
    expect(estimateOf(run, null, 2_000)).toBeNull();
    expect(estimateOf(undefined, metrics(m(600_000, 9), m(0.4, 9)), 2_000)).toBeNull();
  });
  it('keeps a cost-only estimate when time is unknown', () => {
    expect(estimateOf(run, metrics(m(null, 0), m(0.2, 4)), 2_000)).toMatchObject({ timeMs: null, leftMs: null, costUsd: 0.2, over: false });
  });
});
