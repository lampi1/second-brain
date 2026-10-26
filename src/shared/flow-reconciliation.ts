// User-only reconciliation receipts for uncertain DevOps writes; shared by typed IPC and the Routine modal.
export type WriteResolution = 'not-done' | 'reverted' | 'done';
export interface WriteReconciliation { outcome: WriteResolution; note: string; at: number; by: 'user'; organization: string; workItemId: number }
export interface ReconciliationOperation { id: string; op: string; state: string; at?: number; reason?: string; reconciliation?: WriteReconciliation; eligible: boolean; target?: string }
export interface ReconciliationView { runId: string; revision: number; workItem?: { organization: string; id: number; url: string }; digest: string; operations: ReconciliationOperation[]; canReconcile: boolean; blockedReason?: string }
export interface ReconcileWrites { runId: string; expectedRevision: number; digest: string; decisions: { id: string; outcome: WriteResolution; note: string }[] }
