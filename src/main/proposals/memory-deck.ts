// How the memory facts waiting for the user become Proposte cards (ADR 0128): fewer cards, the same facts.
//   1. near-duplicates (same scope, nearly the same words, memory-worth.ts nearSame) are one card: its best fact, the
//      others decided with it (approved: they go as merged into it; rejected: they all go);
//   2. a fact with the same words as one already confirmed in its scope is not shown (the maintenance retires it);
//   3. per role and per day at most MEMORY_CARDS_PER_DAY cards, the best first (a rule or procedure, then a plain fact,
//      a case-specific one last; then the newest); the rest of that day is one batch card, decided as a whole.
// A fact that contradicts a confirmed one keeps its own card (it needs the user's replace or keep-both choice); free
// notes («setup · note») never contradict each other (memory-records.ts memoryConflicts).
// Pure over the records. Used by proposals/sources.ts; unit tests: test/unit/proposals/memory-deck.test.ts.
import type { MemoryReviewRecord } from '../../shared/learning-review';
import { emptyPredicate } from '../../shared/proposals';
import { factWords, memoryWorth, nearSame, type MemoryWorth } from '../rules/memory-worth';

export const MEMORY_CARDS_PER_DAY = 3;

/** One card's facts: the one shown and its near-duplicates. */
export interface FactGroup { rep: MemoryReviewRecord; dups: MemoryReviewRecord[]; worth: MemoryWorth; conflicts: MemoryReviewRecord[] }
export type MemoryCard = { kind: 'one'; group: FactGroup } | { kind: 'batch'; id: string; role: string; day: string; groups: FactGroup[] };

const sameScope = (a: MemoryReviewRecord, b: MemoryReviewRecord): boolean => a.scope.roleId === b.scope.roleId && a.scope.userId === b.scope.userId
  && a.scope.project === b.scope.project && a.scope.repository === b.scope.repository && a.scope.environment === b.scope.environment;
const live = (r: MemoryReviewRecord): boolean => r.status === 'confirmed' && !r.validTo;
const sameWords = (a: string, b: string): boolean => { const x = factWords(a), y = factWords(b); return x.size > 0 && x.size === y.size && [...x].every(w => y.has(w)); };
/** Confirmed facts with the same subject and predicate that say something else (memory-records.ts memoryConflicts). */
export const conflictsOf = (rows: readonly MemoryReviewRecord[], r: MemoryReviewRecord): MemoryReviewRecord[] => emptyPredicate(r.predicate) ? [] :
  rows.filter(x => x.memoryId !== r.memoryId && x.memoryId !== r.supersedes && sameScope(x, r) && x.subject === r.subject && x.predicate === r.predicate && live(x) && x.value !== r.value);
/** Best first: a higher worth, then the newest, then by id (stable). */
const better = (a: { rep: MemoryReviewRecord; worth: MemoryWorth }, b: { rep: MemoryReviewRecord; worth: MemoryWorth }): number =>
  b.worth.score - a.worth.score || b.rep.observedAt.localeCompare(a.rep.observedAt) || a.rep.memoryId.localeCompare(b.rep.memoryId);

/** The memory cards for the proposed facts in `rows`. */
export function memoryCards(rows: readonly MemoryReviewRecord[], perDay = MEMORY_CARDS_PER_DAY): MemoryCard[] {
  const proposed = rows.filter(r => r.status === 'proposed' && !r.validTo);
  const confirmed = rows.filter(live);
  const worth = new Map(proposed.map(r => [r.memoryId, memoryWorth(r.subject, r.predicate, r.value)]));
  // the best fact of each set of near-duplicates leads it
  const ranked = proposed.map(rep => ({ rep, worth: worth.get(rep.memoryId)! })).sort(better);
  const groups: FactGroup[] = [], taken = new Set<string>();
  for (const { rep, worth: w } of ranked) {
    if (taken.has(rep.memoryId)) continue;
    taken.add(rep.memoryId);
    const conflicts = conflictsOf(rows, rep);
    if (!conflicts.length && confirmed.some(c => sameScope(c, rep) && sameWords(c.value, rep.value))) continue; // already known
    const dups = conflicts.length ? [] : ranked.filter(x => !taken.has(x.rep.memoryId) && sameScope(x.rep, rep) && !conflictsOf(rows, x.rep).length && nearSame(x.rep.value, rep.value)).map(x => x.rep);
    for (const d of dups) taken.add(d.memoryId);
    groups.push({ rep, dups, worth: w, conflicts });
  }
  // per role and day: the best `perDay` alone, the rest in one batch (a conflict always alone)
  const byDay = new Map<string, FactGroup[]>();
  for (const g of groups) {
    const key = `${g.rep.scope.roleId}\u0000${g.rep.observedAt.slice(0, 10)}`;
    byDay.set(key, [...(byDay.get(key) ?? []), g]);
  }
  const out: MemoryCard[] = [];
  for (const [key, list] of byDay) {
    const [role, day] = key.split('\u0000') as [string, string];
    const alone = list.filter(g => g.conflicts.length), rest = list.filter(g => !g.conflicts.length);
    const shown = rest.slice(0, Math.max(0, perDay - alone.length)), batch = rest.slice(shown.length);
    for (const g of [...alone, ...shown]) out.push({ kind: 'one', group: g });
    if (batch.length === 1) out.push({ kind: 'one', group: batch[0]! });
    else if (batch.length > 1) out.push({ kind: 'batch', id: `batch-${role}-${day}`, role, day, groups: batch });
  }
  return out;
}
