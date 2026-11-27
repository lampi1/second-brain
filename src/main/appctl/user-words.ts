// When the user last typed a message into a chat themselves (the renderer's chat:send, a sender-checked IPC from the
// app's own window), or said yes to one of its native questions with their own click (chat:answer): the proofs
// app_config takes that a configuration change is the user's ask (ADR 0149). A chat item of kind 'user' is not enough:
// the app's news, mail and other main-side sends land as 'user' items too; an answer given by the app («Modalità
// notte»), by the Orchestrator for a work chat or by a parent for its child never passes here. In memory only (a
// restart forgets it: the user asks again). ADR 0371: a delivery that waited for the engine still counts, and in the
// first minutes app news or an agent's mail landing after his ask does not void it, except for a change that widens
// what agents may do (strict: permissions, autonomy, protected settings, connectors, role text): then nothing but his own
// words since, as before. Used by main/ipc-handlers/chats.ts (note) and appctl/tools.ts (configAsk).
import { isNativeQuestion } from '../../shared/yes-no';
import type { Answer, PendingRequest } from '../../shared/contract';

const typed = new Map<string, number>();
const answered = new Map<string, number>();
/** what the user's last yes was about: the question and its brief, as the card showed them (ADR 0361) */
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
  /** the time of the chat's latest 'user' item the user wrote (no agent's sender, not app news: ownItem); absent = the
   *  caller cannot tell them apart and lastUserItem is read, as before ADR 0371 */
  lastOwnItem?: number;
  /** the end of the chat's last turn (ChatSummary.lastResult.at) */
  lastResult?: number;
  now: number; freshMs: number; turnMs: number;
  /** a change that widens what agents may do (ADR 0371): nothing but his own words since the proof, ever; an agent's
   *  mail or the app's news after it voids it, whatever the time (his late-landing item still counts) */
  strict?: boolean;
}
/** How long the user's typed message may take to land as its item: a delivery waits for the engine to start (a cold
 *  or released engine: ~10 s on Antigravity), a recall check or the mail ahead of it (ADR 0371 point 1: his message
 *  landed 9 s after Enter and app_config refused it 8 times). */
export const TYPED_DELIVERY_MS = 2 * 60_000;
/** A 'user' item the user typed on the PC: not an agent's mail (from), not a phone message (via 'phone': text from the
 *  phone is a clarification, never an ok), not the app's news or resume ("[…", unless a mode prefix). */
export function ownItem(i: { kind: string; text?: string; from?: string; via?: string }, isMode: (t: string) => boolean = () => false): boolean {
  return i.kind === 'user' && !i.from && i.via !== 'phone' && (!(i.text ?? '').startsWith('[') || isMode(i.text ?? ''));
}
/** Is this the user's ask? Their own typed message or their yes. In the first freshMs (10 minutes) it holds whatever
 *  app news or an agent's mail landed after it: the Orchestrator works on his behalf (the owner, 2026-11-27, ADR 0371);
 *  never for a strict change (p.strict), which holds only while nothing but his own words came since.
 *  Past that, only while nothing else spoke to the chat since and it is still the same turn it started or answered (no
 *  turn ended since, at most turnMs: a long piece of work they asked for keeps its ask). */
export function userAsked(p: AskProof): boolean {
  const known = p.lastOwnItem !== undefined;
  const own = known ? p.lastOwnItem : p.lastUserItem;
  const proofs: { at: number; quiet: boolean }[] = [];
  // the item the send added carries (about) the time it was typed, or a little later when its delivery waited
  if (p.typed !== undefined && own !== undefined && own >= p.typed - 5_000 && own - p.typed <= (known ? TYPED_DELIVERY_MS : 5_000)) {
    proofs.push({ at: p.typed, quiet: p.lastUserItem === undefined || p.lastUserItem <= own });
  }
  if (p.answered !== undefined && (own === undefined || own <= p.answered)) proofs.push({ at: p.answered, quiet: p.lastUserItem === undefined || p.lastUserItem <= p.answered });
  return proofs.some(({ at, quiet }) => {
    const age = p.now - at;
    if (age < 0) return false;
    // without telling his items from the rest, anything after the proof voids it (the rule before ADR 0371)
    if (age <= p.freshMs && (quiet || known && !p.strict)) return true;
    return quiet && age <= p.turnMs && (p.lastResult === undefined || p.lastResult < at);
  });
}
