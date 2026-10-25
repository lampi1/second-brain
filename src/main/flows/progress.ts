// Conservative repeated-failure detection from host evidence. No model judge or inferred code progress is involved.
import { createHash } from 'node:crypto';
import type { FlowRun } from '../../shared/flows';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export function progressFingerprint(run: FlowRun, external: readonly string[] = []): string {
  const records = [
    ...external,
    ...run.steps.flatMap(s => s.receipt ? [JSON.stringify([s.stepId, s.receipt.summary, s.receipt.evidence])] : []),
    ...(run.outputs ?? []).map(o => `output:${o.sha256}`),
    ...(run.receipts ?? []).filter(r => r.endedAt !== undefined).map(r => JSON.stringify([r.stepId, r.sha256, r.exitCode, hash(r.output)])),
    ...(run.testDbEvidence ?? []).filter(r => r.status === 'ok').map(r => JSON.stringify([r.stepId, r.queryHash, r.rowCount, r.truncated])),
  ];
  return hash(JSON.stringify([...new Set(records)].sort()));
}
/** Stop only after three identical failures with identical observed evidence. A user retry starts a new comparison. */
export function repeatedFailure(run: FlowRun, external: readonly string[] = []): boolean {
  const step = run.steps[run.currentStep]; if (!step?.reason || step.attempts < 3) return false;
  const relevant = [...(run.heal ?? [])].reverse().filter(e => e.stepId === step.stepId), last = relevant.slice(0, 2), fingerprint = progressFingerprint(run, external);
  return last.length === 2 && last.every(e => e.action !== 'resume' && e.reason === step.reason && e.progress === fingerprint);
}
