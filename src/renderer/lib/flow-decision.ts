// Conservative UI capability for an exact flow gate: retries rerun an interrupted agent and never mark work complete.
import { browserWriteStep } from '@shared/flow-browser';
import type { FlowAsk } from './flow-ask';
export function flowDecisionMode(ask: FlowAsk): 'approve' | 'retry' | 'blocked' {
  if (ask.type === 'flow-automation') return ask.version ? 'approve' : 'blocked';
  if (ask.type === 'flow-definition') return 'approve';
  if (ask.type === 'flow-cancel') return ask.run.pendingCancellation && ['active', 'approval', 'blocked'].includes(ask.run.status) ? 'approve' : 'blocked';
  if (ask.type === 'flow-restart') return ask.version && ask.run.pendingRecovery ? 'approve' : 'blocked';
  const definition = ask.version?.definition, run = ask.run;
  const step = definition?.steps[run.currentStep], current = run.steps[run.currentStep];
  if (!step || !current || current.stepId !== step.id) return 'blocked';
  if ((step.effect === 'external-write' && !browserWriteStep(step)) || step.effect === 'production') return 'blocked';
  if (run.status === 'approval') return 'approve';
  if (run.status === 'blocked' && step.kind === 'agent' && !step.action && current.attempts < step.maxAttempts
    && step.inputs.every(key => !!run.inputs[key]?.trim())) return 'retry';
  return 'blocked';
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
