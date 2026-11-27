// The user's Stop, shown at once (ADR 0368): the tile turns stopped the moment he presses it, while main still waits for
// the engine to end the turn (an engine that has not ended within a second is restarted: claude.ts watchStop, acp.ts
// watchCancel). Until main reports a state other than running, its updates show the chat stopped; it still counts as
// busy for the queue, so what he types meanwhile waits and goes the moment main is free (the stop «settles»; store.ts
// flushes the queue then, also when STOP_SHOWN_MS passes). Pure but for its map; also lowPriorityTurn: the
// Orchestrator's turn on the app's own news, which his message interrupts. Used by store.ts; pinned by
// test/unit/store-stopping.test.ts.
import type { ChatItem, ChatSummary } from '@shared/contract';

/** a Stop main never settles (a lost event) stops showing after this: main's own state wins again */
export const STOP_SHOWN_MS = 15_000;

export class Stops {
  /** per chat: when Stop was pressed, and the chat as main last reported it (shown stopped meanwhile) */
  private readonly at = new Map<string, { at: number; real: ChatSummary }>();
  mark(chat: ChatSummary, now: number): void { this.at.set(chat.id, { at: now, real: chat }); }
  /** The stop ends without main's word (a refused stop): main's last state for the chat. */
  clear(chatId: string): ChatSummary | undefined { const e = this.at.get(chatId); this.at.delete(chatId); return e?.real; }
  /** The stop is still being shown (and the chat counts as busy for its queue). */
  active(chatId: string, now: number): boolean {
    const e = this.at.get(chatId);
    return !!e && now - e.at <= STOP_SHOWN_MS;
  }
  /** STOP_SHOWN_MS passed with no update that settled it (store.ts's timer): main's last state for the chat. */
  expire(chatId: string, now: number): ChatSummary | undefined {
    const e = this.at.get(chatId);
    if (!e || now - e.at < STOP_SHOWN_MS) return undefined;
    this.at.delete(chatId);
    return e.real;
  }
  /** Main's update while a stop shows: the chat as shown, and settled when the stop is over with the chat no longer
   *  running (it was shown idle: the queue goes as after any turn's end, store.ts). */
  view(chat: ChatSummary, now: number): { chat: ChatSummary; settled: boolean } {
    const e = this.at.get(chat.id);
    if (!e) return { chat, settled: false };
    const running = chat.state === 'running' || chat.state === 'starting';
    if (running && now - e.at <= STOP_SHOWN_MS) { e.real = chat; return { chat: { ...chat, state: 'idle' }, settled: false }; }
    this.at.delete(chat.id);
    return { chat, settled: !running };
  }
}

/** The sender of the app's own news (main sends them from 'App': wake events, run results, work-driver notes). */
const APP_FROM = 'App';

/** Whether the Orchestrator's running turn is the app's own news only: main says no message of the user's started or
 *  joined it (ChatSummary.turnFromUser), and the last message of the turn came from the app (a worker's mail is not
 *  interrupted). His message goes first: it interrupts that turn (store.ts send). */
export function lowPriorityTurn(chat: Pick<ChatSummary, 'isOrchestrator' | 'turnFromUser'>, items: readonly ChatItem[] | undefined): boolean {
  if (!chat.isOrchestrator || chat.turnFromUser) return false;
  for (let i = (items?.length ?? 0) - 1; i >= 0; i--) {
    const item = items![i]!;
    if (item.kind === 'result') return false; // the turn that ran last is over: nothing to interrupt here
    if (item.kind === 'user') return item.from === APP_FROM;
  }
  return false;
}
