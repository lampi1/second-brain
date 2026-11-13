// Persistent feature threads and deterministic stage routes; shared by main, MCP and the cockpit.
export const WORK_STAGES = ['analysis', 'mockup', 'plan', 'develop', 'review', 'test', 'pr', 'qa', 'deploy'] as const;
export type WorkStage = typeof WORK_STAGES[number];
export type WorkProfile = 'feature' | 'bugfix' | 'investigation';
export type WorkPriority = 'production' | 'support' | 'normal';
export const WORK_ROUTES: Record<WorkProfile, readonly WorkStage[]> = {
  feature: WORK_STAGES,
  bugfix: ['analysis', 'plan', 'develop', 'review', 'test', 'pr', 'qa', 'deploy'],
  investigation: ['analysis'],
};
export interface WorkEvent { at: number; stage: WorkStage; kind: 'created' | 'updated' | 'completed' | 'proposed' | 'approved' | 'rejected' | 'rework' | 'blocked'; text: string; /** decided by the app for the absent user («Modalità notte», ADR 0191), never by the user */ by?: 'app-away' }
export interface WorkThread {
  id: string; version: number; title: string; profile: WorkProfile; priority: WorkPriority;
  chatIds: string[]; stage: WorkStage; status: 'active' | 'approval' | 'blocked' | 'done';
  summary: string; waitingOn: string; nextAction: string; evidence: string;
  proposal?: { id: string; text: string };
  approvedProposal?: { id: string; text: string };
  implementation?: { chatId: string; runId: string; taskVersion: number };
  planOverride?: boolean;
  cycles: number; createdAt: number; updatedAt: number; events: WorkEvent[];
}
export interface WorkCreate { title: string; profile: WorkProfile; priority: WorkPriority; chatIds: string[] }
export interface WorkReport {
  id: string; expectedVersion: number; action: 'update' | 'complete' | 'propose' | 'fail' | 'block';
  priority?: WorkPriority;
  reviewChatId?: string;
  implementationChatId?: string;
  /** Host-populated from the live chat, never accepted from MCP input. */
  implementation?: { chatId: string; runId: string; taskVersion: number };
  summary: string; waitingOn?: string; nextAction?: string; evidence?: string; chatIds?: string[];
}
export interface WorkDecision { id: string; expectedVersion: number; proposalId: string; approve: boolean; feedback?: string }
export const WORK_LABELS: Record<WorkStage, string> = { analysis: 'Analisi', mockup: 'Mockup', plan: 'Piano', develop: 'Sviluppo', review: 'Review', test: 'Test', pr: 'PR', qa: 'QA', deploy: 'Deploy' };
export const WORK_PRIORITY: Record<WorkPriority, number> = { production: 0, support: 1, normal: 2 };
export function orderWork(a: WorkThread, b: WorkThread): number {
  return Number(a.status === 'done') - Number(b.status === 'done') || WORK_PRIORITY[a.priority] - WORK_PRIORITY[b.priority]
    || Number(b.status === 'approval' || b.status === 'blocked') - Number(a.status === 'approval' || a.status === 'blocked') || a.createdAt - b.createdAt;
}
