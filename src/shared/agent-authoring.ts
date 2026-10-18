// Reviewable automatic authoring records, shared by main and the user's decision panel.
import type { AgentDraft, AgentEvidenceRef } from './agents';
export interface AgentUndo { agentId: string; expectedRevision: number; operation: 'archive' | 'restore' | 'version'; version?: number }

export interface AgentProposal {
  id: string; at: number; kind: 'suggestion' | 'proposal'; agentId?: string; baseRevision?: number;
  draft: AgentDraft; before?: AgentDraft; reason: string; expectedEffect: string; evidence: AgentEvidenceRef[];
  state: 'pending' | 'accepted' | 'rejected';
  /** what accepting does on an existing agent (absent = 'update', the records written before ops existed):
   *  update = a new version on trial when its behaviour changes (else a plain save); rollback = back to toVersion;
   *  archive / restore = out of / back into the launch list. Nothing applies before the user's agents:proposalDecide. */
  op?: AgentProposalOp; toVersion?: number;
}
export const AGENT_PROPOSAL_OPS = ['update', 'rollback', 'archive', 'restore'] as const;
export type AgentProposalOp = typeof AGENT_PROPOSAL_OPS[number];
/** One feedback record type for the whole app: defined beside agent_feedback's argument shape. */
export type { AgentFeedback } from './agent-lifecycle';
