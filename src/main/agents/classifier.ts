// Local advisory agent matching for discovery and the start dialog. Reuses hybrid-search embeddings; never launches
// or creates an agent. Private instructions and past goals stay in main; explanations expose only field/run IDs.
import { createHash } from 'node:crypto';
import type { AgentProfile, AgentRun } from '../../shared/agents';
import type { AgentCandidate, AgentClassification } from '../../shared/agent-classifier';
import { cosine, type HybridSearch } from '../search/hybrid/service';

type Embeddings = Pick<HybridSearch, 'status' | 'embed'>;
type Row = { id: string; text: string; why: AgentCandidate['why'] };
export const CLASSIFIER_THRESHOLD = 60;
const CACHE_MAX = 6000;
const words = (s: string): string[] => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').match(/[\p{L}\p{N}]+/gu) ?? [];
export function classifierRequest(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) throw Error('agent classifier: request must contain 1–2000 characters.');
  return value.trim();
}

/** BM25 with query coverage: an isolated common word cannot become a strong match through rank normalization. */
function lexical(request: string, rows: Row[]): number[] {
  const query = [...new Set(words(request))], docs = rows.map(r => words(r.text));
  const avg = docs.reduce((s, d) => s + d.length, 0) / Math.max(1, docs.length) || 1;
  const idf = query.map(w => Math.log(1 + (docs.length - docs.filter(d => d.includes(w)).length + 0.5) / (docs.filter(d => d.includes(w)).length + 0.5)));
  return docs.map(d => {
    let sum = 0, covered = 0;
    query.forEach((w, i) => {
      const tf = d.filter(t => t === w).length;
      if (tf) covered++;
      sum += idf[i]! * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * d.length / avg));
    });
    const coverage = covered / Math.max(1, query.length);
    return coverage * (0.8 + 0.2 * sum / (sum + 1));
  });
}

export class AgentClassifier {
  private cache = new Map<string, Float32Array>();
  constructor(private embeddings?: Embeddings) {}

  private async vectors(texts: string[], mode: 'query' | 'passage'): Promise<Float32Array[]> {
    const key = (t: string) => createHash('sha256').update(`${mode}:${t}`).digest('hex');
    const got = new Map<string, Float32Array>();
    const missing = [...new Set(texts)].filter(t => { const v = this.cache.get(key(t)); if (v) got.set(t, v); return !v; });
    for (let i = 0; i < missing.length; i += 16) {
      const batch = missing.slice(i, i + 16), vs = await this.embeddings!.embed(batch, mode);
      if (!vs || vs.length !== batch.length || vs.some(v => !v.length || !v.every(Number.isFinite))) throw Error('embeddings unavailable');
      batch.forEach((t, j) => {
        if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
        got.set(t, vs[j]!); this.cache.set(key(t), vs[j]!);
      });
    }
    return texts.map(t => got.get(t)!);
  }

  async classify(request: string, profiles: AgentProfile[], runs: AgentRun[]): Promise<AgentClassification> {
    request = classifierRequest(request);
    const rows: Row[] = [];
    for (const p of profiles.filter(p => p.status === 'active')) {
      const fields = { name: p.name, whenToUse: p.manifest?.whenToUse, purpose: p.purpose, instructions: p.instructions.slice(0, 2000) };
      for (const [field, text] of Object.entries(fields)) if (text?.trim()) rows.push({ id: p.id, text, why: { field: field as AgentCandidate['why']['field'] } });
      // Only ended, successful runs of the active definition; a known failure overrides a completed marker.
      const past = runs.filter(r => r.agentId === p.id && r.version === p.activeVersion && r.endedAt !== undefined && r.outcome?.verdict !== 'fail' && r.outcome?.verdict !== 'partial'
        && (r.endReason === 'completed' || (r.report?.ok && r.report.outcome === 'done' && r.report.verified === 'yes')
          || (r.outcome?.verdict === 'success' && ['human', 'reviewed-evidence'].includes(r.outcome.basis))))
        .sort((a, b) => b.endedAt! - a.endedAt!).slice(0, 20);
      for (const r of past) if (r.goal.trim()) rows.push({ id: p.id, text: r.goal, why: { field: 'pastRun', runId: r.runId } });
    }
    const scores = lexical(request, rows);
    let mode: AgentClassification['mode'] = 'words';
    if (rows.length && this.embeddings?.status().model.state === 'ready') {
      try {
        const [q] = await this.vectors([request], 'query'), vectors = await this.vectors(rows.map(r => r.text), 'passage');
        vectors.forEach(v => {
          if (v.length !== q!.length) throw Error('incompatible vectors');
        });
        vectors.forEach((v, i) => { scores[i] = Math.max(scores[i]!, Math.max(0, Math.min(1, (cosine(q!, v) - 0.65) / 0.35))); });
        mode = 'hybrid';
      } catch { /* A missing/crashed model must leave the entire ranking on words, retried next request. */ }
    }
    const best = new Map<string, AgentCandidate>();
    rows.forEach((r, i) => {
      const score = Math.round(100 * scores[i]!);
      if (!best.has(r.id) || score > best.get(r.id)!.score) best.set(r.id, { id: r.id, score, why: r.why });
    });
    const candidates = [...best.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const noneCloseEnough = !candidates.length || candidates[0]!.score < CLASSIFIER_THRESHOLD;
    return { candidates, mode, threshold: CLASSIFIER_THRESHOLD, noneCloseEnough, proposal: noneCloseEnough ? 'ask-user-to-create' : null };
  }
}
