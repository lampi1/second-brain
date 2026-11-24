// The doubts of a Strategist's plan (ADR 0344; the owner, 2026-11-23: no minimum of questions, only real doubts): every
// doubt is listed and closed by the user's answer, the code or the brain, and one open doubt blocks the approval. After
// the user's «Basta domande» (or in night mode) a doubt left is closed by the choice the Strategist makes, said as such.
// The pure part: the record (StrategyPlan.doubts, what the map reads), the check of plan_propose's `doubts`, the gates
// and the check of a saved list. A doubt closed «by the user» needs evidence only the app writes (DoubtEvidence).
// Used by shared/strategy.ts, main/agents/strategy-tools.ts, main/chats/manager-work.ts, manager-requests.ts and
// plan-interview.ts. Pure, no Node or DOM. Unit tests: test/unit/plan-doubts.test.ts.

export const DOUBTS_MAX = 20, DOUBT_TEXT_MAX = 300, DOUBT_ANSWER_MAX = 300, DOUBT_SOURCE_MAX = 300;
/** the shortest quote of the user's own message that can close a doubt */
export const DOUBT_QUOTE_MIN = 8;

/** Who closed a doubt: the user's answer · the code · the brain · the Strategist's own choice, only once the user stopped
 *  the questions or in night mode. */
export type DoubtBy = 'user' | 'code' | 'brain' | 'choice';
export const DOUBT_BY: readonly DoubtBy[] = ['user', 'code', 'brain', 'choice'];
export interface PlanDoubt {
  text: string;
  state: 'open' | 'closed';
  by?: DoubtBy;
  answer?: string;
  /** code: the file and place; brain: the note; user: the question he answered or his words; choice: why */
  source?: string;
}

