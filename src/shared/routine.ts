// What the routine runner decides by itself, shared by the runner (main/flows/runtime.ts) and the Routine page, so the
// page says «riprova da sola» exactly when the runner will (ADR 0153).
import type { FlowDefinition, FlowRun, FlowStep } from './flows';
import type { WorkRoleId } from './roles';

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

/** The role an agent step without one runs as: a review is Sentinel, a read-only step Scout, the rest Artisan. */
export const roleOf = (spec: FlowStep): WorkRoleId => spec.role ?? (spec.reviewOf ? 'sentinel' : spec.effect === 'read-only' ? 'scout' : 'artisan');
/** True when the first `count` steps are the same in both versions: a restart from that step may move the run to the
 *  newer version (ADR 0153), its completed steps carried as they are. */
export function samePrefix(a: FlowDefinition | undefined, b: FlowDefinition, count: number): boolean {
  return !!a && a.steps.length >= count && b.steps.length >= count && a.steps.slice(0, count).every((step, i) => JSON.stringify(step) === JSON.stringify(b.steps[i]));
}
