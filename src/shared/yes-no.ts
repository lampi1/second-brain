// Yes/no questions only (owner, 2026-10-23, ADR 0135): every question an agent or the Orchestrator asks the user is one
// yes/no question that first says what was done and how it is known (a screenshot, a file, a test), so the user answers
// with Sì / No, writes his own answer («Altro…») or sets it aside («Ci penso dopo») and never opens a chat to understand.
// QUESTION_RULE rides on every role frame (agents/orchestrator-role.ts roleFrame); yesNoShape() is the check the
// engines' question gates use (chats/claude.ts AskUserQuestion, chats/acp.ts cursor/ask_question) to send a question
// with other options back once with YESNO_REFUSAL; the renderer reads isYesNo() to tone the No card.
// The decision card (ADR 0150, the owner 2026-10-24: «l'importante è che sia sempre chiaro il contesto della domanda»):
// before the question the chat calls show_ui with the `brief` component and target next-ask (what it did, the evidence,
// what Sì and No do), so the card holds all its context and never leans on the chat text before it; a yes/no question
// without a brief is sent back once with BRIEF_REFUSAL (the same retry counter). «Bivio» (ADR 0259): the question is short
// (MAX_QUESTION_CHARS, no code: a longer one is sent back like a non yes/no one), the brief carries why, the buttons'
// labels, each road's next steps and a before → after; an agent never asks whether a command was run.
// Pure, no Node or DOM: used by main and renderer. Unit tests: test/unit/yes-no.test.ts.

import type { PendingRequest } from './contract';

/** The engines' own question tools: Claude AskUserQuestion, Cursor/Codex AskQuestion, the app's ask_user (AskUser).
 *  Never a Cursor plan (CreatePlan: Approva / Rifiuta) nor an MCP server's form (elicitation, tool mcp__<server>). */
const NATIVE_QUESTIONS = new Set(['AskUserQuestion', 'AskQuestion', 'AskUser']);
export const isNativeQuestion = (req: Pick<PendingRequest, 'type' | 'tool'>): boolean =>
  req.type === 'question' && NATIVE_QUESTIONS.has(req.tool);
/** What the role frame tells every chat about asking the user. */
export const QUESTION_RULE = 'Ask only genuine yes/no decisions with AskUserQuestion (or your engine\'s question tool; with none, the app\'s ask_user tool): one short question (at most 120 characters, plain words, no code, paths or ids), exactly two options "Sì" and "No", recommended one marked "(consigliato)". Recommend the option that moves the task forward; stopping needs a concrete reason. Do not re-ask for host-approved routine writes. Never ask whether the user ran a command: a command for him is its own request (the app shows it with Esegui and sends you the result). Before asking, show_ui component "brief" target "next-ask": why (one plain sentence: the context), done (1-3 short lines), ifYes, ifNo, yesLabel/noLabel (the buttons, e.g. "Sì, faccio il commit"), yesSteps/noSteps (what happens next on each road, 1-4 short steps), change {what, before, after} when there is a measurable result, evidence (images, checks, files). The user reads only this card, often on the phone: plain language, self-contained, never "come sopra". Free text and postponement remain available.';

/** What a question gate answers when a question is not yes/no (the agent re-asks in the right shape). */
export const YESNO_REFUSAL = 'Not asked: the user answers only short yes/no questions (second-brain). Ask again with one question (at most 120 characters, no code or paths: the context goes in the brief\'s why) whose two options are exactly "Sì" and "No" (mark the one you recommend "(consigliato)"); before it call show_ui component "brief" target "next-ask" with what you did, its evidence and what Sì / No do. A choice between options becomes a yes/no question on the one you recommend. He can still type his own answer or postpone it. Recommend the option that moves the task forward; recommend stopping only with a concrete reason in the card.';

/** What the gate answers when a yes/no question comes without its brief (ADR 0150). */
export const BRIEF_REFUSAL = 'Not asked yet: the user reads only the question card, never your chat, so it must carry its context. First call show_ui with component "brief" and target "next-ask" (props: why = one plain sentence of context; done = 1-3 short lines on what you did; ifYes; ifNo; yesLabel / noLabel for the buttons; yesSteps / noSteps = what happens next on each road; change {what, before, after} for a measurable result; and the evidence you have: images [{path, caption}] for screenshots, checks [{label, status}] for tests or commands, files [{path, why}]), then ask the same yes/no question again, short and without "come sopra".';

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

/** The longest question the card shows as its title: the context goes in the brief (ADR 0259). */
export const MAX_QUESTION_CHARS = 160;
/** A question short enough to read at a glance: no code fence, not a paragraph. */
export const shortQuestion = (q: string): boolean => q.trim().length <= MAX_QUESTION_CHARS && !q.includes('```');

/** Exactly one answerable, short yes/no question per panel. */
export const yesNoShape = (qs: readonly { question?: string; options: readonly { label: string }[]; multiSelect?: boolean }[]): boolean =>
  qs.length === 1 && isYesNo(qs[0]!) && shortQuestion(qs[0]!.question ?? '');

/** The gate is on in a real profile; off in the test suites (their fake CLIs ask with free options) unless SB_YESNO=1;
 *  SB_YESNO=0 turns it off anywhere. */
export function yesNoGateOn(env: Record<string, string | undefined>): boolean {
  if (env.SB_YESNO === '0') return false;
  if (env.SB_TEST || env.VITEST) return env.SB_YESNO === '1';
  return true;
}
