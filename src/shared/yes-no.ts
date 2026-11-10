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
// labels, each road's next steps and a before → after; an agent never asks whether a command was run (ranCommandQuestion:
// sent back, and a Yes no run backs reaches the chat with NOT_RAN_NOTE, #372).
// Pure, no Node or DOM: used by main and renderer. Unit tests: test/unit/yes-no.test.ts.

import type { PendingRequest } from './contract';

/** The engines' own question tools: Claude AskUserQuestion, Cursor/Codex AskQuestion, the app's ask_user (AskUser).
 *  Never a Cursor plan (CreatePlan: Approva / Rifiuta) nor an MCP server's form (elicitation, tool mcp__<server>). */
const NATIVE_QUESTIONS = new Set(['AskUserQuestion', 'AskQuestion', 'AskUser']);
export const isNativeQuestion = (req: Pick<PendingRequest, 'type' | 'tool'>): boolean =>
  req.type === 'question' && NATIVE_QUESTIONS.has(req.tool);
/** What the role frame tells every chat about asking the user. */
export const QUESTION_RULE = 'Ask only genuine yes/no decisions with AskUserQuestion (or your engine\'s question tool, else ask_user): one short question (≤120 chars, no code or paths), exactly two options "Sì" and "No", the recommended one marked "(consigliato)" (the one that moves the task forward; stopping needs a concrete reason). Never ask whether the user ran a command: the app runs it with Esegui and sends you the result. Act yourself; if the user must act, list the steps in todo. Before asking, show_ui component "brief" target "next-ask": why, done, ifYes, ifNo, yesLabel/noLabel, yesSteps/noSteps, change, todo, evidence. The user reads only this card, often on the phone: plain words, self-contained.';

