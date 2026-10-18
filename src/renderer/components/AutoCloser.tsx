// Reports UI holds to the main-owned auto-close scheduler. The renderer never decides or performs an archive.
// Renew a short fail-closed lease for drafts, focus, browser use, queued work and user interactions. Mounted by App.
import { useEffect } from 'react';
import { hasDraft } from './ChatInput';
import { touch } from '../lib/autoclose';
import { now } from '../lib/clock';
import { app } from '../store/store';
import { ui } from '../store/ui';
import { autoCloseRemaining, autoCloseState, autoCloseProblem, reportAutoClosePresence } from '../store/auto-close';
import { AutoCloseWarnings } from './AutoCloseNotice';
import { noticeVisible } from '../lib/notice-visible';

function warningVisible(id: string): boolean {
  if (document.hidden) return false;
  return [...document.querySelectorAll<HTMLElement>(`[data-autoclose-id="${CSS.escape(id)}"]`)].some(el => {
    return noticeVisible(el);
  });
}

let lastPresence = '', lastSentAt = 0;
let interactionSequence = 0;
const interactions = new Map<string, number>();
function report(): void {
  const s = app.get(), u = ui.get();
  if (!s.ready) return;
  const status = new Map(autoCloseState.get().map(row => [row.chatId, row]));
  const holds = Object.values(s.chats).filter(c => !c.closedAt).map(c => {
    const tabs = s.tabs.filter(t => t.ownerChatId === c.id), row = status.get(c.id);
    const acknowledged = !u.modal && !u.map && row?.deadline != null && autoCloseRemaining(row) <= 120_000 && warningVisible(c.id);
    return {
      chatId: c.id, queued: s.queued[c.id]?.length ?? 0, draft: hasDraft(c.id),
      shown: u.maximized === `chat:${c.id}` || u.focusMode === c.id || u.focused === `chat:${c.id}` || u.hidden.includes(c.id),
      browser: tabs.some(t => !!t.handoffId || u.maximized === `browser:${t.id}` || u.focused === `browser:${t.id}`),
      touchedAt: interactions.get(c.id) ?? 0,
      ...(acknowledged ? { ackDeadline: row!.deadline!, ackGeneration: row!.generation } : {}),
    };
  });
  const key = JSON.stringify(holds), at = now();
  if (key === lastPresence && at >= lastSentAt && at - lastSentAt < 4_000) return;
  lastPresence = key; lastSentAt = at; reportAutoClosePresence(holds);
}
export function AutoCloser() {
  const problem=autoCloseProblem.use(value=>value);
  useEffect(() => {
    const onTouch = (e: Event) => {
      const target = e.target as Element | null;
      let id = target?.closest?.('[data-chat-id]')?.getAttribute('data-chat-id');
      const tabId = id ? null : target?.closest?.('[data-tab-id]')?.getAttribute('data-tab-id');
      if (tabId) id = app.get().tabs.find(t => t.id === tabId)?.ownerChatId;
      if (id) { touch(id, now()); interactions.set(id, ++interactionSequence); }
      report(); requestAnimationFrame(report); // read the draft/image hold again after React's event handler
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'input', 'change', 'paste', 'drop', 'compositionstart', 'compositionend', 'visibilitychange'] as const;
    const options = { capture: true, passive: true } as const;
    for (const event of events) document.addEventListener(event, onTouch, options);
    const offApp = app.subscribe(report), offUi = ui.subscribe(report);
    const offStatus = autoCloseState.subscribe(() => { requestAnimationFrame(report); });
    const timer = setInterval(report, 5_000); report();
    return () => { for (const event of events) document.removeEventListener(event, onTouch, options); offApp(); offUi(); offStatus(); clearInterval(timer); };
  }, []);
  return problem ? <p role="status" className="auto-close-service-problem">{problem}</p> : <AutoCloseWarnings />;
}
