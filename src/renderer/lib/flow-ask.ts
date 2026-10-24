// Flow review and run gates join the single QuestionsWindow queue. Keys bind brain, immutable version and step.
import type { FlowAutomationRule } from '@shared/flow-automation';
import type { FlowDraft, FlowRun, FlowSnapshot, FlowVersion } from '@shared/flows';
export interface FlowDefinitionAsk { type: 'flow-definition'; chatId: 'flow'; id: string; at: number; title: string; contextKey: string; draft: FlowDraft }
export interface FlowRunAsk { type: 'flow-run'; chatId: 'flow'; id: string; at: number; title: string; contextKey: string; run: FlowRun; version?: FlowVersion }
export interface FlowAutomationAsk { type: 'flow-automation'; chatId: 'flow'; id: string; at: number; title: string; contextKey: string; rule: FlowAutomationRule; version?: FlowVersion }
export interface FlowRestartAsk { type: 'flow-restart'; chatId: 'flow'; id: string; at: number; title: string; contextKey: string; run: FlowRun; version?: FlowVersion }
export interface FlowCancelAsk { type: 'flow-cancel'; chatId: 'flow'; id: string; at: number; title: string; contextKey: string; run: FlowRun; version?: FlowVersion }
export type FlowAsk = FlowDefinitionAsk | FlowRunAsk | FlowAutomationAsk | FlowRestartAsk | FlowCancelAsk;
export function flowAsks(snapshot: FlowSnapshot | null): FlowAsk[] {
  if (!snapshot || snapshot.storageError) return [];
  const context = encodeURIComponent(snapshot.contextKey);
  return [
    ...(!snapshot.automation?.storageError ? snapshot.automation?.rules ?? [] : []).filter(rule => rule.status === 'proposed').map((rule): FlowAutomationAsk => {
      const version = snapshot.versions.find(v => v.definition.id === rule.config.flowId && v.version === rule.config.flowVersion);
      return { type: 'flow-automation', chatId: 'flow', id: `${context}/automation/${encodeURIComponent(rule.id)}@${rule.revision}`, at: rule.updatedAt, title: version?.definition.title ?? rule.config.flowId, contextKey: snapshot.contextKey, rule, version };
    }),
    ...snapshot.drafts.filter(d => d.status === 'proposed').map((draft): FlowDefinitionAsk => ({ type: 'flow-definition', chatId: 'flow', id: `${context}/definition/${draft.definition.id}@${draft.revision}`, at: draft.updatedAt, title: draft.definition.title, contextKey: snapshot.contextKey, draft })),
    ...snapshot.runs.filter(run => run.pendingCancellation).map((run): FlowCancelAsk => {
      const version = snapshot.versions.find(v => v.definition.id === run.flowId && v.version === run.flowVersion && v.digest === run.definitionDigest);
      return { type: 'flow-cancel', chatId: 'flow', id: `${context}/cancel/${run.id}@${run.revision}:${run.pendingCancellation!.revision}`, at: run.pendingCancellation!.requestedAt, title: `${version?.definition.title ?? run.flowId} · ${run.subjectKey}`, contextKey: snapshot.contextKey, run, version };
    }),
    ...snapshot.runs.filter(run => !run.pendingCancellation && run.pendingRecovery).map((run): FlowRestartAsk => {
      const proposal = run.pendingRecovery!;
      const version = snapshot.versions.find(v => v.definition.id === run.flowId && v.version === proposal.targetVersion && v.digest === proposal.targetDigest);
      return { type: 'flow-restart', chatId: 'flow', id: `${context}/restart/${run.id}@${run.revision}:${proposal.revision}`, at: proposal.requestedAt, title: `${version?.definition.title ?? run.flowId} · ${run.subjectKey}`, contextKey: snapshot.contextKey, run, version };
    }),
    ...snapshot.runs.filter(run => !run.pendingRecovery && !run.pendingCancellation && (run.status === 'approval' || run.status === 'blocked') && run.steps[run.currentStep] && run.steps[run.currentStep]!.decisionPending !== false).map((run): FlowRunAsk => {
      const version = snapshot.versions.find(v => v.definition.id === run.flowId && v.version === run.flowVersion && v.digest === run.definitionDigest);
      return { type: 'flow-run', chatId: 'flow', id: `${context}/run/${run.id}@${run.revision}:${run.steps[run.currentStep]!.stepId}`, at: run.updatedAt, title: `${version?.definition.title ?? run.flowId} · ${run.subjectKey}`, contextKey: snapshot.contextKey, run, version };
    }),
  ];
}
