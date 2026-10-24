// Recovery previews bind the visible run to its exact definition and explain prerequisites before the host decides.
// The renderer never creates receipts or treats a preview as permission to skip a check.
import { samePrefix } from '@shared/routine';
import type { FlowDefinition, FlowRun, FlowSnapshot, FlowStep, FlowVersion } from '@shared/flows';

export type FlowRecoveryMode = 'cancel' | 'from-start' | 'from-step';
export interface FlowRecoveryPreview {
  version?: FlowVersion;
  automationRule?: { id: string; revision: number };
  start: number;
  prefix: FlowStep[];
  missing: FlowStep[];
  effects: FlowStep[];
  reason: 'version' | 'active' | 'step' | 'prefix' | 'automation' | null;
}
export const flowRunCanCancel = (run: FlowRun): boolean => ['active', 'approval', 'blocked'].includes(run.status);
export const flowRunVersion = (snapshot: FlowSnapshot, run: FlowRun): FlowVersion | undefined =>
  snapshot.versions.find(version => version.definition.id === run.flowId && version.version === run.flowVersion && version.digest === run.definitionDigest);

export function flowRecoveryPreview(snapshot: FlowSnapshot, run: FlowRun, mode: Exclude<FlowRecoveryMode, 'cancel'>, stepId?: string): FlowRecoveryPreview {
  const active = snapshot.versions.find(row => row.definition.id === run.flowId && row.version === snapshot.active[run.flowId]), own = flowRunVersion(snapshot, run);
  // from a step: the current version when the steps before it did not change (the run moves to it), else the run's own
  const at = own?.definition.steps.findIndex(step => step.id === stepId) ?? -1;
  const version = mode === 'from-start' ? active : active && at > 0 && samePrefix(own?.definition, active.definition, at) ? active : own;
  const start = mode === 'from-start' ? 0 : version?.definition.steps.findIndex(step => step.id === stepId) ?? -1;
  const prefix = version && start > 0 ? version.definition.steps.slice(0, start) : [];
  const missing = prefix.filter(step => !run.steps.some(record => record.stepId === step.id && record.status === 'completed' && record.receipt));
  const effects = version && start >= 0 ? version.definition.steps.slice(start).filter(step => step.effect === 'external-write' || step.effect === 'production') : [];
  const event = snapshot.automation?.events.find(row => row.runId === run.id);
  const ruleId = event?.ruleId ?? /^auto:([^:]+):/.exec(run.subjectKey)?.[1];
  const automatic = !!event || run.subjectKey.startsWith('auto:');
  const rule = ruleId ? snapshot.automation?.rules.find(row => row.id === ruleId) : undefined;
  const automationUnavailable = automatic && (snapshot.automation?.paused || !!snapshot.automation?.storageError || !rule || rule.status !== 'enabled' || rule.approvedRevision !== rule.revision
    || rule.config.flowVersion !== version?.version || rule.ownerOrchestratorId !== run.ownerOrchestratorId
    || Object.keys({ ...rule.config.scope, ...run.scope }).some(key => rule.config.scope[key as keyof typeof run.scope] !== run.scope[key as keyof typeof run.scope])
    || Object.entries(rule.config.inputs).some(([key, value]) => run.inputs[key] !== value));
  return { version, automationRule: rule ? { id: rule.id, revision: rule.revision } : undefined, start, prefix, missing, effects, reason: !version ? mode === 'from-start' ? 'active' : 'version' : start < 0 ? 'step' : missing.length ? 'prefix' : automationUnavailable ? 'automation' : null };
}

/** Free text asks the owning conversation to clarify; it never executes or approves recovery. */
export function flowRecoveryQuestion(run: FlowRun, definition: FlowDefinition | undefined, mode: FlowRecoveryMode, stepId: string | undefined, feedback: string): string {
  return [
    `Routine ${JSON.stringify(definition?.title ?? run.flowId)}; esecuzione ${JSON.stringify(run.id)}, versione ${run.flowVersion}, revisione ${run.revision}.`,
    `Chiarimento sulla richiesta ${JSON.stringify(mode)}${stepId ? ` dal passaggio ${JSON.stringify(stepId)}` : ''}: ${feedback.trim()}`,
    'Questa risposta libera non approva né avvia interruzioni o ripartenze. Chiarisci il punto nella finestra delle domande; conserva le approvazioni e le verifiche richieste.',
  ].join('\n\n');
}
