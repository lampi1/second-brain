// Authoritative automatic-archive deadline and renderer presence lease. Imported by main and renderer;
// the integrator adds the IPC/event registrations to contract.ts. No agent/MCP permission is implied.
export interface AutoCloseStatus {
  chatId: string;
  deadline: number | null;
  warningStartedAt: number | null;
  generation: number;
  keptOpen: boolean;
  reason: string | null;
  /** what the chat waits for while it stays open (ADR 0084, #359): the tile's one status (absent = nothing) */
  waitingFor?: AutoCloseWaiting;
  /** how many sub-chats or background tasks, for waitingFor 'children' and 'background' */
  waitingN?: number;
  /** Main clock sample paired with deadline; renderer calculates remaining time with its own monotonic elapsed clock. */
  clockAt: number;
}
/** What a held work chat waits for (#86, #359), only from real state, never from the words of an answer: the user's
 *  answer, permission or plan approval, a command left to Esegui, a browser hand-off or dialog, its running sub-chats or
 *  sub-agents (waitingN = how many), its background tasks (waitingN), a command or page of its own still running, mail
 *  it waits for, its final report not sent yet, work it left unsaved in its repository (uncommitted changes or commits
 *  on no remote, #357), or the check of that repository still running or failed (gitcheck: never closed on a guess).
 *  'answer' is only a question open in that chat; a step the user does outside it (its report's userAction, written
 *  as a note in the Orchestrator: turn on the VPN, a login, a try) is 'step', never a question (#411). */
export type AutoCloseWaiting = 'answer' | 'permission' | 'plan' | 'command' | 'step' | 'browser' | 'children' | 'background' | 'work' | 'mail' | 'report' | 'unsaved' | 'gitcheck';
export const AUTO_CLOSE_WAITING: readonly AutoCloseWaiting[] = ['answer', 'permission', 'plan', 'command', 'step', 'browser', 'children', 'background', 'work', 'mail', 'report', 'unsaved', 'gitcheck'];
export interface AutoClosePresence {
  chatId: string;
  draft: boolean;
  shown: boolean;
  browser: boolean;
  queued: number;
  /** Compatibility field name: opaque positive interaction sequence, not wall-clock authority. */
  touchedAt: number;
}
