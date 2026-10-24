// Yes/no questions only (owner, 2026-10-23, ADR 0135): every question an agent or the Orchestrator asks the user is one
// yes/no question that first says what was done and how it is known (a screenshot, a file, a test), so the user answers
// with Sì / No, writes his own answer («Altro…») or sets it aside («Ci penso dopo») and never opens a chat to understand.
// QUESTION_RULE rides on every role frame (agents/orchestrator-role.ts roleFrame); yesNoShape() is the check the
// engines' question gates use (chats/claude.ts AskUserQuestion, chats/acp.ts cursor/ask_question) to send a question
// with other options back once with YESNO_REFUSAL; the renderer reads isYesNo() to tone the No card.
// The decision card (ADR 0149, the owner 2026-10-24: «l'importante è che sia sempre chiaro il contesto della domanda»):
// before the question the chat calls show_ui with the `brief` component and target next-ask (what it did, the evidence,
// what Sì and No do), so the card holds all its context and never leans on the chat text before it; a yes/no question
// without a brief is sent back once with BRIEF_REFUSAL (the same retry counter).
// Pure, no Node or DOM: used by main and renderer. Unit tests: test/unit/yes-no.test.ts.

/** What the role frame tells every chat about asking the user. */
export const QUESTION_RULE = 'Questions to the user (the owner, 2026-10-23/24): ask only yes/no questions, with AskUserQuestion (or your engine\'s question tool), one question at a time, each with exactly two options "Sì" and "No" (mark the one you recommend "(consigliato)"); the user can also type his own answer, say he does not want to answer, or set it aside with «Ci penso dopo». Right before asking, call show_ui with component "brief" and target "next-ask": done = what you did (1-5 short lines), ifYes / ifNo = what happens with each answer, plus the evidence you have: images (screenshot paths), checks (tests, builds, commands with ok/fail), files (changed files). You may add another next-ask visual (table, diffList, barChart) as more evidence. The question text is then only the question, short and self-contained: never "come sopra", "vedi sopra" or a reference to your chat message, because he reads only the card, never your chat. A choice between options becomes a yes/no question on the one you recommend.';

/** What a question gate answers when a question is not yes/no (the agent re-asks in the right shape). */
export const YESNO_REFUSAL = 'Not asked: the user answers only yes/no questions (second-brain). Ask again with one question whose two options are exactly "Sì" and "No" (mark the one you recommend "(consigliato)"); before it call show_ui component "brief" target "next-ask" with what you did, its evidence and what Sì / No do. A choice between options becomes a yes/no question on the one you recommend. He can still type his own answer or postpone it.';

/** What the gate answers when a yes/no question comes without its brief (ADR 0149). */
export const BRIEF_REFUSAL = 'Not asked yet: the user reads only the question card, never your chat, so it must carry its context. First call show_ui with component "brief" and target "next-ask" (props: done = 1-5 short lines on what you did; ifYes; ifNo; and the evidence you have: images [{path, caption}] for screenshots, checks [{label, status}] for tests or commands, files [{path, why}]), then ask the same yes/no question again, short and without "come sopra".';

/** How many times in a row one chat's question is sent back before it is shown as it is (never a stuck chat). */
export const YESNO_RETRIES = 2;

/** How long a yes/no question without a brief waits for one (a show_ui sent in parallel) before it is sent back. */
export const BRIEF_GRACE_MS = 1500;

const MARK = /\s*\((consigliat[oa]|recommended|empfohlen)\)\s*/gi;
const norm = (label: string): string => label.replace(MARK, ' ').replace(/[.!?:;,"'«»]/g, '').trim().toLowerCase();
const YES = new Set(['sì', 'si', 'yes', 'ja']);
const NO = new Set(['no', 'nein']);

/** 'yes' / 'no' for an option label (its «(consigliato)» mark and punctuation aside), else null. */
export function yesNoOf(label: string): 'yes' | 'no' | null {
  const l = norm(label);
  return YES.has(l) ? 'yes' : NO.has(l) ? 'no' : null;
}

/** One question with exactly a yes and a no option, single choice. */
export function isYesNo(q: { options: readonly { label: string }[]; multiSelect?: boolean }): boolean {
  if (q.multiSelect || q.options.length !== 2) return false;
  const kinds = q.options.map(o => yesNoOf(o.label));
  return kinds.includes('yes') && kinds.includes('no');
}

/** Every question of a request is yes/no (an empty list is not: there is nothing to answer with Sì / No). */
export const yesNoShape = (qs: readonly { options: readonly { label: string }[]; multiSelect?: boolean }[]): boolean => qs.length > 0 && qs.every(isYesNo);

/** The gate is on in a real profile; off in the test suites (their fake CLIs ask with free options) unless SB_YESNO=1;
 *  SB_YESNO=0 turns it off anywhere. */
export function yesNoGateOn(env: Record<string, string | undefined>): boolean {
  if (env.SB_YESNO === '0') return false;
  if (env.SB_TEST || env.VITEST) return env.SB_YESNO === '1';
  return true;
}
