// Portable automatic-flow configuration and durable event envelope, shared with host and decision UI.
// Activation authorizes detection and Orchestrator dispatch only; existing flow gates retain their authority.
import type { FlowScope } from './flows';
export type FlowTrigger = { kind: 'interval'; everyMinutes: number } | {
  kind: 'devops'; everyMinutes: number; organization: string; project: string; areaPath: string;
  workItemType: string; states: string[]; includeExisting: boolean;
};
/** User-approved DevOps write categories; anything not listed is denied by the host (ADR 0145). */
export const DEVOPS_WRITE_OPS = ['tags', 'comment', 'fields', 'test-plans', 'test-results', 'pr-links'] as const;
export type DevOpsWriteOp = typeof DEVOPS_WRITE_OPS[number];
/** The exact write grant shown in the approval modal: one organization, its projects, ops and work item fields. */
export interface DevOpsWriteGrant { organization: string; projects: string[]; ops: DevOpsWriteOp[]; fields: string[];
  /** DevOps identity ids (GUIDs, lowercase) a comment may @mention; absent or empty = no mentions. Needs the comment op. */
  mentions?: string[] }
export interface FlowAutomationConfig {
  flowId: string; flowVersion: number; trigger: FlowTrigger; scope: FlowScope;
  inputs: Record<string, string>; priority: 'urgent' | 'normal';
  /** Absent = deny-all. Only a devops trigger may carry it; approval is the rule's exact revision. */
  devopsWrite?: DevOpsWriteGrant;
}
export interface FlowAutomationRule {
  id: string; revision: number; config: FlowAutomationConfig; ownerOrchestratorId: string;
  status: 'proposed' | 'enabled' | 'paused' | 'rejected'; approvedRevision?: number;
  createdAt: number; updatedAt: number; approvedAt?: number; feedback?: string;
  nextCheckAt?: number; lastCheckAt?: number; lastResult?: string; error?: string; failures: number;
}
export interface FlowAutomationEvent {
  id: string; ruleId: string; ruleRevision: number; sourceKey: string; subjectKey: string;
  title: string; inputs: Record<string, string>; createdAt: number; updatedAt: number;
  status: 'pending' | 'notified' | 'started' | 'blocked' | 'cancelled'; attempts: number;
  nextAttemptAt?: number; runId?: string; reason?: string;
}
export interface FlowAutomationSnapshot {
  revision: number; paused: boolean; background: boolean; rules: FlowAutomationRule[];
  events: FlowAutomationEvent[]; storageError?: string;
}
export interface FlowAutomationPropose { config: FlowAutomationConfig; expectedRevision: number }
export interface FlowAutomationDecision { id: string; expectedRevision: number; answer: 'yes' | 'no' | 'other'; feedback?: string }
export interface FlowAutomationPause { id: string; expectedRevision: number; paused: boolean }
export interface FlowAutomationControl { expectedRevision: number; paused?: boolean; background?: boolean }
export interface FlowDetectionItem { key: string; title: string; inputs: Record<string, string> }
/** A detector never writes external state. Cursor is committed atomically with the corresponding events. */
export interface FlowDetectionResult { cursor: Record<string, string>; items: FlowDetectionItem[]; summary: string }
