// When the user last typed a message into a chat themselves (the renderer's chat:send, a sender-checked IPC from the
// app's own window), or said yes to one of its native questions with their own click (chat:answer): the proofs
// app_config takes that a configuration change is the user's ask (ADR 0149). A chat item of kind 'user' is not enough:
// the app's news, mail and other main-side sends land as 'user' items too; an answer given by the app («Modalità
// notte»), by the Orchestrator for a work chat or by a parent for its child never passes here. In memory only (a
// restart forgets it: the user asks again). Used by main/ipc-handlers/chats.ts (note) and appctl/tools.ts (configAsk).
import type { Answer, PendingRequest } from '../../shared/contract';

const typed = new Map<string, number>();
const answered = new Map<string, number>();
const remember = (m: Map<string, number>, chatId: string, at: number) => {
  m.set(chatId, at);
  if (m.size > 200) m.delete(m.keys().next().value!);
};

/** The user typed and sent a message to this chat now. */
export function noteUserTyped(chatId: string, at = Date.now()): void { remember(typed, chatId, at); }
/** When the user last typed into this chat, or undefined. */
export const lastTyped = (chatId: string): number | undefined => typed.get(chatId);

/** A choice that says no (or stop): never an ask. */
const NEGATIVE = /^(no|non|annulla|stop|cancel|lascia|aspetta)\b/i;
const label = (s: string) => s.replace(/\(consigliat[oa]\)/gi, '').trim().toLowerCase();
/** The user's answer to a native question is a yes: every answer is one of the question's own options (free text is a
 *  clarification, never an ok) and none of them is a no. */
export function saysYes(req: Pick<PendingRequest, 'type' | 'questions'> | undefined, answer: Answer): boolean {
  if (!req || req.type !== 'question' || answer.kind !== 'question' || !req.questions?.length) return false;
  const given = Object.values(answer.answers).flatMap(v => (Array.isArray(v) ? v : [v]));
  if (!given.length) return false;
  const options = new Set(req.questions.flatMap(q => q.options.map(o => label(o.label))));
  return given.every(v => typeof v === 'string' && options.has(label(v)) && !NEGATIVE.test(label(v)));
}
/** The user clicked yes on a native question of this chat now. */
export function noteUserAnswered(chatId: string, at = Date.now()): void { remember(answered, chatId, at); }
export const lastAnswered = (chatId: string): number | undefined => answered.get(chatId);

export interface AskProof {
  /** when the user last typed / said yes in this chat (lastTyped, lastAnswered) */
  typed?: number; answered?: number;
  /** the time of the chat's latest 'user' item (theirs, or app news, an agent's mail, a woken turn) */
  lastUserItem?: number;
  /** the end of the chat's last turn (ChatSummary.lastResult.at) */
  lastResult?: number;
  now: number; freshMs: number; turnMs: number;
}
/** Is this the user's ask? Their own typed message (the latest 'user' item) or their yes after the latest 'user' item,
 *  so nothing else has spoken to the chat since; and recent (freshMs), or still the same turn it started or answered
 *  (no turn ended since, at most turnMs: a long piece of work they asked for keeps its ask). */
export function userAsked(p: AskProof): boolean {
  const proofs: number[] = [];
  // the item the send added carries (about) the time it was typed; any later 'user' item came from elsewhere
  if (p.typed !== undefined && p.lastUserItem !== undefined && Math.abs(p.lastUserItem - p.typed) <= 5_000) proofs.push(p.typed);
  if (p.answered !== undefined && (p.lastUserItem === undefined || p.lastUserItem <= p.answered)) proofs.push(p.answered);
  if (!proofs.length) return false;
  const at = Math.max(...proofs), age = p.now - at;
  if (age < 0) return false;
  return age <= p.freshMs || (age <= p.turnMs && (p.lastResult === undefined || p.lastResult < at));
}
