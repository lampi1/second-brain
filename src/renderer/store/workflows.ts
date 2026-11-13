// Live, token-free workflow and lesson projections used by the modal queue and its navigation count.
// Decisions preserve the exact visible proposal/version; a refused stale answer remains available for retry.
import type { LearnedRuleProposal } from '@shared/agent-pack';
import type { WorkThread } from '@shared/workflows';
import { sb } from '../sb';
import { createStore } from './createStore';
import { durableAsks } from '../lib/work-ask';
import { toast } from './ui';
export const workflowState = createStore<{ rows: WorkThread[]; lessons: LearnedRuleProposal[]; error: string | null; lessonError: string | null }>({ rows: [], lessons: [], error: null, lessonError: null });
let started = false, workRead = 0, lessonRead = 0;
export async function reloadWorkflows(): Promise<void> {
  const read = ++workRead;
  try { const rows = await sb.invoke('work:list', undefined); if (read === workRead) workflowState.set(s => ({ ...s, rows, error: null })); }
  catch (e) { if (read === workRead) { if (!workflowState.get().error) toast('Proposte di lavoro non disponibili. Riprova con Fai il punto.', 'err'); workflowState.set(s => ({ ...s, error: String(e) })); } }
}
export async function reloadLessons(): Promise<void> {
  const read = ++lessonRead;
  try { const lessons = await sb.invoke('work:lessons', undefined); if (read === lessonRead) workflowState.set(s => ({ ...s, lessons, lessonError: null })); }
  catch (e) { if (read === lessonRead) { if (!workflowState.get().lessonError) toast('Proposte di miglioramento non disponibili. Riprova con Fai il punto.', 'err'); workflowState.set(s => ({ ...s, lessonError: String(e) })); } }
}
export function useWorkflows() {
  if (!started && typeof window !== 'undefined' && window.sb) {
    started = true;
    sb.on('work:changed', rows => { ++workRead; workflowState.set(s => ({ ...s, rows, error: null })); });
    void reloadWorkflows(); void reloadLessons();
    setInterval(() => void reloadLessons(), 30_000);
  }
  return workflowState.use(s => s);
}
export const durableAskKeys = (): string[] => {
  const { rows, lessons } = workflowState.get();
  return durableAsks(rows, lessons).map(p => `${p.chatId}/${p.id}`);
};
export async function decideWork(row: WorkThread, approve: boolean, feedback?: string): Promise<boolean> {
  if (!row.proposal) return false;
  try {
    const next = await sb.invoke('work:decide', { id: row.id, expectedVersion: row.version, proposalId: row.proposal.id, approve, ...(feedback ? { feedback } : {}) });
    ++workRead;
    workflowState.set(s => ({ ...s, rows: s.rows.map(r => r.id === next.id && r.version <= next.version ? next : r) }));
    return true;
  } catch (e) { toast(`Decisione non registrata: ${String(e)}`, 'err'); void reloadWorkflows(); return false; }
}
export async function decideLesson(proposal: LearnedRuleProposal, approve: boolean, feedback?: string): Promise<boolean> {
  try {
    await sb.invoke('work:lessonDecide', { id: proposal.id, rule: proposal.rule, approve, ...(feedback ? { feedback } : {}) });
    ++lessonRead;
    workflowState.set(s => ({ ...s, lessons: s.lessons.filter(p => p.id !== proposal.id || p.rule !== proposal.rule) }));
    return true;
  } catch (e) { toast(`Modifica non applicata: ${String(e)}`, 'err'); void reloadLessons(); return false; }
}
