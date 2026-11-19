// One question, one row, one answer (ADR 0326; the owner, 2026-11-19: «il rischio di doppioni o di domande in coda,
// voglio logica semplice chiara che non crei mai casini» · «quando rispondo … chiedendo spiegazioni mi risponde con
// un'altra domanda uguale senza realmente spiegarmi»). The pure rules behind it:
// - sameAsk: two question texts ask the same thing (the same words, in another order or with a few added; one word
//   changed is another decision: «file A» / «file B», «staging» / «prod»);
// - typedWords: the user answered in his own words, not with an option; the chat then reads them with WORDS_NOTE (they
//   are his answer; a question of his is answered in the reply, and only after that reply may the question come back);
// - reaskNote: what a chat reads when it asks the same question again without that reply (the app answers it, the user
//   never sees a second row; EXPLAINED = how long a reply counts); ownCopyNote: what the Orchestrator reads when it asks
//   as its own a question a work chat already has open in front of the user;
// - asksToExplain: his message to the Orchestrator asks about a question instead of deciding it, so the Orchestrator
//   explains and the row stays open (ChatManager.answerWithUserWords).
// The practice it follows, each read at its source on 2026-11-19: answer a clarifying question first, never ask again
// in the same words (OpenAI Codex plan mode, codex-rs/collaboration-mode-templates/templates/plan.md; Google
// conversation design, «Do not repeat the original prompt verbatim»); never reopen what is decided (obra/superpowers
// brainstorming skill; GitHub spec-kit clarify template).
// Pure, no Node or DOM: used by main (chats/manager-requests.ts, manager.ts) and the renderer (lib/askContext.ts).
// Unit tests: test/unit/ask-once.test.ts.
import type { Answer, PendingRequest } from './contract';
import { ENOUGH_QUESTIONS } from './strategy';
import { bareLabel, yesNoOf } from './yes-no';

const MARK = /\s*\((consigliat[oa]|recommended|empfohlen)\)\s*/gi;
const fold = (text: string): string => text.toLowerCase().replace(MARK, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/[^\p{L}\p{N}_-]+/gu, ' ').trim(); // «orders_old» and «orders-old» stay one word
/** every word of a question, each once (numbers and short words too: «test 7» is not «test 8») */
const words = (text: string): Set<string> => new Set(fold(text).split(' ').filter(w => /[\p{L}\p{N}]/u.test(w)));

/** How much of the longer question the shorter one must be, when one only adds words to the other. */
export const SAME_ASK = 0.6;

/** Two question texts ask the same thing: equal once case, punctuation and marks are gone, or one is the other with a
 *  few words added (in any order). A changed word is another question: only what is certainly the same decision. */
export function sameAsk(a: string, b: string): boolean {
  const fa = fold(a), fb = fold(b);
  if (!fa || !fb) return false;
  if (fa === fb) return true;
  const wa = words(a), wb = words(b);
  const [less, more] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  if (less.size < 3) return false; // «Procedo?» against «Procedo ora?»: too short to tell, only equal counts
  for (const w of less) if (!more.has(w)) return false;
  return less.size / more.size >= SAME_ASK;
}

/** The request's question texts, one string (what sameAsk compares). */
export const askedText = (req: Pick<PendingRequest, 'questions' | 'title'>): string =>
  req.questions?.length ? req.questions.map(q => q.question).join('\n') : req.title;

