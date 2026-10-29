// Impara's review (ADR 0189; owner, 2026-10-29: «una sorta di ripasso a quiz su ogni materia»): every lesson belongs to
// a subject and leaves review cards: its checks (at zero tokens) and the cards a short run writes from the lesson's
// verified facts only (each card cites them; a card citing none is dropped). Cards are scheduled by FSRS, the
// spaced-repetition model Anki ships (formulas and the 19 default weights as in Borretti, "Implementing FSRS in 100
// Lines", 2025, https://borretti.me/article/implementing-fsrs-in-100-lines; Anki's manual, "What spaced repetition
// algorithm does Anki use?"): the next review falls when the chance of remembering drops to 90%. A subject's quiz mixes
// its lessons (interleaving, Rohrer & Taylor 2007) and the mastery shown is that model's estimate of recall today,
// never a made-up score. Shared by main (learn/review-store.ts, learn/service.ts) and the renderer (ImparaReview.tsx);
// tests: test/unit/review.test.ts.

export type CardKind = 'choice' | 'recall' | 'node';
/** FSRS grades: 1 forgot, 2 hard, 3 good, 4 easy */
export type ReviewGrade = 1 | 2 | 3 | 4;
export const REVIEW_GRADES: readonly ReviewGrade[] = [1, 2, 3, 4];

/** A card's memory state: next review (ms), stability (days), difficulty (1-10), how many reviews and lapses. */
export interface CardMemory { due: number; s: number; d: number; reps: number; lapses: number; last: number | null }

export interface ReviewCard {
  /** `<lesson id>:<k>` */
  id: string;
  lessonId: string;
  subject: string;
  kind: CardKind;
  /** where it came from: one of the lesson's checks, or the cards run */
  origin: 'check' | 'cards';
  q: string;
  /** choice: 2-4 options and the right one */
  options?: string[];
  correct?: number;
  /** node: the diagram node that answers it */
  node?: string;
  /** recall: the answer; choice and node: why the answer is right */
  answer: string;
  /** the lesson's facts it stands on */
  cites?: string[];
  createdAt: number;
  mem: CardMemory | null;
}

export interface ReviewLog { card: string; at: number; grade: ReviewGrade }

/** One subject on the start page: its lessons and cards, how many are due, and the model's estimate of recall today
 *  over the cards studied at least once (null until one is). */
export interface ReviewSubject { name: string; lessons: number; cards: number; due: number; fresh: number; recall: number | null }
export interface ReviewSummary { due: number; fresh: number; subjects: ReviewSubject[]; streak: number; reviewedToday: number }

/** A card as a review session shows it: with the lesson's title, its diagram (for a node card) and the facts it cites. */
export interface ReviewItem { card: ReviewCard; lesson: string; diagram?: string; facts: { id: string; claim: string; ref: string; from: 'web' | 'file' | 'known' }[] }
export type ReviewMode = 'due' | 'quiz';

// ── FSRS ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** the default weights (19, as in Borretti 2025) */
export const FSRS_W: readonly number[] = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
const F = 19 / 81, C = -0.5;
/** the chance of remembering at which the next review falls */
export const DESIRED_RETENTION = 0.9;
const DAY = 86_400_000;
const clampD = (d: number) => Math.min(10, Math.max(1, d));
const w = (i: number) => FSRS_W[i]!;

/** The chance of remembering `days` after the last review, with stability `s` (days). */
export const retrievability = (days: number, s: number): number => Math.pow(1 + (F * Math.max(0, days)) / Math.max(s, 0.01), C);
/** Days until the chance of remembering falls to `r`. */
export const intervalDays = (s: number, r = DESIRED_RETENTION): number => (s / F) * (Math.pow(r, 1 / C) - 1);
const initialD = (g: ReviewGrade) => clampD(w(4) - Math.exp(w(5) * (g - 1)) + 1);

