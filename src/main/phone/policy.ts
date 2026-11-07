// When something goes to the phone (design §8), as one pure function. Order: urgent (production, /urgente, budget at
// 100 %) always, with sound, also paused, at night and in Focus; /pausa and Modalità notte stop everything else; an
// Orchestrator reply to a phone message always goes back; while the phone conversation is active (last phone message
// < 30 min) Orchestrator replies and questions go; at the PC nothing else; with a chat in Focus only that chat's
// questions and failures; away with no Focus questions waiting > 2 min (earlier ones are deferred) and failed chats.
// Quiet hours (default 22-7) make every non-urgent message silent (disable_notification).
// Used by bridge.ts; tests: test/unit/phone/policy.test.ts (the whole table).
export const CONVERSATION_MS = 30 * 60_000;
export const WAIT_BEFORE_PHONE_MS = 2 * 60_000;

export type PolicyEvent =
  | { kind: 'urgent' }
  | { kind: 'reply'; fromPhone: boolean }
  | { kind: 'decidable'; chatId: string; orchestrator: boolean; waitingMs: number }
  | { kind: 'failed'; chatId: string; orchestrator: boolean };

export interface PolicyContext {
  now: number;
  /** local hour 0-23 (injected so tests do not depend on the time zone) */
  hour: number;
  lastPhoneMessageAt: number | null;
  atPc: boolean;
  nightMode: boolean;
  focusChatId: string | null;
  quietHours: { from: number; to: number } | null;
  paused: boolean;
}

export type PolicyDecision = { send: true; silent: boolean } | { send: false; retryInMs?: number };

export function inQuietHours(hour: number, q: { from: number; to: number } | null): boolean {
  if (!q || q.from === q.to) return false;
  return q.from < q.to ? hour >= q.from && hour < q.to : hour >= q.from || hour < q.to;
}

export function decide(ev: PolicyEvent, c: PolicyContext): PolicyDecision {
  if (ev.kind === 'urgent') return { send: true, silent: false };
  if (c.paused || c.nightMode) return { send: false };
  const yes: PolicyDecision = { send: true, silent: inQuietHours(c.hour, c.quietHours) };
  const talking = c.lastPhoneMessageAt !== null && c.now - c.lastPhoneMessageAt < CONVERSATION_MS;
  if (ev.kind === 'reply') return ev.fromPhone || talking ? yes : { send: false };
  if (talking && ev.orchestrator) return yes;
  if (c.atPc) return { send: false };
  if (c.focusChatId !== null && ev.chatId !== c.focusChatId) return { send: false };
  if (ev.kind === 'failed') return yes;
  if (ev.waitingMs < WAIT_BEFORE_PHONE_MS) return { send: false, retryInMs: WAIT_BEFORE_PHONE_MS - ev.waitingMs };
  return yes;
}
