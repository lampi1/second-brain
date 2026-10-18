// Local advisory agent matching for discovery and the start dialog. Reuses hybrid-search embeddings; never launches
// or creates an agent. Private instructions and past goals stay in main; explanations expose only field/run IDs.
import { createHash } from 'node:crypto';
import type { AgentProfile, AgentRun } from '../../shared/agents';
import { DEFAULT_CLASSIFIER_THRESHOLDS, type AgentCandidate, type AgentClassification, type ClassifierMode } from '../../shared/agent-classifier';
import { cosine, type HybridSearch } from '../search/hybrid/service';
import { conceptOf } from '../../shared/work-concepts';
import { PRESET_PREAMBLE } from '../../shared/agent-presets';

type Embeddings = Pick<HybridSearch, 'status' | 'embed'>;
type Row = { id: string; text: string; why: AgentCandidate['why'] };
/** The hybrid channel's starting threshold (kept for callers that name one number). */
export const CLASSIFIER_THRESHOLD = DEFAULT_CLASSIFIER_THRESHOLDS.hybrid;
const CACHE_MAX = 6000;
const BATCH = 16;
const FULL_COVERAGE = 4;
/** Field weights of the words channel: a match only in the long instructions (which mention many kinds of work in
 *  passing, "never write to production") counts less than one in the name, purpose or "when to use". Each field is
 *  its own row here, so the weight scales the row's score; BM25F (Robertson, Zaragoza & Taylor, CIKM 2004) weighs the
 *  word counts before saturation instead, which would need the fields merged into one document. */
const FIELD_WEIGHT: Partial<Record<AgentCandidate['why']['field'], number>> = { instructions: 0.75 };
/** How long a request waits for the local model before answering with words only (the start dialog and agent_catalog
 *  stay responsive while the worker is busy indexing or the vectors are still being built). */
export const SEMANTIC_DEADLINE_MS = 2500;
// Italian and English function words and request fillers (accents folded): they carry no topic, so a request made only
// of them ("il") scores 0 instead of matching every agent whose text contains them.
const STOPWORDS = new Set(`il lo la i gli le un uno una di a da in con su per tra fra del dello della dei degli delle al allo alla ai agli alle
dal dallo dalla dai dagli dalle nel nello nella nei negli nelle sul sullo sulla sui sugli sulle col coi e ed o od ma pero che chi cui non ne ci
si mi ti vi me te tu io se sia siano lui lei noi voi loro e sono sei siamo siete era erano essere stato ho hai ha abbiamo avete hanno questo questa questi queste
quello quella quelli quelle mio mia miei mie tuo tua suo sua nostro nostra vostro come dove quando perche anche piu molto poco tutto tutti tutte
cosa qualcosa fare fai fa puoi puo posso potresti voglio vorrei bisogno favore grazie aiutami fammi ciao gia ancora solo sempre poi dopo prima
the an of to on at for with by from and or but is are was were be been being it its this that these those you we they my your our their can
could would should please do does did have has had what how why when where which who whom will shall just not no so as if into about than then
there here also very some any all me him her them us i`.split(/\s+/));
/** A light Italian/English stem: plural -s/-es, then one final vowel ("lente"/"lento" → "lent", "articolo"/"articoli" →
 *  "articol", "query"/"queries" → "quer"). Short words are kept whole. */
const stem = (w: string): string => {
  if (w.length > 4 && /[^s]s$/.test(w)) w = w.endsWith('ies') ? w.slice(0, -2) : w.endsWith('es') && w.length > 5 ? w.slice(0, -2) : w.slice(0, -1);
  return w.length >= 5 ? w.replace(/[aeiouy]$/, '') : w;
};
/** Topic words: folded case and accents, no stopwords or single characters, stemmed. A word of a bilingual work concept
 *  (shared/work-concepts.ts) becomes that concept's token, so "correggi" in a request meets "fix" in an English
 *  description; "perché"/"why" and "quando" count there even though they are stopwords elsewhere. */
const words = (s: string): string[] => (s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').match(/[\p{L}\p{N}]+/gu) ?? [])
  .flatMap(w => { const c = conceptOf(w); return c ? [`#${c}`] : w.length > 1 && !STOPWORDS.has(w) ? [stem(w)] : []; });
/** Same stem, or one stem (at least 4 letters) begins the other: "scriv" ~ "scriver", "lent" ~ "lentezz". */
const same = (q: string, t: string): boolean => q === t || (q[0] !== '#' && t[0] !== '#' && Math.min(q.length, t.length) >= 4 && (t.startsWith(q) || q.startsWith(t)));
export function classifierRequest(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) throw Error('agent classifier: request must contain 1–2000 characters.');
  return value.trim();
}

/** BM25 with query coverage: an isolated common word cannot become a strong match through rank normalization. A request
 *  with no topic words (only stopwords) scores 0 everywhere. Coverage counts distinct request topic words found. */
function lexical(request: string, rows: Row[]): number[] {
  const query = [...new Set(words(request))], docs = rows.map(r => words(r.text));
  if (!query.length) return rows.map(() => 0);
  const avg = docs.reduce((s, d) => s + d.length, 0) / Math.max(1, docs.length) || 1;
  const idf = query.map(w => { const n = docs.filter(d => d.some(t => same(w, t))).length; return Math.log(1 + (docs.length - n + 0.5) / (n + 0.5)); });
  return docs.map(d => {
    let sum = 0, covered = 0;
    query.forEach((w, i) => {
      const tf = d.filter(t => same(w, t)).length;
      if (tf) covered++;
      sum += idf[i]! * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * d.length / avg));
    });
    // Softened for long requests: four distinct matched topic words are full coverage, whatever the request's length.
    const coverage = Math.min(1, covered / Math.min(query.length, FULL_COVERAGE));
    return coverage * (0.8 + 0.2 * sum / (sum + 1));
  }).map((v, i) => v * (FIELD_WEIGHT[rows[i]!.why.field] ?? 1));
}

