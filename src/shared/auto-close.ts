// Authoritative automatic-archive deadline and renderer presence lease. Imported by main and renderer;
// the integrator adds the IPC/event registrations to contract.ts. No agent/MCP permission is implied.
export interface AutoCloseStatus {
  chatId: string;
  deadline: number | null;
  warningStartedAt: number | null;
  generation: number;
  keptOpen: boolean;
  reason: string | null;
  /** what the chat waits for while it stays open (ADR 0084): the tile shows "In attesa di…" (absent = nothing) */
  waitingFor?: AutoCloseWaiting;
  /** Main clock sample paired with deadline; renderer calculates remaining time with its own monotonic elapsed clock. */
  clockAt: number;
}
/** Why a work chat stays open (#86): an answer or a permission of the user, a command left to the user, the user (or a
 *  decision from above), colleagues, its running work (background tasks, sub-agents, a command running, a wait its
 *  answer names), its final report not sent yet, mail it waits for, a browser hand-off or dialog. */
export type AutoCloseWaiting = 'answer' | 'permission' | 'command' | 'user' | 'colleagues' | 'work' | 'report' | 'mail' | 'browser';
export const AUTO_CLOSE_WAITING: readonly AutoCloseWaiting[] = ['answer', 'permission', 'command', 'user', 'colleagues', 'work', 'report', 'mail', 'browser'];
export interface AutoClosePresence {
  chatId: string;
  draft: boolean;
  shown: boolean;
  browser: boolean;
  queued: number;
  /** Compatibility field name: opaque positive interaction sequence, not wall-clock authority. */
  touchedAt: number;
}
