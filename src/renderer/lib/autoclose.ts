// Auto-close of finished work chats (the user, 2026-10-11: "vorrei che le chat si chiudessero da sole liberando spazio
// nella dashboard quando non lavorano e hanno finito. poi le riapri te in caso"). Pure rule: a chat closes when it is a
// work chat (never the Regia), idle after a clean result (not one the user interrupted) or with its session ended (a
// chat restored at start-up carries no result: it counts from its last update), with no open question/permission/command, nothing queued (nor waiting in the CPU queue), no
// background task or "Esegui" run still running, no final answer that says it waits for its work ("Aspetto la QA…":
// the engine's count missed a resumed agent on 2026-10-16, waitsOnWork, shared/waiting.ts) (and the delay counts from the end of its last background task: the CLI
// then reads the task's report in a turn of its own that shows only seconds later; the QA chats of 2026-10-15), no unsent draft, not maximized/in focus mode/selected, none of its browser tabs in use or waiting
// on a hand-off, and neither its result nor the user's last
// touch on its tile is younger than the delay (setting autoCloseMin, default 2: time to read the final answer; the
// user, 2026-10-13, dropped the "Finite oggi" dock and column). Closed = archived in main (chat:archive), found and
// reopened with Ctrl+K (CommandPalette.tsx, "Chiuse"). The clock and the DOM reads live in components/AutoCloser.tsx; tests: test/unit/autoclose.test.ts.
import type { ChatSummary } from '@shared/contract';

export interface Hold {
  queued: number;       // messages waiting in the app's queue for this chat
  draft: boolean;       // text typed in its input and not sent
  shown: boolean;       // maximized, selected, or the focus mode is on it: the user is looking at it
  browser: boolean;     // one of its browser tabs is in use (maximized, focused, shown big) or waits on a hand-off
  touchedAt: number;    // the user's last click, key or scroll in its tile (0 = never)
  asks: number;         // its open requests for the user ("Comando da eseguire" too: it does not count in pending)
  running: boolean;     // one of its "Esegui" runs is still going (its live output and "Ferma" live in the tile)
}

/** When the chat may close (epoch ms), or null when it is not a candidate at all. */
export function closeAt(c: ChatSummary, h: Hold, delayMs: number): number | null {
  if (!(delayMs > 0) || c.isRegia || c.closedAt) return null;
  if (c.pending > 0 || (c.background ?? 0) > 0 || c.waitsOnWork || c.lastError || c.queued) return null;
  const r = c.lastResult;
  if (r && (r.isError || r.interrupted)) return null; // stopped by the user: he is on it
  // idle: only after a result; closed (session ended, or restored at start-up without its result): from its last update
  let since = c.state === 'idle' ? r?.at : c.state === 'closed' ? r?.at ?? c.updatedAt : undefined;
  if (since === undefined) return null;
  // a background task that just ended: the CLI reads its report in a turn of its own that has not shown yet
  since = Math.max(since, c.backgroundEndedAt ?? 0);
  if (h.queued > 0 || h.asks > 0 || h.running || h.draft || h.shown || h.browser) return null;
  return Math.max(since, h.touchedAt) + delayMs;
}

/** The chats to close now, oldest result first. */
export function dueChats(chats: readonly ChatSummary[], hold: (c: ChatSummary) => Hold, delayMs: number, now: number): ChatSummary[] {
  return chats
    .map(c => ({ c, at: closeAt(c, hold(c), delayMs) }))
    .filter((x): x is { c: ChatSummary; at: number } => x.at !== null && x.at <= now)
    .sort((a, b) => a.at - b.at)
    .map(x => x.c);
}

/** Closed chats for the palette's "Chiuse" group: newest first. */
export function closedChats(chats: Readonly<Record<string, ChatSummary>>): ChatSummary[] {
  return Object.values(chats).filter(c => c.closedAt).sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
}

// The user's last touch per chat (click, key, scroll in its tile; a reopen): kept here so the AutoCloser and the reopen
// action share it without importing each other.
const touched = new Map<string, number>();
export const touch = (chatId: string, at: number): void => { touched.set(chatId, at); };
export const touchedAt = (chatId: string): number => touched.get(chatId) ?? 0;