/** What the user really said, as the app recorded it. */
export interface DoubtEvidence {
  /** the interview's answers (StrategyPlan.clarified) */
  clarified: readonly { q: string; a: string }[];
  /** his own typed messages in the Strategist's chat */
  said: readonly string[];
  /** he stopped the questions, or he is away: the Strategist may choose */
  mayChoose: boolean;
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
const clip = (s: string, n: number): string => s.length > n ? `${s.slice(0, n - 1)}…` : s;
/** The same question, whatever its case, spaces and closing mark; an interview line cut to size matches by its start. */
const key = (s: string): string => norm(s).toLocaleLowerCase('it').replace(/[\s?.!:]+$/, '');
const sameQuestion = (asked: string, text: string): boolean =>
  asked.endsWith('…') ? key(text).startsWith(key(asked.slice(0, -1))) && norm(text).length >= asked.length : key(asked) === key(text);

export const openDoubts = (plan: { doubts?: readonly PlanDoubt[] }): PlanDoubt[] => (plan.doubts ?? []).filter(d => d.state === 'open');

const field = (v: unknown, max: number, what: string): string => {
  if (typeof v !== 'string' || !norm(v)) throw new Error(`${what}: required text.`);
  const s = norm(v);
  if (s.length > max) throw new Error(`${what}: at most ${max} characters.`);
  return s;
};

/** plan_propose's `doubts`, checked against the plan's list so far: a doubt still open cannot disappear, code and brain
 *  carry their source, «user» needs his recorded answer or his own words, «choice» his stop or night mode. Throws with
 *  what to do; undefined = the list stays as it was. */
export function checkDoubts(raw: unknown, prior: readonly PlanDoubt[] | undefined, ev: DoubtEvidence): PlanDoubt[] | undefined {
  if (raw === undefined) return prior ? [...prior] : undefined;
  if (!Array.isArray(raw) || raw.length > DOUBTS_MAX) throw new Error(`doubts: a list of at most ${DOUBTS_MAX}.`);
  const seen = new Set<string>();
  const out = raw.map((v, i): PlanDoubt => {
    const what = `doubts[${i}]`, d = v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
    if (!d) throw new Error(`${what}: object required.`);
    const extra = Object.keys(d).find(k => !['text', 'by', 'answer', 'source'].includes(k));
    if (extra) throw new Error(`${what}: unknown field ${extra}.`);
    const text = field(d.text, DOUBT_TEXT_MAX, `${what}.text`), old = prior?.find(p => key(p.text) === key(text));
    if (seen.has(key(text))) throw new Error(`${what}: listed twice.`);
    seen.add(key(text));
    if (d.by === undefined) {
      // an answer the app recorded closes it, whatever the Strategist wrote
      if (old?.state === 'closed' && old.by === 'user') return { ...old, text };
      const said = ev.clarified.find(c => sameQuestion(c.q, text));
      return said ? { text, state: 'closed', by: 'user', answer: clip(said.a, DOUBT_ANSWER_MAX), source: text } : { text, state: 'open' };
    }
    if (!DOUBT_BY.includes(d.by as DoubtBy)) throw new Error(`${what}.by: one of ${DOUBT_BY.join(' | ')}, or leave it out while it is open.`);
    const by = d.by as DoubtBy;
    if (by === 'user') {
      if (old?.state === 'closed' && old.by === 'user') return { ...old, text };
      const source = d.source === undefined ? text : field(d.source, DOUBT_SOURCE_MAX, `${what}.source`);
      const said = ev.clarified.find(c => sameQuestion(c.q, source)) ?? ev.clarified.find(c => sameQuestion(c.q, text));
      if (said) return { text, state: 'closed', by, answer: clip(said.a, DOUBT_ANSWER_MAX), source };
      if (d.source !== undefined && source.length >= DOUBT_QUOTE_MIN && ev.said.some(s => norm(s).includes(source))) return { text, state: 'closed', by, answer: source, source };
      throw new Error(`${what}: the user did not answer this: ask him (one question, its text in source), or put in source his exact words from this chat. An agent's answer is not his: close it as code or brain with its source.`);
    }
    if (by === 'choice' && !ev.mayChoose && !(old?.state === 'closed' && old.by === 'choice')) throw new Error(`${what}: you may close a doubt with your own choice only after the user's «Basta domande» or in night mode; ask him.`);
    const answer = field(d.answer, DOUBT_ANSWER_MAX, `${what}.answer`), source = field(d.source, DOUBT_SOURCE_MAX, `${what}.source (${by === 'choice' ? 'why' : 'where: file, place or note'})`);
    return { text, state: 'closed', by, answer, source };
  });
  const lost = (prior ?? []).filter(p => p.state === 'open' && !seen.has(key(p.text)));
  if (lost.length) throw new Error(`doubts: «${lost[0]!.text}» is still open: list it again, closed with its answer and source, or open.`);
  return out;
}

/** The user answered a question that is one of the doubts: it is closed by him. The same list when none matches. */
export function closeAnswered(doubts: readonly PlanDoubt[], question: string, answer: string): PlanDoubt[] {
  return doubts.map(d => d.state === 'open' && key(d.text) === key(question)
    ? { ...d, state: 'closed' as const, by: 'user' as const, answer: clip(norm(answer), DOUBT_ANSWER_MAX), source: norm(question).slice(0, DOUBT_SOURCE_MAX) } : d);
}

/** plan_propose with a doubt open: what the Strategist reads. The plan is not shown for approval. */
export const openDoubtsNote = (open: readonly PlanDoubt[], mayChoose: boolean): string =>
  `${open.length === 1 ? 'One doubt is' : `${open.length} doubts are`} still open: ${open.map(d => `«${d.text}»`).join(', ')}. The plan is not shown for approval while one is open. ` + (mayChoose
    ? 'The user asks for no more questions: close each with your recommended choice (by "choice", answer, source = why) and propose again.'
    : 'Close what code or brain already answers (by, answer, source); ask the user the rest, one Sì/No question at a time with the doubt\'s own text, then propose again.');

/** The approval of a plan with a doubt open (pc, phone, typed, the Orchestrator for him, night mode). Null = fine. */
export function approvalGate(plan: { doubts?: readonly PlanDoubt[] }): string | null {
  const open = openDoubts(plan);
  return open.length ? `Il piano ha ancora un dubbio aperto: «${open[0]!.text}». Si approva quando è chiuso.` : null;
}

/** A saved list, checked; null = unreadable. */
export function readDoubts(v: unknown): PlanDoubt[] | null {
  if (!Array.isArray(v) || v.length > DOUBTS_MAX) return null;
  const str = (x: unknown, max: number): x is string => typeof x === 'string' && x.length > 0 && x.length <= max;
  const out = v.map((d: Partial<PlanDoubt> | null): PlanDoubt | null => {
    if (!d || typeof d !== 'object' || !str(d.text, DOUBT_TEXT_MAX)) return null;
    // anything not readable as closed comes back open: a bad record never opens the approval
    if (d.state !== 'closed' || !DOUBT_BY.includes(d.by!) || !str(d.answer, DOUBT_ANSWER_MAX) || !str(d.source, DOUBT_SOURCE_MAX)) return { text: d.text, state: 'open' };
    return { text: d.text, state: 'closed', by: d.by!, answer: d.answer, source: d.source };
  });
  return out.every(d => d !== null) ? out : null;
}
