// Runs the auto-close (lib/autoclose.ts) in the app page: notes the user's touches on each chat tile (click, key,
// scroll, typing), checks every few seconds and whenever the chats change, and closes the chats that are due through
// actions.archiveChat (fade out, archive in main, "Chiusa: <titolo> · Riapri"). Renders nothing. Mounted once by App.tsx.
import { useEffect } from 'react';
import { archiveChat } from '../actions';
import { hasDraft } from './ChatInput';
import { dueChats, touch, touchedAt, type Hold } from '../lib/autoclose';
import { now } from '../lib/clock';
import { hasRunningRun } from '../lib/runs';
import { app } from '../store/store';
import { ui } from '../store/ui';

const CHECK_MS = 5000;

/** Read by the e2e (autoclose.spec.ts): per chat, the result the last check saw and whether it closed the chat, so a
 *  test waits for the check on that result instead of a fixed pause (a pause is too short when the machine is busy). */
export const closeChecks = { seen: {} as Record<string, { at: number; due: boolean }> };
(globalThis as unknown as { __sbAutoClose?: typeof closeChecks }).__sbAutoClose = closeChecks;

function check(): void {
  const s = app.get();
  if (!s.ready) return;
  const min = s.settings?.autoCloseMin ?? 2;
  const u = ui.get();
  const hold = (c: { id: string }): Hold => {
    // the chat's browser tabs close with it: never while the user works in one or a hand-off waits on it
    const tabs = s.tabs.filter(t => t.ownerChatId === c.id);
    return {
      queued: s.queued[c.id]?.length ?? 0,
      draft: hasDraft(c.id),
      shown: u.maximized === `chat:${c.id}` || u.focusMode === c.id || u.focused === `chat:${c.id}` || u.hidden.includes(c.id),
      browser: tabs.some(t => !!t.handoffId || u.maximized === `browser:${t.id}` || u.focused === `browser:${t.id}` || u.pair === t.id),
      touchedAt: touchedAt(c.id),
      asks: s.pending.filter(p => p.chatId === c.id).length,
      running: hasRunningRun(c.id),
    };
  };
  const due = dueChats(Object.values(s.chats), hold, min * 60_000, now());
  for (const c of Object.values(s.chats)) closeChecks.seen[c.id] = { at: c.lastResult?.at ?? 0, due: due.includes(c) };
  for (const c of due) void archiveChat(c.id, true);
}

export function AutoCloser(): null {
  useEffect(() => {
    const onTouch = (e: Event) => {
      const target = e.target as Element | null;
      // a chat tile, or a browser tile's chrome (its page is a native view: its own clicks never reach the document)
      let id = target?.closest?.('[data-chat-id]')?.getAttribute('data-chat-id');
      const tabId = id ? null : target?.closest?.('[data-tab-id]')?.getAttribute('data-tab-id');
      if (tabId) id = app.get().tabs.find(t => t.id === tabId)?.ownerChatId;
      if (id) touch(id, now());
    };
    const opts = { capture: true, passive: true } as const;
    for (const t of ['pointerdown', 'keydown', 'wheel', 'input']) document.addEventListener(t, onTouch, opts);
    let last = app.get().chats;
    const off = app.subscribe(() => {
      const chats = app.get().chats;
      if (chats !== last) { last = chats; check(); }
    });
    const timer = setInterval(check, CHECK_MS);
    return () => {
      for (const t of ['pointerdown', 'keydown', 'wheel', 'input']) document.removeEventListener(t, onTouch, opts);
      off();
      clearInterval(timer);
    };
  }, []);
  return null;
}
