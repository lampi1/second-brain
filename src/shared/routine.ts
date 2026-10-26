// What the routine runner decides by itself, shared by the runner (main/flows/runtime.ts) and the Routine page, so the
// page says «riprova da sola» exactly when the runner will (ADR 0155).
import type { FlowDefinition, FlowRun, FlowStep } from './flows';
import type { WorkRoleId } from './roles';

/** The reason prefix of a block the runner never heals by itself: it needs the user (changed content, a missing input). */
export const HOLD = 'Da sistemare: ';

/** How many attempts a step may start: its own limit, one per user-reconciled write, one the user granted past the limit. */
export function attemptBudget(spec: Pick<FlowStep, 'maxAttempts'>, step: FlowRun['steps'][number]): number {
  return spec.maxAttempts + (step.reconciliationAttempts ?? 0) + (step.userRetryUsed ? 1 : 0) + (step.userRetryRegrants ?? 0);
}

/** Sì may grant an extra attempt past the limit: the first one, or one more once the app was updated since the last
 *  grant (a step granted before builds were recorded counts as granted by another build). */
export function userRetryOpen(step: FlowRun['steps'][number], appBuild: string | undefined): boolean {
  return !step.userRetryUsed || (!!appBuild && step.userRetryAppBuild !== appBuild);
}

/** An effect of this step whose outcome the run does not know: it must be reconciled before any extra attempt. The
 *  host also refuses on an unknown DevOps write, which lives in its ledger, not in the run. */
export function uncertainEffect(run: FlowRun, step: FlowRun['steps'][number]): boolean {
  const connector = run.connectorReceipts?.findLast(r => r.stepId === step.stepId);
  const browser = run.browserWrites?.findLast(e => e.stepId === step.stepId);
  const command = run.receipts?.findLast(r => r.stepId === step.stepId);
  return !!run.pendingReconciliation || !!connector && ['pending', 'unknown'].includes(connector.outcome)
    || !!browser && ['pending', 'partial'].includes(browser.outcome) || !!command && command.endedAt === undefined;
}

/** True when the run is blocked on a failure the runner retries by itself (or sends back to the step onFail names). */
export function healable(run: FlowRun, definition: FlowDefinition | undefined): boolean {
  const step = run.steps[run.currentStep], spec = definition?.steps[run.currentStep];
  if (!step || !spec || run.status !== 'blocked' || step.status !== 'blocked' || !step.decisionPending || step.attempts === 0 || step.attempts >= spec.maxAttempts
    || spec.env === 'prod' || (step.reason ?? '').startsWith(HOLD) || run.pendingRecovery || run.pendingCancellation || run.pendingReconciliation || run.paused) return false;
  const browser = run.browserWrites?.findLast(e => e.stepId === step.stepId && e.chatRunId === step.chatRunId);
  const connector = run.connectorReceipts?.findLast(r => r.stepId === step.stepId);
  if (connector && connector.outcome !== 'not-done') return false;
  const command = run.receipts?.findLast(r => r.stepId === step.stepId);
  if (command && (command.endedAt === undefined || spec.effect === 'external-write' && command.exitCode !== 0)) return false;
  if (browser && browser.outcome !== 'not-done') return false;
  if (!spec.onFail) return true;
  const target = definition!.steps.findIndex(item => item.id === spec.onFail!.goto);
  return target >= 0 && run.steps[target]!.attempts < definition!.steps[target]!.maxAttempts;
}

/** The role an agent step without one runs as: a review is Sentinel, a read-only step Scout, the rest Artisan. */
export const roleOf = (spec: FlowStep): WorkRoleId => spec.role ?? (spec.reviewOf ? 'sentinel' : spec.effect === 'read-only' ? 'scout' : 'artisan');
/** True when the first `count` steps are the same in both versions: a restart from that step may move the run to the
 *  newer version (ADR 0155), its completed steps carried as they are. */
export function samePrefix(a: FlowDefinition | undefined, b: FlowDefinition, count: number): boolean {
  return !!a && (count === 0 || a.package?.intake === b.package?.intake) && a.steps.length >= count && b.steps.length >= count && a.steps.slice(0, count).every((step, i) => JSON.stringify(step) === JSON.stringify(b.steps[i]));
}
