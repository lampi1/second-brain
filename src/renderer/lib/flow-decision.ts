// Conservative UI capability for an exact flow gate: retries rerun an interrupted agent and never mark work complete.
import { executionChecks, executionKind } from '@shared/flow-execution';
import { attemptBudget, uncertainEffect, userRetryOpen } from '@shared/routine';
import type { FlowAsk } from './flow-ask';
export function flowDecisionMode(ask: FlowAsk): 'approve' | 'retry' | 'blocked' {
  if (ask.type === 'flow-automation') return ask.version ? 'approve' : 'blocked';
  if (ask.type === 'flow-definition') return executionChecks(ask.draft.definition).some(c => c.state === 'unsupported') ? 'blocked' : 'approve';
  if (ask.type === 'flow-reconcile') return ask.run.pendingReconciliation ? 'approve' : 'blocked';
  if (ask.type === 'flow-cancel') return ask.run.pendingCancellation && ['active', 'approval', 'blocked'].includes(ask.run.status) ? 'approve' : 'blocked';
  if (ask.type === 'flow-restart') return ask.version && ask.run.pendingRecovery ? 'approve' : 'blocked';
  const definition = ask.version?.definition, run = ask.run;
  const step = definition?.steps[run.currentStep], current = run.steps[run.currentStep];
  if (!step || !current || current.stepId !== step.id) return 'blocked';
  if (executionKind(step) === 'unsupported' || step.env === 'prod') return 'blocked';
  if (run.status === 'approval') return 'approve';
  if (run.status === 'blocked' && (step.kind === 'agent' && !step.action || step.kind === 'check') && (current.attempts < attemptBudget(step, current) || flowRetryLimit(ask)?.extra)
    && step.inputs.every(key => !!run.inputs[key]?.trim())) return 'retry';
  return 'blocked';
}

/** A blocked step whose attempts are used up. extra: Sì may still grant the ONE last attempt the host allows past the
 *  limit (one more after each app update, never over a write whose outcome is unknown); otherwise the host refuses with
 *  "Retry limit reached". updated: that attempt is open again because the app changed since the last one. */
export function flowRetryLimit(ask: FlowAsk): { attempts: number; max: number; extra: boolean; updated: boolean } | null {
  if (ask.type !== 'flow-run' || ask.run.status !== 'blocked') return null;
  const step = ask.version?.definition.steps[ask.run.currentStep], current = ask.run.steps[ask.run.currentStep];
  if (!step || !current || current.stepId !== step.id || current.attempts < attemptBudget(step, current)) return null;
  const extra = userRetryOpen(current, ask.appBuild) && current.attempts === attemptBudget(step, current) && !uncertainEffect(ask.run, current);
  return { attempts: current.attempts, max: step.maxAttempts, extra, updated: extra && !!current.userRetryUsed };
}

/** The host requires a completion note for manual gates and a value for each declared evidence label. */
export function flowGateEvidence(ask: FlowAsk): { required: boolean; labels: string[] } {
  if (ask.type !== 'flow-run' || ask.run.status !== 'approval') return { required: false, labels: [] };
  const step = ask.version?.definition.steps[ask.run.currentStep];
  return { required: !!step && (step.kind === 'manual' || step.evidence.length > 0), labels: step?.evidence ?? [] };
}
/** Keep evidence submitted with Yes separate from the clarification sent with Other. */
export function flowDecisionSubmission(ask: FlowAsk, answer: 'yes' | 'no' | 'other', feedback: string, evidence: string): { answer: 'yes' | 'no' | 'other'; feedback?: string } | null {
  if (answer === 'other') return feedback.trim() ? { answer, feedback: feedback.trim() } : null;
  if (answer === 'no') return { answer };
  if (flowDecisionMode(ask) === 'blocked') return null;
  const gate = flowGateEvidence(ask), note = evidence.trim();
  if (gate.required && (!note || gate.labels.some(label => !note.split('\n').some(line => line.startsWith(`${label}: `) && line.slice(label.length + 2).trim().length > 0)))) return null;
  return { answer, ...(gate.required ? { feedback: note } : {}) };
}