export class AgentClassifier {
  private cache = new Map<string, Float32Array>();
  private pending = new Map<string, Promise<Float32Array>>();
  /** `embeddings` is the app's one HybridSearch (its warm worker and model); absent = words only. `thresholds` = the
   *  "close enough" line per channel in force (the user's approved calibration, classifier-calibration.ts). */
  constructor(private embeddings?: Embeddings, private deadlineMs = SEMANTIC_DEADLINE_MS,
    private thresholds: () => Readonly<Record<ClassifierMode, number>> = () => DEFAULT_CLASSIFIER_THRESHOLDS) {}

  /** Vectors by text and mode, from the cache, from an embedding already under way (two callers share it), or embedded
   *  BATCH at a time, one batch after the other: each worker call has its own timeout from the moment it is posted, so a
   *  long burst must not be queued at once. */
  private vectors(texts: string[], mode: 'query' | 'passage'): Promise<Float32Array[]> {
    const key = (t: string) => createHash('sha256').update(`${mode}:${t}`).digest('hex');
    const got = new Map<string, Float32Array | Promise<Float32Array>>();
    const missing: string[] = [];
    for (const t of new Set(texts)) {
      const v = this.cache.get(key(t)) ?? this.pending.get(key(t));
      if (v) got.set(t, v); else missing.push(t);
    }
    let previous: Promise<unknown> = Promise.resolve();
    for (let i = 0; i < missing.length; i += BATCH) {
      const batch = missing.slice(i, i + BATCH);
      const done = previous.then(() => this.embeddings!.embed(batch, mode)).then(vs => {
        if (!vs || vs.length !== batch.length || vs.some(v => !v.length || !v.every(Number.isFinite))) throw Error('embeddings unavailable');
        return vs;
      });
      previous = done;
      batch.forEach((t, j) => {
        const k = key(t);
        const one = done.then(vs => {
          if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
          this.cache.set(k, vs[j]!);
          return vs[j]!;
        }).finally(() => { if (this.pending.get(k) === one) this.pending.delete(k); });
        one.catch(() => { /* reported to every waiting caller; nothing cached, retried on the next request */ });
        this.pending.set(k, one); got.set(t, one);
      });
    }
    return Promise.all(texts.map(t => got.get(t)!));
  }

  /** The semantic channel, or null (words only) when it fails or misses the deadline. A late embedding still fills the
   *  cache in the background, so the next request is fast; it is never queued twice (pending is shared). */
  private async semantic(request: string, rows: Row[]): Promise<number[] | null> {
    const work = (async () => {
      const [[q], vectors] = await Promise.all([this.vectors([request], 'query'), this.vectors(rows.map(r => r.text), 'passage')]);
      if (vectors.some(v => v.length !== q!.length)) throw Error('incompatible vectors');
      return vectors.map(v => Math.max(0, Math.min(1, (cosine(q!, v) - 0.65) / 0.35)));
    })().catch(() => null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([work, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), this.deadlineMs); })]);
    } finally { clearTimeout(timer); }
  }

  async classify(request: string, profiles: AgentProfile[], runs: AgentRun[]): Promise<AgentClassification> {
    request = classifierRequest(request);
    const rows: Row[] = [];
    // Only what discovery offers: active and routable (the dashboard's internal agent is never a delegate).
    for (const p of profiles.filter(p => p.status === 'active' && p.routable !== false)) {
      // The packaged agents' shared preamble (house rules, run-report format) says nothing about the job: left out, it no
      // longer makes every agent's instructions look alike to both channels.
      const fields = { name: p.name, whenToUse: p.manifest?.whenToUse, purpose: p.purpose, instructions: p.instructions.replace(PRESET_PREAMBLE, '').trim().slice(0, 2000) };
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
      // A missing/crashed/slow model leaves the entire ranking on words, retried on the next request.
      const semantic = await this.semantic(request, rows);
      if (semantic) { semantic.forEach((v, i) => { scores[i] = Math.max(scores[i]!, v); }); mode = 'hybrid'; }
    }
    const best = new Map<string, AgentCandidate>();
    rows.forEach((r, i) => {
      const score = Math.round(100 * scores[i]!);
      if (!best.has(r.id) || score > best.get(r.id)!.score) best.set(r.id, { id: r.id, score, why: r.why });
    });
    const candidates = [...best.values()].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    // each channel has its own scale, so its own line: words scores are lower (four matched topic words are full marks)
    const threshold = this.thresholds()[mode];
    const noneCloseEnough = !candidates.length || candidates[0]!.score < threshold;
    return { candidates, mode, threshold, noneCloseEnough, proposal: noneCloseEnough ? 'ask-user-to-create' : null };
  }
}

/** Words-only ranking over a catalog snapshot, for the demo and any wiring without the local model. */
export const classifyByWords = (request: string, profiles: AgentProfile[]): Promise<AgentClassification> => new AgentClassifier().classify(request, profiles, []);
