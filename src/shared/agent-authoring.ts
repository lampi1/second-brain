// Reviewable automatic authoring records, shared by main and the user's decision panel.
import type { AgentDraft, AgentEvidenceRef, AgentRunOutcome } from './agents';
export interface AgentUndo { agentId: string; expectedRevision: number; operation: 'archive' | 'restore' | 'version'; version?: number }

export interface AgentProposal {
  id: string; at: number; kind: 'suggestion' | 'proposal'; agentId?: string; baseRevision?: number;
  draft: AgentDraft; before?: AgentDraft; reason: string; expectedEffect: string; evidence: AgentEvidenceRef[];
  state: 'pending' | 'accepted' | 'rejected';
}
export interface AgentFeedback {
  id: string; at: number; agentId: string; runId: string; outcome: AgentRunOutcome; evidence: AgentEvidenceRef[];
}
