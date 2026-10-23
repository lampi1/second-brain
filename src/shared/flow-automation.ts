// Portable automatic-flow configuration and durable event envelope, shared with host and decision UI.
// Activation authorizes detection and Orchestrator dispatch only; existing flow gates retain their authority.
import type { FlowScope } from './flows';
export type FlowTrigger = { kind: 'interval'; everyMinutes: number } | {
  kind: 'devops'; everyMinutes: number; organization: string; project: string; areaPath: string;
  workItemType: string; states: string[]; includeExisting: boolean;
};
export interface FlowAutomationConfig {
  flowId: string; flowVersion: number; trigger: FlowTrigger; scope: FlowScope;
  inputs: Record<string, string>; priority: 'urgent' | 'normal';
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