/** The memory after a review with grade `g` at `now`. */
export function schedule(m: CardMemory | null, g: ReviewGrade, now: number): CardMemory {
  let s: number, d: number;
  if (!m || m.last === null) {
    s = w(g - 1);
    d = initialD(g);
  } else {
    const r = retrievability((now - m.last) / DAY, m.s);
    if (g === 1) {
      const sf = Math.pow(m.d, -w(12)) * (Math.pow(m.s + 1, w(13)) - 1) * Math.exp(w(14) * (1 - r)) * w(11);
      s = Math.min(sf, m.s);
    } else {
      const alpha = 1 + (11 - m.d) * Math.pow(m.s, -w(9)) * (Math.exp(w(10) * (1 - r)) - 1) * (g === 2 ? w(15) : 1) * (g === 4 ? w(16) : 1) * Math.exp(w(8));
      s = m.s * alpha;
    }
    const d1 = m.d + -w(6) * (g - 3) * ((10 - m.d) / 9);
    d = clampD(w(7) * initialD(4) + (1 - w(7)) * d1);
  }
  s = Math.max(0.01, s);
  // a forgotten card comes back in the same session (ImparaReview) and tomorrow at the latest
  const days = g === 1 ? Math.min(1, intervalDays(s)) : Math.max(1, Math.round(intervalDays(s)));
  return { due: now + days * DAY, s, d, reps: (m?.reps ?? 0) + 1, lapses: (m?.lapses ?? 0) + (g === 1 && m ? 1 : 0), last: now };
}

/** The chance of remembering a studied card now, or null for one never studied. */
export const recallNow = (m: CardMemory | null, now: number): number | null => (m && m.last !== null ? retrievability((now - m.last) / DAY, m.s) : null);
export const isDue = (c: Pick<ReviewCard, 'mem'>, now: number): boolean => !!c.mem && c.mem.due <= now;

// ── summaries and queues ───────────────────────────────────────────────────────────────────────────────────────────

/** Days in a row, up to today, with at least one review (local days). */
export function streakOf(log: readonly ReviewLog[], now: number): { streak: number; today: number } {
  const day = (t: number) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const days = new Set(log.map(l => day(l.at)));
  const today = day(now);
  let streak = 0;
  for (let d = days.has(today) ? today : today - DAY; days.has(d); d = day(d - DAY / 2)) streak++;
  return { streak, today: log.filter(l => day(l.at) === today).length };
}

export function summarize(cards: readonly ReviewCard[], log: readonly ReviewLog[], lessonsBySubject: ReadonlyMap<string, number>, now: number): ReviewSummary {
  const names = new Set([...lessonsBySubject.keys(), ...cards.map(c => c.subject)]);
  const subjects = [...names].map((name): ReviewSubject => {
    const own = cards.filter(c => c.subject === name);
    const r = own.map(c => recallNow(c.mem, now)).filter((x): x is number => x !== null);
    return { name, lessons: lessonsBySubject.get(name) ?? 0, cards: own.length, due: own.filter(c => isDue(c, now)).length, fresh: own.filter(c => !c.mem).length,
      recall: r.length ? r.reduce((a, b) => a + b, 0) / r.length : null };
  }).sort((a, b) => b.due - a.due || b.lessons - a.lessons || a.name.localeCompare(b.name));
  const s = streakOf(log, now);
  return { due: cards.filter(c => isDue(c, now)).length, fresh: cards.filter(c => !c.mem).length, subjects, streak: s.streak, reviewedToday: s.today };
}

/** Round robin over the lessons: no two cards of the same lesson in a row while another lesson has some (interleaving). */
export function interleave(cards: readonly ReviewCard[]): ReviewCard[] {
  const by = new Map<string, ReviewCard[]>();
  for (const c of cards) by.set(c.lessonId, [...(by.get(c.lessonId) ?? []), c]);
  const lanes = [...by.values()];
  const out: ReviewCard[] = [];
  for (let i = 0; out.length < cards.length; i++) for (const lane of lanes) if (lane[i]) out.push(lane[i]!);
  return out;
}

