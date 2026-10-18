// Feedback and approval-only lifecycle records, shared by agent services and their UI/API adapters.
import type { AgentEvidenceRef, AgentRunOutcome, VersionMetrics } from './agents';

export type DefinitionGap = 'instructions' | 'tools' | 'model-effort' | 'unclear-goal' | 'none';
export interface AgentFeedback {
  id: string; agentId: string; runId: string; version: number; at: number;
  verdict: AgentRunOutcome['verdict']; basis: 'orchestrator-opinion';
  worked: string; failed: string; gap: DefinitionGap; gapKey: string;
  evidence: AgentEvidenceRef[];
}
export interface TrialEvaluation {
  decision: 'wait' | 'keep' | 'revert'; reason: string; at: number;
  before: VersionMetrics | null; after: VersionMetrics | null; other: VersionMetrics | null;
  comparable: number; otherRuns: number; unknownRouting: number;
}
export interface AgentLifecycleProposal {
  key: string; kind: 'update' | 'create' | 'merge' | 'model-trial' | 'split' | 'keep' | 'revert';
  agentIds: string[]; reason: string; evidence: AgentEvidenceRef[]; at: number;
  state: 'pending'; metrics?: { before: VersionMetrics | null; after: VersionMetrics | null };
}
/** Read model for the approval panel. Transport is supplied by the typed IPC integration. */
export interface AgentLifecycleSnapshot {
  proposals: AgentLifecycleProposal[];
  evaluations: { agentId: string; version: number; result: TrialEvaluation }[];
  feedback: AgentFeedback[];
  problem: string | null;
}
export interface AgentLifecycleQuery { agentId?: string }
export interface AgentLifecycleClient {
  read(query: AgentLifecycleQuery): Promise<AgentLifecycleSnapshot>;
}
export const AGENT_LIFECYCLE_PATH = '/api/agents/lifecycle';
