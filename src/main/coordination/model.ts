// Serializable coordination contracts for the host and runtime. Receipts describe facts, never grant tool authority.
export interface RequestKey {
  originalRequestId: string;
  jobId: string;
  chatId: string;
  runId: string | null;
  taskVersion: number;
  proposalRevision: number;
  proposalHash: string;
}
export type DecisionActor = { kind: 'user'; channel: 'pc' | 'phone' | 'remote-control' }
  | { kind: 'policy'; policy: string } | { kind: 'agent-relay'; chatId: string };
export interface DecisionReceipt {
  id: string; key: RequestKey; at: number; actor: DecisionActor; answer: unknown;
}
export interface DeliveryReceipt {
  id: string; decisionId: string; at: number; state: 'dispatching' | 'delivered' | 'failed' | 'uncertain'; detail?: string;
}
export interface ExecutionEvidence {
  id: string; decisionId: string; at: number; source: 'runtime' | 'agent-report'; reference: string;
}
export interface RequestRecord {
  id: string; key: RequestKey; kind: 'question' | 'permission' | 'command' | 'plan' | 'workflow';
  at: number; payload: unknown; state: 'pending' | 'accepted' | 'cancelled';
  decision?: DecisionReceipt; delivery?: DeliveryReceipt;
}
export interface WorkProjection {
  state: 'active' | 'waiting-user' | 'blocked' | 'reported' | 'done';
  waitingOn: string; nextAction: string;
  evidence: { source: 'workflow' | 'request' | 'run' | 'chat'; id: string; detail: string }[];
  assignments: { chatId: string; runId: string | null; taskVersion: number; closed: boolean }[];
  requests: { id: string; key: RequestKey; state: RequestRecord['state']; decision?: DecisionReceipt; delivery?: DeliveryReceipt }[];
}
