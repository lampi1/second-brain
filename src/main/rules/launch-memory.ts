// Bounded task-relevant facts for AgentPackFlows. Launch selection never changes the searchable memory archive.
// Confirmed facts and proposed ones not tied to one case (ADR 0150) are quoted evidence, not policy; role instructions and permission enforcement stay outside this view.
import { memoryConflicts, memoryWords, scopedMemory, type MemoryRecord, type MemoryScope } from './memory-records';
import { memoryWorth, sameMemoryFact } from './memory-worth';

const STOP = new Set('the and for with from this that then into your task please review check help need want use using should about have has are was were will can could would all our not una uno per con del della delle degli nel nella alla che come prima dopo questo questa sono fare usa usare verifica controlla'.split(' '));
const words = (s: string): Set<string> => new Set([...memoryWords(s)].filter(w => !STOP.has(w)));
export const LAUNCH_MEMORY_TOKENS = 1200;
export const LAUNCH_MEMORY_RECORDS = 8;
export type LaunchMemoryContext = Omit<MemoryScope, 'roleId'> & { query?: string };
export interface LaunchMemory { text: string; selected: number; omitted: number; estimatedTokens: number }

/** Keep each fact and its provenance whole: truncating a condition or negation can change its meaning. */
function quoteLaunchMemory(r: MemoryRecord): string {
  return JSON.stringify({ id: r.memoryId, status: r.status, scope: r.scope, subject: r.subject, predicate: r.predicate,
    value: r.value, sourceEventId: r.sourceEventId, sourceRunId: r.sourceRunId, observedAt: r.observedAt,
    ...(r.verification ? { verification: { sourceEventId: r.verification.sourceEventId, sourceRunId: r.verification.sourceRunId, evidence: r.verification.evidence } } : {}) });
}

/** No model calls or fallback to the entire archive. Missing task context loads no facts; recall stays available.
 *  Scope and current confirmation are filtered before scoring. Every fact, including confirmed/security-related
 *  ones, shares the same hard budget. Actual policy is supplied by the host's rules and role instructions. */
export function selectLaunchMemory(root: string, scope: MemoryScope, query = '', budgetTokens = LAUNCH_MEMORY_TOKENS): LaunchMemory {
  const rows = scopedMemory(root, scope), q = words(query.slice(0, 16000));
  // facts need no approval (ADR 0150): a proposed one that is not tied to one case, contradicts, replaces or repeats no
  // confirmed one and was not taken back by the user's Annulla counts too, until maintenance saves it
  const confirmed = rows.filter(r => r.status === 'confirmed');
  const waiting = (r: MemoryRecord) => r.status === 'proposed' && !memoryWorth(r.subject, r.predicate, r.value).specific && !memoryConflicts(rows, r).length
    && !r.transitions?.at(-1)?.reason?.endsWith(':undone') && !confirmed.some(c => c.memoryId === r.supersedes || sameMemoryFact(c, r));
  const candidates = rows.filter(r => r.status === 'confirmed' || waiting(r))
    .map(r => ({ r, words: words(`${r.subject} ${r.predicate} ${r.value}`) }));
  const frequencies = new Map([...q].map(word => [word, candidates.filter(row => row.words.has(word)).length]));
  const ranked = candidates.map(row => ({ r: row.r, score: [...q].reduce((sum, word) => sum + (row.words.has(word)
    ? Math.log(1 + candidates.length / (frequencies.get(word) ?? 1)) : 0), 0) }))
    .filter(row => row.score > 0).sort((a, b) => b.score - a.score || Number(b.r.status === 'confirmed') - Number(a.r.status === 'confirmed') || b.r.observedAt.localeCompare(a.r.observedAt) || a.r.memoryId.localeCompare(b.r.memoryId));
  // Character-based token estimate, consistent with scoped recall. Non-finite budgets fail closed, never unbounded.
  let left = Number.isFinite(budgetTokens) ? Math.max(0, Math.min(Math.floor(budgetTokens), LAUNCH_MEMORY_TOKENS)) * 3 : 0;
  const chosen: string[] = [];
  for (const { r } of ranked) {
    if (chosen.length === LAUNCH_MEMORY_RECORDS) break;
    const text = quoteLaunchMemory(r), cost = text.length + (chosen.length ? 1 : 0);
    if (cost > left) continue;
    chosen.push(text); left -= cost;
  }
  const text = chosen.join('\n');
  return { text, selected: chosen.length, omitted: rows.length - chosen.length, estimatedTokens: Math.ceil(text.length / 3) };
}
