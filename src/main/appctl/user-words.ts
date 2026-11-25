// When the user last typed a message into a chat themselves (the renderer's chat:send, a sender-checked IPC from the
// app's own window), or said yes to one of its native questions with their own click (chat:answer): the proofs
// app_config takes that a configuration change is the user's ask (ADR 0149). A chat item of kind 'user' is not enough:
// the app's news, mail and other main-side sends land as 'user' items too; an answer given by the app («Modalità
// notte»), by the Orchestrator for a work chat or by a parent for its child never passes here. In memory only (a
// restart forgets it: the user asks again). Used by main/ipc-handlers/chats.ts (note) and appctl/tools.ts (configAsk).
import { isNativeQuestion } from '../../shared/yes-no';
import type { Answer, PendingRequest } from '../../shared/contract';

const typed = new Map<string, number>();
const answered = new Map<string, number>();
/** what the user's last yes was about: the question and its brief, as the card showed them (ADR 0358) */
const answeredAbout = new Map<string, { at: number; text: string }>();
const remember = (m: Map<string, number>, chatId: string, at: number) => {
  m.set(chatId, at);
  if (m.size > 200) m.delete(m.keys().next().value!);
};

/** The user typed and sent a message to this chat now. */
export function noteUserTyped(chatId: string, at = Date.now()): void { remember(typed, chatId, at); }
/** When the user last typed into this chat, or undefined. */
export const lastTyped = (chatId: string): number | undefined => typed.get(chatId);

const label = (s: string) => s.replace(/\(consigliat[oa]\)/gi, '').trim().toLowerCase();
const YES = 'sì', NO = 'no';
/** The user's answer is a yes: a native question whose options are exactly «Sì» and «No» (with or without
 *  «(consigliato)»), every question answered «Sì». Free text is a clarification, never an ok. */
export function saysYes(req: Pick<PendingRequest, 'type' | 'tool' | 'questions'> | undefined, answer: Answer): boolean {
  if (!req || !isNativeQuestion(req) || answer.kind !== 'question' || !req.questions?.length) return false;
  const yesNo = req.questions.every(q => q.options.length === 2 && q.options.some(o => label(o.label) === YES) && q.options.some(o => label(o.label) === NO));
  const given = Object.values(answer.answers).flatMap(v => (Array.isArray(v) ? v : [v]));
  return yesNo && given.length > 0 && given.length >= req.questions.length && given.every(v => typeof v === 'string' && label(v) === YES);
}
/** The user clicked yes on a native question of this chat now. */
export function noteUserAnswered(chatId: string, at = Date.now(), about = ''): void {
  remember(answered, chatId, at);
  answeredAbout.set(chatId, { at, text: about });
  if (answeredAbout.size > 200) answeredAbout.delete(answeredAbout.keys().next().value!);
}
/** What the user said yes to in this chat since `since`: the card's own words, or null. A change those words name exactly
 *  needs no other proof, whatever reached the chat after the yes: news held while the panel was open lands right after
 *  it (2026-11-24: two yeses in a row lost 0,1 s after the click). */
export function answeredText(chatId: string, since: number): { text: string; used(): void } | null {
  const a = answeredAbout.get(chatId);
  return a && a.at >= since && a.text ? { text: a.text, used: () => { if (answeredAbout.get(chatId) === a) answeredAbout.delete(chatId); } } : null;
}
/** What a yes was about: the question, the «Sì» option's own words and the brief's «Se Sì» on this very question. What the
 *  card says about the «No» is no part of it. */
export function yesAbout(req: Pick<PendingRequest, 'questions'>, ifYes: string): string {
  return [...(req.questions ?? []).flatMap(q => [q.question, ...q.options.filter(o => label(o.label) === YES).map(o => o.description ?? '')]), ifYes].filter(x => x.trim()).join('\n');
}
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
