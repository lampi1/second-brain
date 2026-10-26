// Host-only branch ownership for partial recovery. Derives legacy runs from their validated restart chain; a
// restart from the beginning (or the first step) starts a new branch. Never accepts a branch from agent input.
import type { FlowRun } from '../../shared/flows';
export function branchLineage(run: FlowRun, runs: readonly FlowRun[]): string[] {
  const lineage = [run.id]; let current = run;
  while (current.restartOf?.mode === 'from-step' && current.steps.findIndex(s => s.stepId === current.restartOf!.stepId) > 0) {
    const parent = runs.find(r => r.id === current.restartOf!.runId);
    if (!parent || lineage.includes(parent.id)) throw new Error('Invalid host branch restart lineage');
    lineage.push(parent.id); current = parent;
  }
  if (run.restartOf?.branchRunId !== undefined && run.restartOf.branchRunId !== lineage.at(-1)) throw new Error('Invalid inherited branch identity');
  return lineage;
}

/** Older ancestors cannot reclaim a branch behind a newer run, including cancelled runs with uncertain effects. */
export function assertLatestBranch(run: FlowRun, runs: readonly FlowRun[]): void {
  const lineage = branchLineage(run, runs), root = lineage.at(-1);
  if (runs.some(other => !lineage.includes(other.id) && branchLineage(other, runs).at(-1) === root)) throw new Error('A newer run owns this branch; restart from the latest run, or restart from the beginning with a new branch.');
}