/** texts the app sends as an answer that are not the user's words («Non voglio rispondere», «Basta domande») */
const APP_SAYS = /^(?:L[’']utente non vuole rispondere|The user does not want to answer|Der Benutzer möchte diese Frage nicht)/i;
/** x is one of the question's options: its label, or the same label without its mark, in another case, or a bare yes / no */
const isOption = (q: { options: readonly { label: string }[] }, x: string): boolean => {
  const bare = bareLabel(x).toLowerCase(), yn = yesNoOf(x);
  return q.options.some(o => o.label === x || bareLabel(o.label).toLowerCase() === bare || (yn !== null && yesNoOf(o.label) === yn));
};
const isTyped = (q: { options: readonly { label: string }[] }, x: string): boolean =>
  !!x.trim() && !isOption(q, x) && x.trim() !== ENOUGH_QUESTIONS && !APP_SAYS.test(x.trim());

/** What the user wrote himself in an answer (no option of the question it answers, also typed as «sì» or without its
 *  mark, and no text of the app), or null when every answer is an option he picked. */
export function typedWords(req: Pick<PendingRequest, 'questions'>, answer: Answer): string | null {
  if (answer.kind !== 'question') return null;
  const out: string[] = [];
  for (const q of req.questions ?? []) {
    const v = answer.answers[q.question];
    for (const x of Array.isArray(v) ? v : v === undefined ? [] : [v]) if (isTyped(q, x)) out.push(x.trim());
  }
  return out.length ? out.join('\n') : null;
}

const NOTE_OPEN = '\n\n[second-brain · ';
/** After the user's own words, for the chat that asked: they are his answer; what he asks is answered in the reply,
 *  which he reads with the question (the Orchestrator's chat, or a work chat's message in the question's card). */
export const WORDS_NOTE = `${NOTE_OPEN}the user did not pick an option: the words above are his own and they are his answer. If they decide it, act on them and do not ask him to confirm the same thing. If they ask something or he wants it explained, answer in your reply, in plain words: what each choice changes for him, with one concrete example. Only after that reply may this question come back (he reads your reply with it); a brief or a card is not that reply.]`;

/** How long a reply must be to count as the answer to what he asked (a line like «te lo spiego nel riepilogo» is not). */
export const EXPLAINED = 120;

/** The answer a chat gets when it asks again a question the user just answered in his own words, before replying. */
export const reaskNote = (said: string): string =>
  `Not asked again: the user answered this question in his own words («${said.replace(/\s+/g, ' ').slice(0, 300)}») and you have not replied to them. If his words decide it, act on them. If they ask something, write the answer in your reply first, in plain words (what each choice changes for him, one concrete example); a brief or a card is not that reply. Only then may you ask again.`;

/** The answer the Orchestrator gets when it asks as its own a question a work chat already has open. */
export const ownCopyNote = (chat: string, chatId: string, requestId: string): string =>
  `Not asked: «${chat}» already has this question open in front of the user (its row is under your chat). Never ask a worker's question again as yours. If his goal, the brain or the plan settle it, answer it for him with app_resolve_question (chatId ${chatId}, requestId ${requestId}); else leave it in its row and, if it helps, say in one plain line what it decides.`;

/** The user's own words without the app's note (what the transcript and «avevi risposto» show). */
export const withoutAppNote = (text: string): string => {
  const at = text.indexOf(NOTE_OPEN.trimStart());
  return at < 0 ? text : text.slice(0, at).trimEnd();
};

/** An answer the app gave for the user (reaskNote, ownCopyNote): never what he said. */
export const isAppAnswer = (text: string): boolean => /^Not asked(?: again)?:/.test(text.trim());

/** The answer with the app's note after the user's own words (an option he picked stays as it is; in a list the note
 *  follows the last thing he typed). */
export function withWordsNote(req: Pick<PendingRequest, 'questions'>, answer: Answer, note: string = WORDS_NOTE): Answer {
  if (answer.kind !== 'question' || typedWords(req, answer) === null) return answer;
  const answers: Record<string, string | string[]> = { ...answer.answers };
  for (const q of req.questions ?? []) {
    const v = answers[q.question];
    if (typeof v === 'string') { if (isTyped(q, v)) answers[q.question] = v + note; }
    else if (Array.isArray(v)) { const at = v.findLastIndex(x => isTyped(q, x)); if (at >= 0) answers[q.question] = v.map((x, i) => (i === at ? x + note : x)); }
  }
  return { ...answer, answers };
}

/** words that open a message without saying what it is: «ma perché?», «scusa, non ho capito», «ok ma cosa cambia?» */
const FILLER = /^(?:(?:ma|scusa(?:mi)?|boh|per[oò]|aspetta|quindi|allora|ok(?:ay)?[\s,]+(?:ma|per[oò])|but|sorry|wait|aber)[\s,.!…]+)+/iu;
const GO = /^(?:sì(?![\p{L}])|si(?=\s*(?:$|[,.;:!?]))|(?:yes|ja|no|nein|ok|okay|va bene|vai|procedi|confermo|approvo|fallo|esegui(?:lo)?|lancia(?:lo)?)(?![\p{L}]))/iu;
/** a decision said inside a question («perché no, vai», «spiegami dopo, intanto procedi») or a counter-proposal */
const DECIDES = /(?:^|[\s,;:])(?:vai|procedi|fallo|usa|usiamo|usassimo|go ahead|proceed|mach weiter)(?=$|[\s,.;:!?])|^(?:che\s+ne\s+di(?:ci|resti)|come\s+prima)(?![\p{L}])/iu;
const EXPLAIN = /^(?:(?:(?:mi|me\s+l[oa]|ce\s+l[oa])\s+)?spieg(?:a|hi|ami|armi|amelo|amela|atemi)?(?![\p{L}])|puoi\s+spiegar|(?:mi\s+fai\s+|fammi\s+)?un\s+esempio|non\s+(?:ho\s+)?cap(?:ito|isco)|non\s+(?:mi\s+)?è\s+chiar|in\s+che\s+senso|che\s+(?:cosa\s+)?(?:vuol\s+dire|significa|intend)|cosa\s+(?:vuol\s+dire|significa|intend|cambia|succede|comporta)|qual(?:e|i)?\s*[’']?\s*è|(?:cos|com)[’']è|perch[eé](?![\p{L}])|(?:can\s+you\s+)?explain(?![\p{L}])|what\s+do(?:es)?\s+(?:it|that|this|you)\s+mean|why(?![\p{L}])|i\s+do(?:n[’']t|\s+not)\s+(?:understand|get)|was\s+hei[sß]t|warum(?![\p{L}])|wieso(?![\p{L}])|(?:kannst\s+du\s+(?:das\s+)?)?erkl[aä]r)/iu;
/** how a question about the question opens (never an instruction that ends with «, ok?») */
const ASKS = /^(?:cio[eè]|cosa|come|quale|quali|che|chi|dove|quando|quant[oaie]|e\s+se|si\s+pu[oò]|what|which|how|who|where|when|wie|was|welche[rs]?|wo|wann)(?![\p{L}])/iu;

/** His message asks about the question instead of deciding it: it opens by asking to explain, or it is a question that
 *  opens with a question word. Narrow on purpose: «sì, ma sul branch dev?», «usa dev, ok?», «perché no, vai» and «usa
 *  dev» are answers; what it misses reaches the chat as his words, with WORDS_NOTE. */
export function asksToExplain(text: string): boolean {
  const t = text.trim().replace(/^[«"'“]+/, '');
  if (!t || DECIDES.test(t)) return false;
  const u = t.replace(FILLER, '');
  if (!u || GO.test(u)) return false;
  if (EXPLAIN.test(u)) return true;
  return ASKS.test(u) && /\?\s*[»"'”]?$/.test(u);
}
