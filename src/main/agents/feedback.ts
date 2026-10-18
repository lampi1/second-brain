// Repeated-definition-gap proposals from the Orchestrator's stored feedback. The records themselves live in one store
// only (the authoring store behind the authenticated agent_feedback tool); the lifecycle reads them through FeedbackSource.
// Opinions are always labelled as such and never mutate an execution's outcome here.
import type { AgentFeedback, AgentLifecycleProposal } from '../../shared/agent-lifecycle';

/** Read side of the one feedback store: an agent's records, oldest first; problem = the store cannot be read. */
export interface FeedbackSource { list(agentId: string): AgentFeedback[]; readonly problem: string | null }
export const NO_FEEDBACK: FeedbackSource = { list: () => [], problem: null };

/** Distinct runs, same version and normalized gap key. Unclear goals are explicitly not definition defects; records
 *  without a version or a gap (older ones, or feedback that names no gap) never count. */
export function repeatedGap(entries: readonly AgentFeedback[]): AgentLifecycleProposal | null {
  const latest = entries.at(-1);
  if (!latest || latest.version === undefined || !latest.gap || !latest.gapKey?.trim() || ['none', 'unclear-goal'].includes(latest.gap)) return null;
  const normalize = (s: string) => s.trim().toLocaleLowerCase('en');
  const key = normalize(latest.gapKey);
  const same = entries.slice(-10).filter(f => f.agentId === latest.agentId && f.version === latest.version
    && f.gap === latest.gap && f.gapKey !== undefined && normalize(f.gapKey) === key);
  if (new Set(same.map(f => f.runId)).size < 2) return null;
  return { key: `gap:${latest.agentId}:${latest.version}:${latest.gap}:${key}`, kind: 'update',
    agentIds: [latest.agentId], reason: `Lacuna ripetuta: ${latest.gapKey}`, state: 'pending', at: latest.at,
    evidence: same.map(f => ({ kind: 'feedback', ref: f.id, at: f.at })) };
}
