// Where a text typed in the Orchestrator's field goes (ADR 0328; the owner, 2026-11-12: «da espansa voglio vedere
// sempre l'input dell'orchestrator scrivibile, è quello il campo libero» · 2026-11-19: «se mi compare una domanda dello
// stratega … e rispondo dal campo dell'orchestrator la domanda non scompare»). A row opened in the Orchestrator's column
// has no answer box: its card says «write below, in the Orchestrator's field». While that card is open the field is its
// answer box, so his words go straight to that row (an engine question: its answer; a plan: what to change, or the ok
// when the whole text is an approval or a bare yes) and the row leaves at once, whatever the Orchestrator's engine is doing. Before,
// they went to the Orchestrator as a message (queued while it worked) and the row closed only if its engine then chose
// to pass them on (app_resolve_question `words`): measured on the owner's PC on 2026-11-19, it did not in 4 of the
// messages that answered a row. Still the Orchestrator's: a request to explain the question (asksToExplain, ADR 0327),
// a text with images, a «Fast» / «Plan» message, a «/» command, a text not begun under that card (written before the
// card opened: the app opens cards too, e.g. for a recap; or put in the field by another page: «Discuti», «Cambia
// qualcosa» on a map, a quoted selection), and everything written while no card is open.
// Pure. Used by components/ChatInput.tsx (the route) and components/QuestionsWindow.tsx (which rows have no box);
// unit test: test/unit/field-answer.test.ts.
import type { Answer, PendingRequest } from '@shared/contract';
import { answerableInWords, wordsAnswer } from '@shared/answer-in-words';
import { asksToExplain } from '@shared/ask-once';
import { isPlanApproval } from '@shared/strategy';
import { yesNoOf } from '@shared/yes-no';

/** A row whose free answer is written in the Orchestrator's field: a plan to approve or an engine question (never a
 *  permission, a command, an MCP form, a work proposal: those keep their own box or buttons). */
export const answeredInField = (ask: { type: string } & Partial<Pick<PendingRequest, 'tool' | 'questions'>>): boolean =>
  ask.type === 'plan' || answerableInWords(ask as Pick<PendingRequest, 'type' | 'tool' | 'questions'>);

/** The open card, as the field reads it: an engine question, or a plan waiting for his ok (its chat and proposal). */
export type FieldCard = { kind: 'question'; req: PendingRequest } | { kind: 'plan'; chatId: string; at: number };

export type FieldRoute =
  | { to: 'question'; req: PendingRequest; answer: Answer }
  | { to: 'plan'; chatId: string; at: number; decision: 'approve' | 'change'; text: string };

/** A bare yes written under the open card of a plan («sì», «ok», «va bene», «procedi»): there it can only be the ok to
 *  that plan (in the Strategist's own chat it is not: isPlanApproval). A yes with anything after it is a change. */
const bareYes = (words: string): boolean => {
  const w = words.toLocaleLowerCase('it').replace(/[.!,]+/g, ' ').replace(/\s+/g, ' ').trim();
  return yesNoOf(w) === 'yes' || ['ok', 'okay', 'va bene', 'procedi', 'vai', 'ok procedi', 'sì procedi', 'si procedi', 'sì vai', 'si vai'].includes(w);
};

/** What happens to `text` typed in the field of chat `chatId` (null: it is a message for that chat, as always).
 *  card = the row open in the Orchestrator's column (only the Orchestrator's field has one); own = the chat's own open
 *  question (ADR 0274: what he writes there is its answer); plain = no mode and no images; drafted = the text was not
 *  begun under the card open now (typed before it opened, or put in the field by another page): it is a message for
 *  the chat, whatever card is open. */
export function fieldRoute(text: string, o: { chatId: string; card: FieldCard | null; own?: PendingRequest; plain: boolean; drafted?: boolean }): FieldRoute | null {
  const words = text.trim();
  if (!words || !o.plain) return null;
  const card = o.drafted ? null : o.card;
  // another chat's row is open: his words are its answer. His question about it is the Orchestrator's to explain and the
  // row stays open (ADR 0327), and so is a «/» command: a message, never the answer to the Orchestrator's own question
  if (card && (card.kind === 'plan' || card.req.chatId !== o.chatId)) {
    if (words.startsWith('/') || asksToExplain(words)) return null;
    if (card.kind === 'plan') return { to: 'plan', chatId: card.chatId, at: card.at, decision: isPlanApproval(words) || bareYes(words) ? 'approve' : 'change', text: words };
    return { to: 'question', req: card.req, answer: wordsAnswer(card.req, words) };
  }
  return o.own ? { to: 'question', req: o.own, answer: wordsAnswer(o.own, text) } : null;
}
