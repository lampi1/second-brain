// Macro tasks (#160): only top-level runs are rows; each row's cost is its own plus every descendant's (children,
// grandchildren, reviews, reworks, follow-ups); an unknown part makes the whole unknown; links that loop or point at a
// pruned run never hang or crash; rows sit on their start day.
import { describe, expect, it } from 'vitest';
import type { AgentRun } from '../../src/shared/agents';
import { dayTotal, macroDay, macroTasks } from '../../src/shared/macro-tasks';

let n = 0;
const run = (o: Partial<AgentRun> = {}): AgentRun => ({
  runId: `r_${(0xa00000000000 + ++n).toString(16)}`, chatId: `c${n}`, agentId: 'scout', version: 1, goal: 'Cerca', startedBy: 'orchestrator',
  startedAt: 1000 + n, endedAt: 2000 + n, endReason: 'completed', costUsd: 1, tokens: null,
  counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, ...o,
});

describe('macroTasks (#160)', () => {
  it('a tree of three levels: one row, the sum of all', () => {
    const root = run({ costUsd: 1 }), child = run({ parentRunId: root.runId, costUsd: 0.5 }), grand = run({ parentRunId: child.runId, costUsd: 0.25 });
    const review = run({ reviewOf: root.runId, costUsd: 0.1 }), rework = run({ reworkOf: root.runId, costUsd: 0.2 });
    const rows = macroTasks([grand, child, root, review, rework]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: root.runId, costUsd: 2.05, runs: 5 });
  });

  it('one unknown part: the whole is unknown, never a partial sum', () => {
    const root = run(), child = run({ parentRunId: root.runId, costUsd: null });
    expect(macroTasks([root, child])[0]!.costUsd).toBeNull();
    expect(dayTotal(macroTasks([root, child]))).toBeNull();
  });

  it('a follow-up of the same task is the same row; its outcome and end are the latest', () => {
    const first = run({ chatId: 'w', report: { at: 1, outcome: 'done', verified: 'yes', summary: 's' } });
    const next = run({ chatId: 'w', continuedFrom: first.runId, taskId: first.runId, endedAt: undefined, endReason: undefined, costUsd: 0.5 });
    const rows = macroTasks([first, next]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: 'running', costUsd: 1.5 });
    expect(rows[0]!.endedAt).toBeUndefined();
  });

  it('a cycle or a pruned parent never loops or crashes', () => {
    const a = run(), b = run({ parentRunId: a.runId });
    a.parentRunId = b.runId; // a loop: neither is a root
    const orphan = run({ parentRunId: 'r_ffffffffffff' }); // its parent was pruned: a root of its own
    expect(macroTasks([a, b, orphan]).map(r => r.id)).toEqual([orphan.runId]);
  });

  it('newest first, since filters by start, one-shot jobs are no task', () => {
    const old = run({ startedAt: 10 }), recent = run({ startedAt: 5000 }), pulse = run({ startedAt: 6000, source: 'oneshot' });
    expect(macroTasks([old, recent, pulse], 100).map(r => r.id)).toEqual([recent.runId]);
  });

  it('a task spanning midnight sits on its start day', () => {
    const start = new Date(2026, 9, 21, 23, 50).getTime();
    expect(macroDay({ startedAt: start })).toBe('2026-10-21');
  });
});
