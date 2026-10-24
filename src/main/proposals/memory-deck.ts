// How the memory facts waiting for the user become Proposte cards (ADR 0129): fewer cards, the same facts.
//   1. identical facts (same scope and fact fields) are one card: its best fact, the
//      others decided with it (approved: they go as merged into it; rejected: they all go);
//   2. a fact with the same words as one already confirmed in its scope is not shown (the maintenance retires it);
//   3. per role at most MEMORY_CARDS_PER_ROLE individual cards across all dates, the best first; the rest forms
//      bounded batches within the same scope. Every fact remains reviewable, and batch IDs cover their full members.
// A fact that contradicts a confirmed one keeps its own card (it needs the user's replace or keep-both choice); free
// notes («setup · note») never contradict each other (memory-records.ts memoryConflicts).
// Pure over the records. Used by proposals/sources.ts; unit tests: test/unit/proposals/memory-deck.test.ts.
import type { MemoryReviewRecord } from '../../shared/learning-review';
import { createHash } from 'node:crypto';
import { emptyPredicate, factSentence } from '../../shared/proposals';
import { memoryWorth, sameMemoryFact, type MemoryWorth } from '../rules/memory-worth';

export const MEMORY_CARDS_PER_ROLE = 3;
export const MEMORY_BATCH_MAX_FACTS = 8;
export const MEMORY_BATCH_MAX_CHARS = 6000;

/** One card's facts: the one shown and its duplicates. */
export interface FactGroup { rep: MemoryReviewRecord; dups: MemoryReviewRecord[]; worth: MemoryWorth; conflicts: MemoryReviewRecord[] }
export type MemoryCard = { kind: 'one'; group: FactGroup } | { kind: 'batch'; id: string; role: string; day: string; groups: FactGroup[] };
/** Facts are data, including literal markup: no HTML comment or Markdown link may hide part of an approval. */
export function memoryBatchContent(groups: readonly FactGroup[]): string {
  const literal = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_{}[\]()#+.!|~-])/g, '\\$1');
  return groups.map(g => `- ${literal(factSentence(g.rep.subject, g.rep.predicate, g.rep.value))}`).join('\n');
}

const sameScope = (a: MemoryReviewRecord, b: MemoryReviewRecord): boolean => a.scope.roleId === b.scope.roleId && a.scope.userId === b.scope.userId
  && a.scope.project === b.scope.project && a.scope.repository === b.scope.repository && a.scope.environment === b.scope.environment;
const live = (r: MemoryReviewRecord): boolean => r.status === 'confirmed' && !r.validTo;
/** Confirmed facts with the same subject and predicate that say something else (memory-records.ts memoryConflicts). */
export const conflictsOf = (rows: readonly MemoryReviewRecord[], r: MemoryReviewRecord): MemoryReviewRecord[] => emptyPredicate(r.predicate) ? [] :
  rows.filter(x => x.memoryId !== r.memoryId && x.memoryId !== r.supersedes && sameScope(x, r) && x.subject === r.subject && x.predicate === r.predicate && live(x) && x.value !== r.value);
/** Best first: a higher worth, then the newest, then by id (stable). */
const better = (a: { rep: MemoryReviewRecord; worth: MemoryWorth }, b: { rep: MemoryReviewRecord; worth: MemoryWorth }): number =>
  b.worth.score - a.worth.score || b.rep.observedAt.localeCompare(a.rep.observedAt) || a.rep.memoryId.localeCompare(b.rep.memoryId);

/** The memory cards for the proposed facts in `rows`. */
export function memoryCards(rows: readonly MemoryReviewRecord[], perRole = MEMORY_CARDS_PER_ROLE): MemoryCard[] {
  const proposed = rows.filter(r => r.status === 'proposed' && !r.validTo);
  const confirmed = rows.filter(live);
  const worth = new Map(proposed.map(r => [r.memoryId, memoryWorth(r.subject, r.predicate, r.value)]));
  // the best fact of each set of duplicates leads it
  const ranked = proposed.map(rep => ({ rep, worth: worth.get(rep.memoryId)! })).sort(better);
  const groups: FactGroup[] = [], taken = new Set<string>();
  for (const { rep, worth: w } of ranked) {
    if (taken.has(rep.memoryId)) continue;
    taken.add(rep.memoryId);
    const conflicts = conflictsOf(rows, rep);
    if (!conflicts.length && !rep.supersedes && confirmed.some(c => sameScope(c, rep) && sameMemoryFact(c, rep))) continue; // already known
    const dups = conflicts.length || rep.supersedes ? [] : ranked.filter(x => !taken.has(x.rep.memoryId) && sameScope(x.rep, rep)
      && !x.rep.supersedes && !conflictsOf(rows, x.rep).length && sameMemoryFact(x.rep, rep)).map(x => x.rep);
    for (const d of dups) taken.add(d.memoryId);
    groups.push({ rep, dups, worth: w, conflicts });
  }
  // Across dates: the best per role alone, then bounded batches. Conflicts always need an individual decision.
  const byRole = new Map<string, FactGroup[]>();
  for (const g of groups) {
    const role = g.rep.scope.roleId;
    byRole.set(role, [...(byRole.get(role) ?? []), g]);
  }
  const out: MemoryCard[] = [];
  for (const [role, list] of byRole) {
    // Two pending values of one structured fact must not approve sequentially inside a batch: the second would
    // contradict the first after it was confirmed. Free notes remain independent facts.
    const individual = (g: FactGroup): boolean => !!g.conflicts.length || !!g.rep.supersedes || (!emptyPredicate(g.rep.predicate)
      && proposed.some(r => r.memoryId !== g.rep.memoryId && sameScope(r, g.rep) && r.subject === g.rep.subject && r.predicate === g.rep.predicate && r.value !== g.rep.value));
    const alone = list.filter(individual), rest = list.filter(g => !individual(g));
    const shown = rest.slice(0, Math.max(0, perRole)), remaining = rest.slice(shown.length);
    for (const g of [...alone, ...shown]) out.push({ kind: 'one', group: g });
    const scopes = new Map<string, FactGroup[]>();
    for (const g of remaining) {
      const s = g.rep.scope, key = JSON.stringify([s.roleId, s.userId, s.project, s.repository, s.environment]);
      scopes.set(key, [...(scopes.get(key) ?? []), g]);
    }
    for (const list of scopes.values()) {
      let batch: FactGroup[] = [], chars = 0;
      const flush = () => {
        if (batch.length === 1) out.push({ kind: 'one', group: batch[0]! });
        else if (batch.length > 1) {
          // Include duplicates and their text too: a stale click must not decide newly attached records.
          const members = batch.flatMap(g => [g.rep, ...g.dups]).sort((a, b) => a.memoryId.localeCompare(b.memoryId));
          const revision = createHash('sha256').update(JSON.stringify(members.map(r => [r.memoryId, r.scope, r.subject, r.predicate, r.value, r.supersedes]))).digest('hex').slice(0, 24);
          const dates = batch.map(g => g.rep.observedAt.slice(0, 10)).sort(), first = dates[0]!, last = dates.at(-1)!;
          out.push({ kind: 'batch', id: `batch-${role}-${revision}`, role, day: first === last ? first : `${first} – ${last}`, groups: batch });
        }
        batch = []; chars = 0;
      };
      for (const g of list) {
        const length = memoryBatchContent([g]).length;
        if (batch.length && (batch.length >= MEMORY_BATCH_MAX_FACTS || chars + 1 + length > MEMORY_BATCH_MAX_CHARS)) flush();
        chars += (batch.length ? 1 : 0) + length; batch.push(g);
      }
      flush();
    }
  }
  return out;
}
