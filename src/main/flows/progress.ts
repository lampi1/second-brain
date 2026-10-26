// Conservative repeated-failure detection from host evidence. No model judge or inferred code progress is involved.
import { createHash } from 'node:crypto';
import type { FlowCommandReceipt, FlowRun } from '../../shared/flows';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
/** Canonical report IDs change on every fresh worker. Ignore only host diagnostic identity slots, not error data. */
function failureClass(reason: string): string {
  return reason.replace(/^(Report |Expected host reportId )[A-Za-z0-9_-]+:\d+(?= |;)/, '$1<report>')
    .replace(/ Expected reportId: [A-Za-z0-9_-]+:\d+\.$/, ' Expected reportId: <report>.');
}
export function progressFingerprint(run: FlowRun, external: readonly string[] = []): string {
  const command = (r: FlowCommandReceipt) => JSON.stringify([r.stepId, r.kind, r.ref, r.sha256, Object.entries(r.args).sort(), r.exitCode, hash(r.output)]);
  const commands = new Map((run.receipts ?? []).filter(r => r.endedAt !== undefined).map(r => [r.id, command(r)]));
  const records = [
    ...external,
    ...run.steps.flatMap(s => s.receipt ? [JSON.stringify([s.stepId, s.receipt.summary, s.receipt.evidence.map(e => {
      const id = s.receipt!.kind === 'check' && e.startsWith('receipt: ') ? e.slice(9) : undefined;
      return id && commands.has(id) ? `command:${commands.get(id)}` : e;
    })])] : []),
    ...(run.outputs ?? []).map(o => `output:${o.sha256}`),
    ...commands.values(),
    ...(run.testDbEvidence ?? []).filter(r => r.status === 'ok').map(r => JSON.stringify([r.stepId, r.queryHash, r.rowCount, r.truncated])),
  ];
  return hash(JSON.stringify([...new Set(records)].sort()));
}
/** Stop only after three identical failures with identical observed evidence. A user retry starts a new comparison. */
export function repeatedFailure(run: FlowRun, external: readonly string[] = []): boolean {
  const step = run.steps[run.currentStep]; if (!step?.reason || step.attempts < 3) return false;
  const relevant = [...(run.heal ?? [])].reverse().filter(e => e.stepId === step.stepId), last = relevant.slice(0, 2), fingerprint = progressFingerprint(run, external);
  return last.length === 2 && last.every(e => e.action !== 'resume' && failureClass(e.reason) === failureClass(step.reason!) && e.progress === fingerprint);
}
