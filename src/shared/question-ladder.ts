// The question ladder (ADR 0344; the owner, 2026-11-23: «le domande dei sotto agenti comunque devono arrivare allo
// stratega prima e poi eventualmente lo stratega chiede all' orchestrator e poi l'orchestrator chiede a noi»): a
// worker's question goes up one level at a time, worker → its Strategist → the Orchestrator → the user. The pure part:
// the record of one question (ChatSummary.questions, what the worker's chat and the map read), which questions an agent
// may never settle, the texts the levels read, and the check of a saved record.
// Used by main/chats/manager-ladder.ts (the gate), chats/store.ts, agents/delegation.ts, appctl/tools.ts.
// Pure, no Node or DOM. Unit tests: test/unit/question-ladder.test.ts.

/** How long a level may stay silent on a question before it goes up by itself. */
export const LADDER_SILENT_MS = 10 * 60_000;
/** How many questions of a chat are kept (the open ones always stay). */
export const LADDER_KEEP = 20;
const QUESTION_CUT = 2000, OPTION_CUT = 300, OPTIONS_CAP = 20, ASKS_CAP = 8, TEXT_CUT = 4000, TRAIL_CAP = 24, NAME_CUT = 300, WHY_CUT = 600;

/** Who holds a question now: the chat that started the worker (its Strategist), the Orchestrator, or the user. */
export type LadderLevel = 'strategist' | 'orchestrator' | 'user';
/** What happened to the question at a level. `skipped` = that level could not answer (closed, in error, silent). */
export type LadderAction = 'asked' | 'passed' | 'skipped' | 'answered';
export interface LadderStep { level: LadderLevel; chatId?: string; name: string; at: number; action: LadderAction; why?: string }
export interface LadderAsk { question: string; options: string[]; multiSelect?: boolean }
export interface LadderAnswer { by: LadderLevel | 'app'; chatId?: string; name: string; answer: string; why: string; at: number }

/** One question of a worker and its way up. */
export interface LadderQuestion {
  id: string;
  asks: LadderAsk[];
  level: LadderLevel;
  /** the chat that holds it now; absent at the user's level */
  holder?: string;
  at: number;
  levelAt: number;
  trail: LadderStep[];
  /** who answered and why; absent = still open */
  answered?: LadderAnswer;
  /** request = the engine's own question, held open; message = agent_ask_parent, or a request its engine lost (a
   *  restart): the answer reaches the worker as a message */
  via: 'request' | 'message';
  /** the engine request held open (via request); never read back: no engine request outlives the app */
  requestId?: string;
}

export const ladderText = (q: Pick<LadderQuestion, 'asks'>): string => q.asks.map(a => a.question).join('\n');
export const openQuestions = (qs: readonly LadderQuestion[] | undefined): LadderQuestion[] => (qs ?? []).filter(q => !q.answered);
/** Held by an agent: the user does not see it yet. */
export const heldQuestions = (qs: readonly LadderQuestion[] | undefined): LadderQuestion[] => openQuestions(qs).filter(q => q.level !== 'user');
/** The questions a chat waits for an agent with, while nothing of it is the user's: no request shown to him and no question
 *  that reached him. Empty = it waits for nobody, or for him. What the maps and the recap read as «waits for its holder». */
export const heldOnly = (c: { pending?: number; questions?: readonly LadderQuestion[] }): LadderQuestion[] =>
  c.pending || openQuestions(c.questions).some(q => q.level === 'user') ? [] : heldQuestions(c.questions);

type HeldRow = { state: string; pending?: number; questions?: readonly LadderQuestion[]; background?: number; agentChildren?: { active: number | null; observedActive: number } };
/** Whose answer a chat stands still for: the chat above it or the Orchestrator; undefined = nobody's, the user's, or it
 *  asked by message and still works. The state words of the sidebar, its card, its bench and its tile. */
