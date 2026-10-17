// Authoritative automatic-archive deadline and renderer presence lease. Imported by main and renderer;
// the integrator adds the IPC/event registrations to contract.ts. No agent/MCP permission is implied.
export interface AutoCloseStatus {
  chatId: string;
  deadline: number | null;
  warningStartedAt: number | null;
  generation: number;
  keptOpen: boolean;
  reason: string | null;
  /** Main clock sample paired with deadline; renderer calculates remaining time with its own monotonic elapsed clock. */
  clockAt: number;
}
export interface AutoClosePresence {
  chatId: string;
  draft: boolean;
  shown: boolean;
  browser: boolean;
  queued: number;
  /** Compatibility field name: opaque positive interaction sequence, not wall-clock authority. */
  touchedAt: number;
  ackDeadline?: number;
  ackGeneration?: number;
}
