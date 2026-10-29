// The strips' estimate texts (renderer lib/run-estimates.ts, ADR 0087): figures, the runs to ask for, and the accuracy
// summary. The Orchestrator's plan panel is gone (#124).
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: vi.fn() } }));
import type { ChatSummary } from '../../src/shared/contract';
import type { AgentRun } from '../../src/shared/agents';
import type { EstimateAccuracy, TaskEstimate } from '../../src/shared/task-estimate';
import { accuracySummary, estimateText, runIdsOf } from '../../src/renderer/lib/run-estimates';

const NOW = new Date(2026, 9, 19, 15).getTime();
const runOf = (id: string, p: Partial<AgentRun> = {}): AgentRun => ({ runId: id, chatId: `c-${id}`, agentId: 'artisan', version: 1, goal: 'g', startedBy: 'orchestrator', startedAt: NOW - 3600_000,
  costUsd: null, tokens: null, counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, ...p });
const chat = (id: string, run?: AgentRun): ChatSummary => ({ id, title: `T ${id}`, run } as unknown as ChatSummary);
const est = (p: Partial<TaskEstimate> = {}): TaskEstimate => ({ kind: 'bug-fix', basis: 'agent-kind', n: 12, timeMs: 4 * 60_000, timeLowMs: null, timeHighMs: null, costUsd: 0.12, costLowUsd: null, costHighUsd: null,
  confidence: 'high', parts: 1, quick: true, path: 'one-agent', why: '', ...p });

describe('estimate texts', () => {
  it('writes "~4 min" and the cost, null where there is no figure', () => {
    const t = estimateText(est());
    expect(t.time).toBe('~4 min');
    expect(t.cost).toMatch(/^~0[,.]12\s\$$/);
    expect(estimateText(est({ timeMs: null, costUsd: null }))).toEqual({ time: null, cost: null });
  });
});

describe('the runs to ask for', () => {
  it('invalidates late settled usage but ignores per-token metrics of unfinished runs', () => {
    const run = runOf('r_000000000001');
    const key = (r: AgentRun) => runIdsOf([chat('x', r)]).key;
    expect(key({ ...run, costUsd: 5, executionMs: 500 })).toBe(key(run));
    const ended = { ...run, endedAt: NOW, endReason: 'completed' as const };
    for (const patch of [{ costUsd: 5 }, { executionMs: 500 }, { endReason: 'stale' as const }]) expect(key({ ...ended, ...patch })).not.toBe(key(ended));
  });
  it('lists runs newest first and changes its key when one ends', () => {
    const a = runOf('r_000000000001', { startedAt: 1 }), b = runOf('r_000000000002', { startedAt: 2 });
    const one = runIdsOf([chat('x', a), chat('y', b), chat('z'), undefined]);
    expect(one.ids).toEqual(['r_000000000002', 'r_000000000001']);
    expect(runIdsOf([chat('x', { ...a, endedAt: 5 }), chat('y', b)]).key).not.toBe(one.key);
  });
});

describe('accuracy summary', () => {
  it('says k of n within ×2, the weekly bars and the specific share (no trend, ADR 0101)', () => {
    const a: EstimateAccuracy = { n: 20, hits: 14, hitRate: 0.684, points: [
      { weekStart: 1, n: 0, hitRate: null, medianErr: null, specificShare: null },
      { weekStart: 2, n: 8, hitRate: 0.5, medianErr: 0.6, specificShare: 0.25 },
      { weekStart: 3, n: 12, hitRate: 0.75, medianErr: 0.3, specificShare: 0.8 },
    ] };
    expect(accuracySummary(a)).toEqual({ pct: 68, k: 14, n: 20, weeks: 2, specificPct: 80, bars: [{ weekStart: 1, pct: null, n: 0 }, { weekStart: 2, pct: 50, n: 8 }, { weekStart: 3, pct: 75, n: 12 }] });
    expect(accuracySummary({ n: 0, hits: 0, hitRate: null, points: [] })).toBeNull();
    expect(accuracySummary(null)).toBeNull();
  });
});
