// The user's own instructions in a work chat that its assigner has not acknowledged yet (the user event ledger,
// chats/manager-work.ts userWrote): app_assign_task and agent_assign_task no longer ask the assigner to read them first
// (expectedEventSeq); the app attaches them to the new assignment's prompt (unreadNote, ChatManager.assignTask) and the
// tools return them to the assigner (unreadEvents). Used by manager-work.ts, appctl/tools.ts and agents/delegation.ts.
import type { UserTaskEvent, UserTaskEvents } from './agents';

/** One instruction's text in the prompt: long ones are cut, the full text stays in the chat and its ledger. */
export const USER_EVENT_TEXT_MAX = 2000;

/** The events after the acknowledged cursor, oldest first. */
export function unreadEvents(ledger: UserTaskEvents): UserTaskEvent[] {
  return ledger.events.filter(e => e.seq > ledger.acknowledgedSeq).sort((a, b) => a.seq - b.seq);
}

/** The block appended to an assignment's prompt, '' when nothing is unread. The user's words win where they conflict. */
export function unreadNote(ledger: UserTaskEvents): string {
  const unread = unreadEvents(ledger);
  if (!unread.length) return '';
  const lines = unread.map(e => `- ${e.text.length > USER_EVENT_TEXT_MAX ? `${e.text.slice(0, USER_EVENT_TEXT_MAX)}…` : e.text}`.replace(/\r?\n/g, ' '));
  return [`[Istruzioni che l'utente ti ha scritto in questa chat dopo l'ultima assegnazione, allegate dall'app: dove sono in conflitto con questa assegnazione, valgono le sue]`, ...lines].join('\n');
}
