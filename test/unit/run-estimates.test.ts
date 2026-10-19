// The strips' and the Orchestrator plan's estimate texts (renderer lib/run-estimates.ts, ADR 0087): figures, the runs to
// ask for, today's plan with its sum and fast-path count, and the accuracy summary.
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: vi.fn() } }));
import type { ChatSummary } from '../../src/shared/contract';
import type { AgentRun } from '../../src/shared/agents';
import type { EstimateAccuracy, RunEstimateView, TaskEstimate } from '../../src/shared/task-estimate';
import { accuracySummary, estimateText, planOf, runIdsOf } from '../../src/renderer/lib/run-estimates';

const NOW = new Date(2026, 9, 19, 15).getTime();
const runOf = (id: string, p: Partial<AgentRun> = {}): AgentRun => ({ runId: id, chatId: `c-${id}`, agentId: 'artisan', version: 1, goal: 'g', startedBy: 'orchestrator', startedAt: NOW - 3600_000,
  costUsd: null, tokens: null, counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, ...p });
const chat = (id: string, run?: AgentRun): ChatSummary => ({ id, title: `T ${id}`, run } as unknown as ChatSummary);
const est = (p: Partial<TaskEstimate> = {}): TaskEstimate => ({ kind: 'fix', basis: 'agent-kind', n: 12, timeMs: 4 * 60_000, timeLowMs: null, timeHighMs: null, costUsd: 0.12, costLowUsd: null, costHighUsd: null,
  confidence: 'high', parts: 1, quick: true, path: 'one-agent', why: '', ...p });
const view = (runId: string, e: TaskEstimate | null): RunEstimateView => ({ runId, estimate: e, actual: null, hit: null });

describe('estimate texts', () => {
  it('writes "~4 min" and the cost, null where there is no figure', () => {
    const t = estimateText(est());
    expect(t.time).toBe('~4 min');
    expect(t.cost).toMatch(/^~0[,.]12\s\$$/);
    expect(estimateText(est({ timeMs: null, costUsd: null }))).toEqual({ time: null, cost: null });
  });
});

describe('the runs to ask for', () => {
  it('lists runs newest first and changes its key when one ends', () => {
    const a = runOf('r_000000000001', { startedAt: 1 }), b = runOf('r_000000000002', { startedAt: 2 });
    const one = runIdsOf([chat('x', a), chat('y', b), chat('z'), undefined]);
    expect(one.ids).toEqual(['r_000000000002', 'r_000000000001']);
    expect(runIdsOf([chat('x', { ...a, endedAt: 5 }), chat('y', b)]).key).not.toBe(one.key);
  });
});

describe('the Orchestrator plan', () => {
  it('keeps today\'s runs it started, sums their estimates and counts the fast path', () => {
    const today = runOf('r_000000000001'), mine2 = runOf('r_000000000002', { startedAt: NOW - 60_000 });
    const user = runOf('r_000000000003', { startedBy: 'user' }), old = runOf('r_000000000004', { startedAt: NOW - 3 * 86400_000 });
    const plan = planOf([chat('a', today), chat('b', mine2), chat('c', user), chat('d', old), chat('e')], {
      r_000000000001: view('r_000000000001', est()),
      r_000000000002: view('r_000000000002', est({ timeMs: 20 * 60_000, costUsd: 1, quick: false, path: 'tree' })),
    }, NOW);
    expect(plan.rows.map(r => r.chat.id)).toEqual(['b', 'a']);
    expect(plan).toMatchObject({ timeMs: 24 * 60_000, costUsd: 1.12, estimated: 2, quick: 1 });
    expect(planOf([chat('a', today)], undefined, NOW)).toMatchObject({ estimated: 0, timeMs: 0 });
  });
});

describe('accuracy summary', () => {
  it('says the share, the trend in points, the weekly bars and the specific share', () => {
    const a: EstimateAccuracy = { n: 20, hitRate: 0.684, trend: 0.25, points: [
      { weekStart: 1, n: 0, hitRate: null, medianErr: null, specificShare: null },
      { weekStart: 2, n: 8, hitRate: 0.5, medianErr: 0.6, specificShare: 0.25 },
      { weekStart: 3, n: 12, hitRate: 0.75, medianErr: 0.3, specificShare: 0.8 },
    ] };
    expect(accuracySummary(a)).toEqual({ pct: 68, n: 20, trendPts: 25, weeks: 2, specificPct: 80, bars: [{ weekStart: 1, pct: null, n: 0 }, { weekStart: 2, pct: 50, n: 8 }, { weekStart: 3, pct: 75, n: 12 }] });
    expect(accuracySummary({ n: 0, hitRate: null, trend: null, points: [] })).toBeNull();
    expect(accuracySummary(null)).toBeNull();
  });
});
