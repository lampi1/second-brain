// User-only reconciliation receipts for uncertain DevOps writes; shared by typed IPC and the Routine modal.
export type WriteResolution = 'not-done' | 'reverted' | 'done';
export interface WriteReconciliation { outcome: WriteResolution; note: string; at: number; by: 'user'; organization: string; workItemId: number }
/** Safe routing identity, never a raw request body or credential. */
export interface WriteRequestIdentity { workItemId: number; projectId: string; repositoryId: string; pullRequestId: number }
export interface ReconcileProposal { runId: string; expectedRevision: number; op: string; requestHash: string; outcome: 'applied' | 'not-applied'; evidence: string }
export interface PendingReconciliation { operationAt?: number; revision: number; requestedAt: number; digest: string; op: string; requestHash: string; outcome: 'applied' | 'not-applied'; evidence: string }
export interface ReconcileDecision { runId: string; expectedRevision: number; answer: 'yes' | 'no' }
export interface ReconciliationOperation { id: string; op: string; state: string; at?: number; reason?: string; reconciliation?: WriteReconciliation; eligible: boolean; target?: string; request?: WriteRequestIdentity;
  /** the organization and work item the write was made under (kept since 2026-10-27): a receipt needs no live grant */
  scope?: { organization: string; workItemId: number } }
export interface ReconciliationView { runId: string; revision: number; workItem?: { organization: string; id: number; url: string }; digest: string; operations: ReconciliationOperation[]; canReconcile: boolean; blockedReason?: string }
export interface ReconcileWrites { runId: string; expectedRevision: number; digest: string; decisions: { id: string; outcome: WriteResolution; note: string }[] }
