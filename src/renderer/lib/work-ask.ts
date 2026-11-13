// Version-bound workflow and learned-rule decisions for the shared questions queue, including archived work.
import type { LearnedRuleProposal } from '@shared/agent-pack';
import type { WorkThread } from '@shared/workflows';
export interface WorkAsk { type: 'work'; chatId: 'workflow'; id: string; at: number; title: string; row: WorkThread }
export interface LessonAsk { type: 'lesson'; chatId: 'lesson'; id: string; at: number; title: string; proposal: LearnedRuleProposal }
export type DurableAsk = WorkAsk | LessonAsk;
export function durableAsks(rows: readonly WorkThread[], lessons: readonly LearnedRuleProposal[]): DurableAsk[] {
  return [
    ...rows.filter(r => r.status === 'approval' && r.proposal).map((row): WorkAsk => ({ type: 'work', chatId: 'workflow', id: `${row.id}@${row.version}:${row.proposal!.id}`, at: row.updatedAt, title: row.title, row })),
    ...lessons.filter(p => p.status === 'pending').map((proposal): LessonAsk => ({ type: 'lesson', chatId: 'lesson', id: `${proposal.id}@${encodeURIComponent(proposal.rule)}`, at: proposal.createdAt, title: `Miglioramento · ${proposal.agentId}`, proposal })),
  ];
}
/** Existing requests (and their permission ordering) stay first. Durable decisions never interrupt them. */
export function withDurableAsks<T>(pending: readonly T[], decisions: readonly DurableAsk[]): (T | DurableAsk)[] {
  return [...pending, ...decisions];
}
