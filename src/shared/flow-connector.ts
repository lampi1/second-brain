// Sealed, deterministic calls to user-registered test connectors; arguments are data, never code or credentials.
import type { WorkRoleId } from './roles';
export interface FlowConnectorCall {
  serverId: string; tool: string; serverHash: string; toolHash: string; role: WorkRoleId;
  arguments: Record<string, unknown>;
}
export interface FlowConnectorReceipt {
  id: string; stepId: string; serverId: string; tool: string; at: number; finishedAt?: number;
  outcome: 'pending' | 'done' | 'not-done' | 'unknown'; dispatched: boolean;
  summary: string;
}
