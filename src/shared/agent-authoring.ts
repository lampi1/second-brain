// Reviewable automatic authoring records, shared by main and the user's decision panel.
import type { AgentDraft, AgentEvidenceRef } from './agents';
export interface AgentUndo { agentId: string; expectedRevision: number; operation: 'archive' | 'restore' | 'version'; version?: number }

export interface AgentProposal {
  id: string; at: number; kind: 'suggestion' | 'proposal'; agentId?: string; baseRevision?: number;
  draft: AgentDraft; before?: AgentDraft; reason: string; expectedEffect: string; evidence: AgentEvidenceRef[];
  state: 'pending' | 'accepted' | 'rejected';
}
/** One feedback record type for the whole app: defined beside agent_feedback's argument shape. */
export type { AgentFeedback } from './agent-lifecycle';