/** What a question gate answers when a question is not yes/no (the agent re-asks in the right shape). */
export const YESNO_REFUSAL = 'Not asked: the user answers only short, clear yes/no questions (second-brain). Ask again with one question that says what it decides (at most 120 characters, no code or paths, never just "Fatto?" or "Procedo?", never whether the user ran a command (leave it in a code block: the app asks to run it with Esegui and sends you the result): the context goes in the brief\'s why; what the user must do himself goes in its todo, step by step) whose two options are exactly "Sì" and "No" (mark the one you recommend "(consigliato)"); before it call show_ui component "brief" target "next-ask" with what you did, its evidence and what Sì / No do. A choice between options becomes a yes/no question on the one you recommend. If a tool of yours accepts only its own option labels (e.g. "Approve Plan" / "Request Changes"), put them in the brief\'s yesOption / noOption and ask with exactly those two labels: the user sees Sì / No and you get your label back. He can still type his own answer or postpone it. Recommend the option that moves the task forward; recommend stopping only with a concrete reason in the card.';

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
export const shortQuestion = (q: string): boolean => {
  // a screenshot the question names is drawn as a thumbnail, never read as text: it does not count
  const text = q.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/(?:file:\/\/\/?|[a-z]:[\\/]|\/)[^\s"'<>]*\.(?:png|jpe?g|webp|gif)\b/gi, '');
  return text.trim().length <= MAX_QUESTION_CHARS && !q.includes('```') && !vagueQuestion(text) && !ranCommandQuestion(text);
};

/** «Hai eseguito il comando sopra?», «Did you run it?»: a Yes to it is not a run (#372: three times in one week the
 *  agent went on as if a command had run, and nothing had). The gate sends it back like a vague one; a Yes that still
 *  reaches a chat gets the app's note when no run of that chat backs it (chats/manager-requests.ts). */
export function ranCommandQuestion(q: string): boolean {
  const t = q.toLowerCase().trim();
  // the user is the subject (hai, avete, you): «L'agente ha eseguito i test: apro la PR?» is the agent's own status
  return /(?:^|[^\p{L}])(?:l['’]\s*)?(?:hai|avete)\s+(?:già\s+|gia\s+|poi\s+|tu\s+)?(?:provato\s+a\s+)?(?:eseguito|eseguita|lanciato|lanciata|eseguire|lanciare|fatto\s+(?:girare|partire)|runnato|girato|incollato|avviato)(?![\p{L}])/u.test(t)
    // a bare participle at the start: «Comando eseguito?», «Lanciato?», «Eseguito il comando sopra?»
    || /^(?:il\s+)?(?:comando\s+|script\s+)?(?:eseguit|lanciat)[oaie](?:\s+(?:il|lo|la)\s+(?:comando|script)(?:\s+sopra)?)?\s*\?\s*$/u.test(t)
    // the passive only as the whole question, on a command: «Il comando è stato eseguito?» (not «I test sono stati
    // eseguiti con successo: procedo al merge?», the agent's own status)
    || /^(?:il\s+|lo\s+)?(?:comando|script)(?:\s+sopra)?\s+(?:è|e')\s+stato\s+(?:eseguit|lanciat)o(?:\s+[^.:;!?]{0,30})?\?\s*$/u.test(t)
    || /\b(?:did|have)\s+you\s+(?:already\s+)?(?:run(?!\s+into)|ran|execute[d]?|launch(?:ed)?|tried\s+running|get\s+a\s+chance\s+to\s+run)\b/u.test(t)
    || /\bdid\s+(?:the|this|that)\s+(?:command|script)\s+run\b/u.test(t)
    || /^ran\s+it\s*\?/u.test(t);
}
/** What a chat reads after the user's Yes to such a question when no run of it backs that Yes (#372). */
export const NOT_RAN_NOTE = 'Sì — nota dell\'app: l\'utente ha risposto Sì, ma con Esegui non è partito nessun comando di questa chat. Non darlo per eseguito: ricontrolla il risultato (rileggi il file o il valore) prima di andare avanti, e se serve lascia il comando in un blocco: l\'app lo propone con Esegui e ti manda l\'esito.';

/** «Fatto?», «Ok?», «Hai finito?»: a question that does not say what it asks (the owner 2026-11-10: «mi chiede "Fatto?"
 *  come se dovessi fare qualcosa io senza dirmi cosa»). An empty question is not this check's business. */
export function vagueQuestion(q: string): boolean {
  const t = q.trim().toLowerCase().replace(/[?!.…\s]+$/u, '');
  if (!t) return false;
  return t.length < 5 || /^(?:(?:l'?|lo |la )?hai (?:fatto|finito|eseguito|lanciato|provato)|fatto|finito|fatta|done|ok|okay|pronto|pronta|tutto ok|tutto a posto|va bene|procedo|vado|continuo|posso)(?: (?:ora|adesso|così))?$/u.test(t);
}

/** Exactly one answerable, short yes/no question per panel. */
export const yesNoShape = (qs: readonly { question?: string; options: readonly { label: string }[]; multiSelect?: boolean }[]): boolean =>
  qs.length === 1 && isYesNo(qs[0]!) && shortQuestion(qs[0]!.question ?? '');

/** The engine's own labels for Sì and No, declared in the question's brief (yesOption / noOption, #378): a tool that
 *  records approval only from its own picker labels («Approve Plan» / «Request Changes») gets them back, while the user
 *  still answers a Sì / No card. */
export interface OptionMap { yes: string; no: string }

/** The map, when the one short single-choice question has exactly the two labels the brief declared; else null. */
export function mappedYesNo(qs: readonly { question?: string; options: readonly { label: string }[]; multiSelect?: boolean }[], map: OptionMap | null | undefined): OptionMap | null {
  if (!map || qs.length !== 1) return null;
  const q = qs[0]!, labels = q.options.map(o => o.label.trim());
  if (q.multiSelect || labels.length !== 2 || map.yes.trim() === map.no.trim() || !shortQuestion(q.question ?? '')) return null;
  return labels.includes(map.yes.trim()) && labels.includes(map.no.trim()) ? { yes: map.yes.trim(), no: map.no.trim() } : null;
}

/** The question as the user sees it: the mapped options become Sì and No (descriptions kept, Sì first). */
export function asYesNo<Q extends { options: readonly { label: string; description?: string }[] }>(q: Q, map: OptionMap): Q {
  const of = (label: string) => q.options.find(o => o.label.trim() === label);
  const yes = of(map.yes), no = of(map.no);
  return { ...q, options: [{ ...yes, label: 'Sì' }, { ...no, label: 'No' }] };
}

/** The user's answer for the engine: Sì / No (any mark) become the engine's labels; a typed answer stays as it is. */
export function engineLabel(answer: string, map: OptionMap): string {
  const kind = yesNoOf(answer);
  return kind === 'yes' ? map.yes : kind === 'no' ? map.no : answer;
}

/** The gate is on in a real profile; off in the test suites (their fake CLIs ask with free options) unless SB_YESNO=1;
 *  SB_YESNO=0 turns it off anywhere. */
export function yesNoGateOn(env: Record<string, string | undefined>): boolean {
  if (env.SB_YESNO === '0') return false;
  if (env.SB_TEST || env.VITEST) return env.SB_YESNO === '1';
  return true;
}
