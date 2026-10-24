// Portable automatic-flow configuration and durable event envelope, shared with host and decision UI.
// Activation authorizes detection, dispatch and the explicit host grants below; existing flow gates retain their authority.
import type { FlowScope } from './flows';
export type FlowTrigger = { kind: 'interval'; everyMinutes: number } | {
  kind: 'devops'; everyMinutes: number; organization: string; project: string; areaPath: string;
  workItemType: string; states: string[]; includeExisting: boolean;
  /** Filters (ADR 0153): every include tag must be on the item, no exclude tag may be; ids = only these items;
   *  iterationPath = under this iteration; maxPerHour = at most this many starts per hour (queue keeps the rest). */
  includeTags?: string[]; excludeTags?: string[]; workItemIds?: number[]; iterationPath?: string; maxPerHour?: number;
};
/** User-approved DevOps write categories; anything not listed is denied by the host (ADR 0145). */
export const DEVOPS_WRITE_OPS = ['tags', 'comment', 'fields', 'test-plans', 'test-results', 'pr-links'] as const;
export type DevOpsWriteOp = typeof DEVOPS_WRITE_OPS[number];
/** The exact write grant shown in the approval modal: one organization, its projects, ops and work item fields. */
export interface DevOpsWriteGrant { organization: string; projects: string[]; ops: DevOpsWriteOp[]; fields: string[];
  /** DevOps identity ids (GUIDs, lowercase) a comment may @mention; absent or empty = no mentions. Needs the comment op. */
  mentions?: string[] }
/** Local test DB target identifiers explicitly approved for this exact automation revision; absent = deny-all. */
export interface TestDbReadGrant { targetIds: string[] }
export interface FlowAutomationConfig {
  flowId: string; flowVersion: number; trigger: FlowTrigger; scope: FlowScope;
  inputs: Record<string, string>; priority: 'urgent' | 'normal';
  /** Absent = deny-all. Only a devops trigger may carry it; approval is the rule's exact revision. */
  devopsWrite?: DevOpsWriteGrant;
  testDbRead?: TestDbReadGrant;
}
export interface FlowAutomationRule {
  id: string; revision: number; config: FlowAutomationConfig; ownerOrchestratorId: string;
  status: 'proposed' | 'enabled' | 'paused' | 'rejected'; approvedRevision?: number;
  createdAt: number; updatedAt: number; approvedAt?: number; feedback?: string;
  nextCheckAt?: number; lastCheckAt?: number; lastResult?: string; error?: string; failures: number;
  /** Earlier approved revisions still granting the runs they started (a filter edit or a carried new flow version
   *  keeps in-flight runs working, ADR 0153); newest last, at most 10. */
  history?: { revision: number; config: FlowAutomationConfig }[];
}
export interface FlowAutomationEvent {
  id: string; ruleId: string; ruleRevision: number; sourceKey: string; subjectKey: string;
  title: string; inputs: Record<string, string>; createdAt: number; updatedAt: number;
  status: 'pending' | 'notified' | 'started' | 'blocked' | 'cancelled'; attempts: number;
  /** a start the user asked for on one work item (Routine page), not a detection */
  manual?: true;
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
/** «Svuota coda»: the user saw `count` waiting events of this rule and discards exactly those. */
export interface FlowAutomationClear { id: string; count: number }
/** The user's edit of a rule's filters from the Routine page: applied as a new approved revision (their click). */
export interface FlowAutomationFilters { id: string; expectedRevision: number; includeTags: string[]; excludeTags: string[]; workItemIds: number[]; iterationPath?: string; maxPerHour?: number }
/** A detector never writes external state. Cursor is committed atomically with the corresponding events. */
export interface FlowDetectionResult { cursor: Record<string, string>; items: FlowDetectionItem[]; summary: string }
