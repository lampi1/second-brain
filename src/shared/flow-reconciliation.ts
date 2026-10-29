// User-only reconciliation receipts for uncertain DevOps writes; shared by typed IPC and the Routine modal.
export type WriteResolution = 'not-done' | 'reverted' | 'done';
export interface WriteReconciliation { outcome: WriteResolution; note: string; at: number; by: 'user'; organization: string; workItemId: number }
/** Safe routing identity, never a raw request body or credential. */
export interface WriteRequestIdentity { workItemId: number; projectId: string; repositoryId: string; pullRequestId: number }
export interface PendingReconciliation { operationAt?: number; revision: number; requestedAt: number; digest: string; op: string; requestHash: string; outcome: 'applied' | 'not-applied'; evidence: string }
export interface ReconciliationOperation { id: string; op: string; state: string; at?: number; reason?: string; reconciliation?: WriteReconciliation; eligible: boolean; target?: string; request?: WriteRequestIdentity;
  /** the organization and work item the write was made under (kept since 2026-10-27): a receipt needs no live grant */
  scope?: { organization: string; workItemId: number } }
