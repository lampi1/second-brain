// Versioned reusable flow contracts shared by the host, Orchestrator tools and the decision UI.
// Definitions describe work; only host evidence and exact user decisions advance execution.
import type { FlowAutomationSnapshot } from './flow-automation';
import type { AgentAvatar } from './agents';
import type { ModelTier, WorkRoleId } from './roles';
export interface FlowScope { project?: string; areaPath?: string }
export interface FlowStep {
  id: string; title: string; kind: 'check' | 'agent' | 'approval' | 'manual'; instructions: string;
  inputs: string[]; action?: { kind: 'builtin' | 'script' | 'query' | 'action'; ref: string };
  evidence: string[]; timeoutMs: number; maxAttempts: number;
  effect: 'read-only' | 'code' | 'external-write' | 'production'; reviewOf?: string; workspaceInput?: string;
  /** An external-write agent step that writes only through the host's DevOps write adapter (ADR 0145). */
  adapter?: 'devops-write';
  /** An agent step's role: the bound chat must run it. Absent = the Orchestrator picks the role. */
  role?: WorkRoleId;
  /** An agent step's model tier (at most the role's tierMax; needs role): the bound chat must run on it. Absent = the role's own choice. */
  tier?: ModelTier;
}
export interface FlowDefinition {
  id: string; title: string; description: string; category?: string; aliases: string[];
  scope: FlowScope; steps: FlowStep[];
}
export interface FlowDraft {
  definition: FlowDefinition; revision: number; updatedAt: number;
  status: 'proposed' | 'rejected' | 'active'; feedback?: string;
}
export interface FlowVersion { definition: FlowDefinition; version: number; draftRevision: number; digest: string; activatedAt: number }
export interface FlowReceipt {
  id: string; stepId: string; kind: 'check' | 'agent-report' | 'user'; at: number;
  summary: string; chatId?: string; reportId?: string; evidence: string[];
}
export interface FlowAgentBinding { chatId: string; chatRunId: string; taskVersion: number;
  /** What the host read from the chat at bind (never stored): its role, the tier it launched on, whether its model came from the routing table's row instead of that tier. */
  launched?: { roleId?: string; tier?: ModelTier; fromTable?: boolean } }
export interface FlowVerifiedReport extends FlowAgentBinding { id: string; summary: string; evidence: string[]; completed: boolean; roleId?: string; reviewOf?: string }
export interface FlowStepRun {
  stepId: string; status: 'pending' | 'ready' | 'running' | 'approval' | 'blocked' | 'completed';
  attempts: number; startedAt?: number; chatId?: string; chatRunId?: string; taskVersion?: number;
  reason?: string; receipt?: FlowReceipt; decisionPending?: boolean;
}
export interface FlowRun {
  id: string; revision: number; flowId: string; flowVersion: number; definitionDigest: string;
  ownerOrchestratorId: string; subjectKey: string; scope: FlowScope; inputs: Record<string, string>;
  status: 'active' | 'approval' | 'blocked' | 'completed'; currentStep: number; steps: FlowStepRun[];
  createdAt: number; updatedAt: number;
}
export interface FlowSnapshot {
  contextKey: string; drafts: FlowDraft[]; versions: FlowVersion[]; active: Record<string, number>;
  runs: FlowRun[]; storageError?: string; automation?: FlowAutomationSnapshot;
  /** The work roles as the catalog and the routing table resolve them now, for showing each agent step's role and model. */
  roles?: Partial<Record<WorkRoleId, FlowRoleInfo>>;
}
/** A role's launch facts: its own fixed model (null = none) and, per tier, the model the routing table gives on its engine. */
export interface FlowRoleInfo { name: string; avatar: AgentAvatar; tier: ModelTier; tierMax: ModelTier; model: string | null; models: Partial<Record<ModelTier, string | null>> }
export interface FlowMatch { status: 'none' | 'match' | 'ambiguous'; candidates: FlowVersion[] }
export interface FlowPropose { definition: FlowDefinition; expectedRevision: number }
export interface FlowActivate { id: string; expectedRevision: number; answer: 'yes' | 'no' | 'other'; feedback?: string }
export interface FlowStart { flowId: string; flowVersion: number; subjectKey: string; scope: FlowScope; inputs: Record<string, string> }
export interface FlowReport { runId: string; expectedRevision: number; stepId: string; reportId: string }
export interface FlowDecision { runId: string; expectedRevision: number; stepId: string; answer: 'yes' | 'no' | 'other'; feedback?: string }
/** Binds a renderer decision to the brain whose proposal was actually displayed. */
export type FlowContext<T> = T & { contextKey: string };