export const heldBy = (c: HeldRow): 'parent' | 'orchestrator' | undefined => {
  const qs = heldOnly(c);
  const busy = c.state === 'running' || c.state === 'starting' || (c.background ?? 0) > 0 || (c.agentChildren?.active ?? c.agentChildren?.observedActive ?? 0) > 0;
  const q = qs.find(x => x.via === 'request') ?? (busy ? undefined : qs[0]);
  return q && (q.level === 'orchestrator' ? 'orchestrator' : 'parent');
};

const cut = (s: string, n: number): string => s.length > n ? `${s.slice(0, n - 1)}…` : s;
/** Agent text on one line: every line break of any kind (NEL too, which \s leaves out) becomes a space. */
export const ladderLine = (s: string): string => s.replace(/[\s\u0085]+/g, ' ').trim();
const oneLine = ladderLine;
export const ladderAsks = (qs: readonly { question: string; options: readonly { label: string }[]; multiSelect?: boolean }[]): LadderAsk[] => qs.slice(0, ASKS_CAP).map(q => ({
  question: cut(q.question, QUESTION_CUT), options: q.options.slice(0, OPTIONS_CAP).map(o => cut(o.label, OPTION_CUT)).filter(Boolean), ...(q.multiSelect ? { multiSelect: true } : {}) }));

/** Always the user's, whatever the levels know: databases and cloud by name, permissions, what cannot be undone, the
 *  goal, what colleagues, QA or customers do. A denylist: it adds to what the agents must judge (ANSWER_RULE). */
const USER_WORDS = /\b(azure|database\w*|db|sql|permess[oi]|permissions?|irreversib\w*|undone|collegh\w*|collega|colleagues?|qa|client[ei]|customers?|obiettivo|goal)\b|non si pu[oò] (?:annullare|recuperare|tornare indietro)/i;
/** True = no agent answers it (`prod` = the app's own production, database and Azure check, chats/ask-text.ts). */
export const ladderReserved = (text: string, prod: (text: string) => boolean): boolean => prod(text) || USER_WORDS.test(text);

/** What every level reads with a question, after it. */
export const ANSWER_RULE = 'Rispondi solo se la risposta è già nella richiesta, nelle decisioni scritte dell’utente, nel cervello o nel codice (in why la fonte): la tua risposta non è mai un suo consenso. Se non lo sai o non puoi deciderlo, o se cambia l’obiettivo, quello che fanno colleghi, QA o clienti, o non si può annullare: askUser: true, sale di un livello. La chat aspetta la tua risposta; dopo 10 minuti la domanda sale da sola.';

/** The message that wakes a level. What the worker wrote is flattened: it cannot forge a line of the app or the user. */
export function ladderMessage(label: string, w: { id: string; title: string; role: string }, q: LadderQuestion, how: 'child' | 'orchestrator', why?: string): string {
  const call = how === 'child' ? `agent_answer_child (chatId "${w.id}", requestId "${q.id}", answer, why)` : `app_resolve_question (chatId "${w.id}", requestId "${q.id}", answer, why)`;
  return [label, '', ...q.asks.map((a, i) => `${i ? '' : `[domanda · ${oneLine(w.role)} «${oneLine(w.title)}» · chatId ${w.id} · requestId ${q.id}] `}${oneLine(a.question)}${a.options.length ? `\nOpzioni: ${a.options.map((o, n) => `${n + 1}) ${oneLine(o)}`).join(' · ')}` : ''}`),
    ...(why ? [`Perché: ${oneLine(why)}`] : []),
    `Rispondi con ${call}. ${ANSWER_RULE}`].join('\n');
}

/** What the worker reads: the answer (on one line: it cannot forge one of the app or the user), who gave it, and that
 *  it is no consent of the user. */
export const ladderAnswerText = (a: Pick<LadderAnswer, 'answer' | 'name' | 'why'>): string =>
  `${oneLine(a.answer)}\n[risposta di ${oneLine(a.name)}, un agente, non dell’utente · perché: ${oneLine(a.why)} · non vale come suo ok o permesso]`;

