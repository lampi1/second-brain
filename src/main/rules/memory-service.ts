// Host-owned memory review and scoped hybrid retrieval. UI actions confirm/revoke/delete; model tools only propose/read.
// Reuses the existing local embedding provider, retaining no text/vector cache or extra searchable document copies.
import { acknowledgeMemoryInvalidations, pendingMemoryInvalidations, queueMemoryInvalidation } from './memory-invalidations';
import { randomUUID } from 'node:crypto';
import { budgetMemory, confirmMemory, deleteMemory, memoryAt, memoryWords, quoteMemory, readMemoryRecords, recallMemory, retractMemory, scopedMemory, type MemoryRecord, type MemoryScope } from './memory-records';

export interface MemoryServiceDeps {
  root(): string | null;
  embed?(texts: string[], mode: 'query' | 'passage'): Promise<Float32Array[] | null>;
  /** Await index invalidation before acknowledging a destructive review action. */
  invalidate?(paths: string[]): Promise<void>;
}
export interface MemoryRecallOptions { asOf?: string; budgetTokens?: number }
export class MemoryService {
  constructor(private deps: MemoryServiceDeps) {}
  private root(): string { const root = this.deps.root(); if (!root) throw new Error('Choose a brain first.'); return root; }
  list(scope?: MemoryScope, asOf?: string): MemoryRecord[] {
    const root = this.root();
    if (scope) return scopedMemory(root, scope, asOf);
    return readMemoryRecords(root).flatMap(r => { const visible = asOf ? memoryAt(r, asOf) : r; return visible ? [visible] : []; });
  }
  hasPendingInvalidations(): boolean { const root = this.deps.root(); return !!root && pendingMemoryInvalidations(root).length > 0; }
  /** Generic search must await this before reading its index; failure intentionally keeps its gate closed. */
  async retryInvalidations(): Promise<void> {
    const root = this.deps.root();
    if (!root) return;
    while (true) {
      const pending = pendingMemoryInvalidations(root);
      if (!pending.length) return;
      if (this.deps.root() !== root) throw new Error('Brain changed during memory invalidation.');
      await this.deps.invalidate?.([...new Set(pending.flatMap(e => e.paths))]);
      if (this.deps.root() !== root) throw new Error('Brain changed during memory invalidation.');
      acknowledgeMemoryInvalidations(root, pending.map(e => e.id));
    }
  }
  private affected(root: string, id: string): string[] {
    const record = readMemoryRecords(root).find(r => r.memoryId === id);
    return ['memory/records.json', ...(record ? [`agents/${record.scope.roleId}/memory.md`, 'memory/shared.md', ...(record.derivedFiles ?? [])] : [])];
  }
  async confirm(id: string, evidence: string): Promise<MemoryRecord> {
    const root = this.root();
    // This method is reachable only through the authenticated desktop UI. No assertion from a model can invoke it.
    const previous = readMemoryRecords(root).find(r => r.memoryId === id)?.supersedes;
    const old = previous ? readMemoryRecords(root).find(r => r.memoryId === previous) : undefined;
    const paths = ['memory/records.json', ...(old ? [`agents/${old.scope.roleId}/memory.md`, 'memory/shared.md', ...(old.derivedFiles ?? [])] : [])];
    queueMemoryInvalidation(root, paths);
    const r = confirmMemory(root, id, { sourceEventId: `human-review:${randomUUID()}`, sourceRunId: `human:${randomUUID()}`, evidence });
    await this.retryInvalidations();
    return r;
  }
  async retract(id: string, reason: string): Promise<MemoryRecord> {
    const root = this.root(); queueMemoryInvalidation(root, this.affected(root, id));
    const result = retractMemory(root, id, reason);
    await this.retryInvalidations(); return result.record;
  }
  async delete(id: string): Promise<void> {
    const root = this.root(); queueMemoryInvalidation(root, this.affected(root, id));
    deleteMemory(root, id); await this.retryInvalidations();
  }
  async recall(scope: MemoryScope, query: string, options: MemoryRecallOptions = {}): Promise<string> {
    const root = this.root(), rows = scopedMemory(root, scope, options.asOf);
    if (!query.trim() || !this.deps.embed || !rows.length) return recallMemory(root, scope, query, options.budgetTokens, options.asOf);
    const q = memoryWords(query), corpus = rows.map(r => ({ id: r.memoryId, words: memoryWords(`${r.subject} ${r.predicate} ${r.value}`) }));
    const averageLength = corpus.reduce((sum, doc) => sum + doc.words.size, 0) / corpus.length || 1;
    const frequencies = new Map([...q].map(word => [word, corpus.filter(doc => doc.words.has(word)).length]));
    // BM25 with binary term frequency over the already scope-filtered corpus; semantic ranks use the same candidates.
    const lexical = corpus.map(doc => ({ id: doc.id, score: [...q].reduce((score, word) => {
      if (!doc.words.has(word)) return score;
      const frequency = frequencies.get(word) ?? 0;
      const idf = Math.log(1 + (corpus.length - frequency + 0.5) / (frequency + 0.5));
      return score + idf * 2.2 / (1 + 1.2 * (0.25 + 0.75 * doc.words.size / averageLength));
    }, 0) })).filter(r => r.score > 0).sort((a, b) => b.score - a.score);
    const fused = new Map<string, number>();
    lexical.forEach((r, i) => fused.set(r.id, 1 / (61 + i)));
    try {
      const [queryVectors, passages] = await Promise.all([this.deps.embed([query], 'query'), this.deps.embed(rows.map(r => `${r.subject}: ${r.predicate}: ${r.value}`), 'passage')]);
      const v = queryVectors?.[0];
      if (v && passages?.length === rows.length) {
        rows.map((r, i) => ({ id: r.memoryId, score: cosine(v, passages[i]!) })).filter(r => r.score >= 0.8).sort((a, b) => b.score - a.score).forEach((r, i) => fused.set(r.id, (fused.get(r.id) ?? 0) + 1 / (61 + i)));
      }
    } catch { /* local model unavailable: lexical recall remains usable */ }
    // Re-read after awaits: deletion/revocation while embeddings ran must never resurrect a stale snapshot.
    if (this.deps.root() !== root) return '';
    const current = scopedMemory(root, scope, options.asOf).filter(r => fused.has(r.memoryId));
    current.sort((a, b) => fused.get(b.memoryId)! - fused.get(a.memoryId)! || Number(b.status === 'confirmed') - Number(a.status === 'confirmed') || b.observedAt.localeCompare(a.observedAt));
    return budgetMemory(current.map(quoteMemory), options.budgetTokens);
  }
}
function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; aa += a[i]! ** 2; bb += b[i]! ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}
