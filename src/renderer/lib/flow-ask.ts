// Flow review and run gates join the single QuestionsWindow queue. Keys bind brain, immutable version and step.
import type { FlowDraft, FlowRun, FlowSnapshot, FlowVersion } from '@shared/flows';
export interface FlowDefinitionAsk { type: 'flow-definition'; chatId: 'flow'; id: string; at: number; title: string; contextKey: string; draft: FlowDraft }
export interface FlowRunAsk { type: 'flow-run'; chatId: 'flow'; id: string; at: number; title: string; contextKey: string; run: FlowRun; version?: FlowVersion }
export type FlowAsk = FlowDefinitionAsk | FlowRunAsk;
export function flowAsks(snapshot: FlowSnapshot | null): FlowAsk[] {
  if (!snapshot || snapshot.storageError) return [];
  const context = encodeURIComponent(snapshot.contextKey);
  return [
    ...snapshot.drafts.filter(d => d.status === 'proposed').map((draft): FlowDefinitionAsk => ({ type: 'flow-definition', chatId: 'flow', id: `${context}/definition/${draft.definition.id}@${draft.revision}`, at: draft.updatedAt, title: draft.definition.title, contextKey: snapshot.contextKey, draft })),
    ...snapshot.runs.filter(run => (run.status === 'approval' || run.status === 'blocked') && run.steps[run.currentStep] && run.steps[run.currentStep]!.decisionPending !== false).map((run): FlowRunAsk => {
      const version = snapshot.versions.find(v => v.definition.id === run.flowId && v.version === run.flowVersion && v.digest === run.definitionDigest);
      return { type: 'flow-run', chatId: 'flow', id: `${context}/run/${run.id}@${run.revision}:${run.steps[run.currentStep]!.stepId}`, at: run.updatedAt, title: `${version?.definition.title ?? run.flowId} · ${run.subjectKey}`, contextKey: snapshot.contextKey, run, version };
    }),
  ];
}