/** What a session asks, at most `max` cards. «Ripassa»: the due cards (most forgotten first), then up to a few new
 *  ones. A subject's quiz: its due cards, then its new ones, then the ones least likely remembered, interleaved. */
export function queueOf(cards: readonly ReviewCard[], mode: ReviewMode, now: number, opts: { subject?: string; max?: number; fresh?: number } = {}): ReviewCard[] {
  const max = opts.max ?? (mode === 'quiz' ? 10 : 30);
  const pool = opts.subject ? cards.filter(c => c.subject === opts.subject) : [...cards];
  const due = pool.filter(c => isDue(c, now)).sort((a, b) => (recallNow(a.mem, now) ?? 1) - (recallNow(b.mem, now) ?? 1));
  // the new ones from every lesson in turn, so a few new cards are not all from one lesson
  const fresh = interleave(pool.filter(c => !c.mem).sort((a, b) => a.createdAt - b.createdAt));
  if (mode === 'due') return interleave([...due, ...fresh.slice(0, opts.fresh ?? 5)].slice(0, max));
  const rest = pool.filter(c => c.mem && !isDue(c, now)).sort((a, b) => (recallNow(a.mem, now) ?? 1) - (recallNow(b.mem, now) ?? 1));
  return interleave([...due, ...fresh, ...rest].slice(0, max));
}

/** The grade a choice or node answer earns: wrong = forgot; right = the user's own hard / good / easy. */
export const gradeOf = (right: boolean, felt: 2 | 3 | 4 = 3): ReviewGrade => (right ? felt : 1);

// ── parsing the cards run ──────────────────────────────────────────────────────────────────────────────────────────

export const CARDS_MAX = 10;
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

export type CardDraft = Omit<ReviewCard, 'id' | 'lessonId' | 'subject' | 'createdAt' | 'mem' | 'origin'>;

/** The cards a run wrote: only the well-formed ones that cite at least one of the verified facts `facts` (and, for a
 *  node card, name a node of the diagram). */
export function parseCards(v: unknown, nodes: readonly string[], facts: readonly string[]): CardDraft[] {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  const list = Array.isArray(o?.cards) ? (o!.cards as unknown[]) : [];
  const out: CardDraft[] = [];
  for (const raw of list) {
    if (out.length >= CARDS_MAX) break;
    if (!raw || typeof raw !== 'object') continue;
    const x = raw as Record<string, unknown>;
    const q = str(x.q, 300), answer = str(x.answer ?? x.why, 500);
    const cites = (Array.isArray(x.cites) ? x.cites : []).filter((id): id is string => typeof id === 'string' && facts.includes(id)).slice(0, 4);
    if (!q || !answer || !cites.length) continue;
    if (x.kind === 'choice') {
      const options = (Array.isArray(x.options) ? x.options : []).map(op => str(op, 160)).filter(Boolean).slice(0, 4);
      const correct = typeof x.correct === 'number' && Number.isInteger(x.correct) ? x.correct : -1;
      if (options.length < 2 || correct < 0 || correct >= options.length || new Set(options).size !== options.length) continue;
      out.push({ kind: 'choice', q, options, correct, answer, cites });
    } else if (x.kind === 'node') {
      const node = typeof x.node === 'string' ? x.node.trim() : '';
      if (!nodes.includes(node)) continue;
      out.push({ kind: 'node', q, node, answer, cites });
    } else if (x.kind === 'recall') {
      out.push({ kind: 'recall', q, answer, cites });
    }
  }
  return out;
}

/** A subject name as the user or the model wrote it: one line, at most 40 characters; '' when there is none. */
export const subjectName = (v: unknown): string => str(v, 40).replace(/[\\/]/g, '-');
