// What the routine runner decides by itself, shared by the runner (main/flows/runtime.ts) and the Routine page, so the
// page says «riprova da sola» exactly when the runner will (ADR 0153).
import type { FlowDefinition, FlowRun } from './flows';

/** The reason prefix of a block the runner never heals by itself: it needs the user (changed content, a missing input). */
export const HOLD = 'Da sistemare: ';

/** True when the run is blocked on a failure the runner retries by itself (or sends back to the step onFail names). */
export function healable(run: FlowRun, definition: FlowDefinition | undefined): boolean {
  const step = run.steps[run.currentStep], spec = definition?.steps[run.currentStep];
  if (!step || !spec || run.status !== 'blocked' || step.status !== 'blocked' || !step.decisionPending || step.attempts === 0 || step.attempts >= spec.maxAttempts
    || spec.env === 'prod' || (step.reason ?? '').startsWith(HOLD) || run.pendingRecovery || run.pendingCancellation || run.paused) return false;
  if (!spec.onFail) return true;
  const target = definition!.steps.findIndex(item => item.id === spec.onFail!.goto);
  return target >= 0 && run.steps[target]!.attempts < definition!.steps[target]!.maxAttempts;
}