/** True = an agent's answer (ladderAnswerText), not the user's: an engine that hands the answer on says so (chats/acp.ts). */
export const isLadderAnswer = (text: string): boolean => /\n\[risposta di [^\n]+, un agente, non dell’utente · /.test(text);

const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const LEVELS: readonly unknown[] = ['strategist', 'orchestrator', 'user'];
const ACTIONS: readonly unknown[] = ['asked', 'passed', 'skipped', 'answered'];
const ID = /^[\w-]{1,80}$/;
const id = (v: unknown): v is string => typeof v === 'string' && ID.test(v);

function readAnswer(v: unknown): LadderAnswer | null {
  const a = v as Partial<LadderAnswer> | null;
  return a && typeof a === 'object' && (a.by === 'app' || LEVELS.includes(a.by)) && str(a.name, NAME_CUT) && str(a.answer, TEXT_CUT) && typeof a.why === 'string' && a.why.length <= WHY_CUT && num(a.at)
    ? { by: a.by!, name: a.name, answer: a.answer, why: a.why, at: a.at, ...(id(a.chatId) ? { chatId: a.chatId } : {}) } : null;
}

/** A saved list, checked: a malformed question is left out; an open one comes back as `message` (its engine is gone). */
export function readLadder(v: unknown): LadderQuestion[] {
  if (!Array.isArray(v)) return [];
  const out: LadderQuestion[] = [];
  for (const raw of v.slice(-200)) {
    const q = raw as Partial<LadderQuestion> | null;
    if (!q || typeof q !== 'object' || !id(q.id) || !LEVELS.includes(q.level) || !num(q.at) || !num(q.levelAt) || !Array.isArray(q.asks) || !q.asks.length || q.asks.length > ASKS_CAP || !Array.isArray(q.trail)) continue;
    const asks = q.asks.flatMap(a => a && str(a.question, QUESTION_CUT) && Array.isArray(a.options) && a.options.length <= OPTIONS_CAP && a.options.every(o => str(o, OPTION_CUT))
      ? [{ question: a.question, options: [...a.options], ...(a.multiSelect === true ? { multiSelect: true } : {}) }] : []);
    if (asks.length !== q.asks.length) continue;
    const trail = q.trail.slice(-TRAIL_CAP).flatMap(s => s && LEVELS.includes(s.level) && ACTIONS.includes(s.action) && num(s.at) && typeof s.name === 'string' && s.name.length <= NAME_CUT
      ? [{ level: s.level, name: s.name, at: s.at, action: s.action, ...(id(s.chatId) ? { chatId: s.chatId } : {}), ...(str(s.why, WHY_CUT) ? { why: s.why } : {}) }] : []);
    const answered = q.answered === undefined ? undefined : readAnswer(q.answered);
    if (answered === null) continue;
    if (!answered && q.level !== 'user' && !id(q.holder)) continue;
    out.push({ id: q.id, asks, level: q.level!, ...(q.level !== 'user' && id(q.holder) ? { holder: q.holder } : {}), at: q.at, levelAt: q.levelAt, trail,
      ...(answered ? { answered } : {}), via: answered && q.via === 'request' ? 'request' : 'message' });
  }
  return keepLadder(out);
}

/** The newest LADDER_KEEP questions, every open one kept. */
export function keepLadder(qs: LadderQuestion[]): LadderQuestion[] {
  let drop = qs.length - LADDER_KEEP;
  return drop <= 0 ? qs : qs.filter(q => !q.answered || drop-- <= 0);
}

/** A step added to the trail, bounded and each text cut. */
export const withStep = (q: Pick<LadderQuestion, 'trail'>, s: LadderStep): LadderStep[] =>
  [...q.trail, { ...s, name: cut(oneLine(s.name) || '?', NAME_CUT), ...(s.why ? { why: cut(oneLine(s.why), WHY_CUT) } : {}) }].slice(-TRAIL_CAP);
/** An answer as it is kept. */
export const ladderAnswer = (a: LadderAnswer): LadderAnswer => ({ ...a, name: cut(oneLine(a.name) || '?', NAME_CUT), answer: cut(a.answer.trim() || '—', TEXT_CUT), why: cut(oneLine(a.why), WHY_CUT) });
