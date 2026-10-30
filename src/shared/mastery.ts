// Impara's overall score and the mastery of each subject (ADR 0204; owner, 2026-10-30, report «Impara v3» I6: «un numero
// da 0 a 100 che scende se non ripassi, perché misura cosa ricordi oggi e non quanto hai fatto»). Pure functions over
// the review cards and their log (shared/review.ts, FSRS):
// - memory = the mean FSRS chance of remembering today over the cards studied at least once (the «memoria stimata
//   oggi» each subject already shows);
// - a card is solid when its stability is at least SOLID_DAYS (it would still be remembered with 90% chance three
//   weeks from its last review) and its last grade was at least «Giusto» (3);
// - score = round(100 × memory × solid cards / all cards): it falls day by day without reviews (memory decays) and
//   cannot be farmed by doing many lessons (new cards lower the solid share until they are learned);
// - the weekly delta replays the log up to seven days ago (schedule() is deterministic) and compares;
// - the subject's level, in the spirit of Khan Academy's mastery levels (Iniziato, Familiare, Competente,
//   Padroneggiato), from three numbers the user can see: cards studied, solid cards, memory today (LEVEL_RULES).
// Used by main/learn/service.ts (ImparaState.review) and the renderer (components/impara/ImparaScore.tsx);
// tests: test/unit/mastery.test.ts.
import { recallNow, schedule, type CardMemory, type ReviewCard, type ReviewGrade, type ReviewLog } from './review';

const DAY = 86_400_000;
/** stability (days) from which a card counts as solid */
export const SOLID_DAYS = 21;

export type MasteryLevel = 'started' | 'familiar' | 'proficient' | 'mastered';
export const MASTERY_LEVELS: readonly MasteryLevel[] = ['started', 'familiar', 'proficient', 'mastered'];
/** What each level asks (shares of the subject's cards, memory as a chance), checked from the highest down; below
 *  «familiar» a subject with a lesson is «started». */
export const LEVEL_RULES: Readonly<Record<Exclude<MasteryLevel, 'started'>, { studied: number; solid: number; memory: number }>> = {
  mastered: { studied: 1, solid: 0.8, memory: 0.9 },
  proficient: { studied: 0.8, solid: 0.4, memory: 0.8 },
  familiar: { studied: 0.5, solid: 0, memory: 0.7 },
};

export interface SubjectMastery { level: MasteryLevel; cards: number; studied: number; solid: number; memory: number | null }
export interface ImparaScore {
  /** 0-100; null with no card yet */
  score: number | null;
  /** mean chance of remembering today over the studied cards, null when none */
  memory: number | null;
  solid: number; cards: number; studied: number;
  /** score now minus score seven days ago (null when there was no card then) */
  delta: number | null;
  streak: number;
  lessonsDone: number;
}

/** The last grade of each card in the log. */
export function lastGrades(log: readonly ReviewLog[]): Map<string, ReviewGrade> {
  const out = new Map<string, ReviewGrade>();
  for (const l of [...log].sort((a, b) => a.at - b.at)) out.set(l.card, l.grade);
  return out;
}

/** Solid: stability ≥ SOLID_DAYS and the last grade at least good (unknown when the log was trimmed: the stability
 *  decides). */
export const isSolid = (m: CardMemory | null, last: ReviewGrade | undefined): boolean => !!m && m.last !== null && m.s >= SOLID_DAYS && (last === undefined || last >= 3);

interface Tally { cards: number; studied: number; solid: number; memory: number | null }
function tally(mems: readonly { mem: CardMemory | null; last: ReviewGrade | undefined }[], now: number): Tally {
  const r = mems.map(x => recallNow(x.mem, now)).filter((x): x is number => x !== null);
  return { cards: mems.length, studied: r.length, solid: mems.filter(x => isSolid(x.mem, x.last)).length, memory: r.length ? r.reduce((a, b) => a + b, 0) / r.length : null };
}
const scoreOfTally = (t: Tally): number | null => (t.cards ? Math.round(100 * (t.memory ?? 0) * (t.solid / t.cards)) : null);

/** The cards as they were at `at`: the ones that existed then, their memory replayed from the log up to it. */
export function memoriesAt(cards: readonly Pick<ReviewCard, 'id' | 'createdAt'>[], log: readonly ReviewLog[], at: number): { mem: CardMemory | null; last: ReviewGrade | undefined }[] {
  const by = new Map<string, ReviewLog[]>();
  for (const l of log) if (l.at <= at) by.set(l.card, [...(by.get(l.card) ?? []), l]);
  return cards.filter(c => c.createdAt <= at).map(c => {
    let mem: CardMemory | null = null, last: ReviewGrade | undefined;
    for (const l of (by.get(c.id) ?? []).sort((a, b) => a.at - b.at)) { mem = schedule(mem, l.grade, l.at); last = l.grade; }
    return { mem, last };
  });
}

/** The overall score (see the header). `cards` = the cards the review may ask. */
export function scoreOf(cards: readonly ReviewCard[], log: readonly ReviewLog[], now: number, extra: { streak: number; lessonsDone: number }): ImparaScore {
  const last = lastGrades(log);
  const t = tally(cards.map(c => ({ mem: c.mem, last: last.get(c.id) })), now);
  const before = tally(memoriesAt(cards, log, now - 7 * DAY), now - 7 * DAY);
  const score = scoreOfTally(t), then = scoreOfTally(before);
  return { score, memory: t.memory, solid: t.solid, cards: t.cards, studied: t.studied, delta: score !== null && then !== null ? score - then : null, ...extra };
}

/** A subject's level (LEVEL_RULES) from its cards. */
export function masteryOf(cards: readonly ReviewCard[], log: readonly ReviewLog[], now: number, last = lastGrades(log)): SubjectMastery {
  const t = tally(cards.map(c => ({ mem: c.mem, last: last.get(c.id) })), now);
  const level = levelOf(t);
  return { level, cards: t.cards, studied: t.studied, solid: t.solid, memory: t.memory };
}

export function levelOf(t: Tally): MasteryLevel {
  if (!t.cards || t.memory === null) return 'started';
  const studied = t.studied / t.cards, solid = t.solid / t.cards;
  for (const level of ['mastered', 'proficient', 'familiar'] as const) {
    const r = LEVEL_RULES[level];
    if (studied >= r.studied && solid >= r.solid && t.memory >= r.memory) return level;
  }
  return 'started';
}
