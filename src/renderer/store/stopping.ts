// The user's Stop, shown at once (ADR 0368): the tile turns stopped the moment he presses it, while main still waits for
// the engine to end the turn (an engine that has not ended within a second is restarted: claude.ts watchStop, acp.ts
// watchCancel). Until main reports a state other than running, its updates show the chat stopped; it still counts as
// busy for the queue, so what he types meanwhile waits and goes the moment main is free. Pure but for its map; also
// lowPriorityTurn: the Orchestrator's turn on the app's own news, which his message interrupts. Used by store.ts;
// pinned by test/unit/store-stopping.test.ts.
import type { ChatItem, ChatSummary } from '@shared/contract';

/** a Stop main never settles (a lost event) stops showing after this: main's own state wins again */
export const STOP_SHOWN_MS = 15_000;

export class Stops {
  private readonly at = new Map<string, number>();
  mark(chatId: string, now: number): void { this.at.set(chatId, now); }
  clear(chatId: string): void { this.at.delete(chatId); }
  /** The stop is still being shown (and the chat counts as busy for its queue). */
  active(chatId: string, now: number): boolean {
    const at = this.at.get(chatId);
    if (at === undefined) return false;
    if (now - at <= STOP_SHOWN_MS) return true;
    this.at.delete(chatId);
    return false;
  }
  /** Main's update while a stop shows: the chat as shown, and settled when main has ended the turn (the stop is over). */
  view(chat: ChatSummary, now: number): { chat: ChatSummary; settled: boolean } {
    if (!this.active(chat.id, now)) return { chat, settled: false };
    if (chat.state === 'running' || chat.state === 'starting') return { chat: { ...chat, state: 'idle' }, settled: false };
    this.at.delete(chat.id);
    return { chat, settled: true };
  }
}

/** The sender of the app's own news (main sends them from 'App': wake events, run results, work-driver notes). */
const APP_FROM = 'App';

/** Whether the chat's running turn began with the app's own news, not with the user's words: the last message that
 *  started it came from the app. His message goes first: it interrupts that turn (store.ts send). */
export function lowPriorityTurn(items: readonly ChatItem[] | undefined): boolean {
  for (let i = (items?.length ?? 0) - 1; i >= 0; i--) {
    const item = items![i]!;
    if (item.kind === 'result') return false; // the turn that ran last is over: nothing to interrupt here
    if (item.kind === 'user') return item.from === APP_FROM;
  }
  return false;
}
