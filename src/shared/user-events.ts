// The user's own entries in a work chat that its assigner has not acknowledged yet (the user event ledger,
// chats/manager-work.ts userWrote): messages he typed there and his answers to its panels. The child already has them
// (they reached it as messages and answers), so app_assign_task and agent_assign_task never add them to the new prompt:
// the tools return them to the assigner, readable (unreadInstructions), so its new assignment accounts for them, with no
// expectedEventSeq handshake. Used by appctl/tools.ts and agents/delegation.ts.
import type { UserTaskEvent, UserTaskEvents } from './agents';

/** One entry's text for the assigner: long ones are cut, the full text stays in the chat and its ledger. */
export const USER_EVENT_TEXT_MAX = 2000;

/** The events after the acknowledged cursor, oldest first. */
export function unreadEvents(ledger: UserTaskEvents): UserTaskEvent[] {
  return ledger.events.filter(e => e.seq > ledger.acknowledgedSeq).sort((a, b) => a.seq - b.seq);
}

const str = (v: unknown): string => typeof v === 'string' ? v : JSON.stringify(v);

/** An entry as a person reads it: a panel answer (chats/manager-requests.ts records it as JSON with its requestId) becomes
 *  «Answer to a question: …» or «Permission allowed/denied», a typed message stays as written. */
export function readableUserEvent(text: string): string {
  let o: unknown;
  try { o = text.trimStart().startsWith('{') ? JSON.parse(text) : undefined; } catch { o = undefined; }
  if (o && typeof o === 'object' && typeof (o as { requestId?: unknown }).requestId === 'string') {
    const a = o as { answers?: unknown; allow?: unknown; message?: unknown };
    if (Array.isArray(a.answers)) return `Answer to a question: ${a.answers.map(str).join(' · ')}`;
    if (typeof a.allow === 'boolean') return `Permission ${a.allow ? 'allowed' : 'denied'}${typeof a.message === 'string' && a.message ? `: ${a.message}` : ''}`;
  }
  return text;
}

/** What the assign tools give back: the unread entries, readable and cut to USER_EVENT_TEXT_MAX. */
export function unreadInstructions(ledger: UserTaskEvents): { seq: number; text: string }[] {
  return unreadEvents(ledger).map(e => {
    const text = readableUserEvent(e.text);
    return { seq: e.seq, text: text.length > USER_EVENT_TEXT_MAX ? `${text.slice(0, USER_EVENT_TEXT_MAX)}…` : text };
  });
}
