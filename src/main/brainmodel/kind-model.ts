// The kind-of-work classifier by examples, the service (ADR 0197): reads the user's ended runs with a verified outcome
// (standing.ts earnedVerdict: his verdict, a review's, the receipts', a verified parent's), labels each by the word
// rule (task-estimate.ts kindOfRun = taskOf on the request), embeds its request with the local e5 model the search
// already runs (search/hybrid, ADR 0068; zero tokens), and trains and tests the nearest-centroid classifier
// (kind-centroids.ts). CPU stays low: nothing runs until the Classificatori page asks, the embeddings are cached by run
// id (a run's goal is frozen at its end), at most MAX_EXAMPLES newest runs, in batches of BATCH with a pause between
// (the embedding itself runs in the search worker thread). One computation at a time; its card is kept for CARD_TTL_MS
// or until the runs change. `classify` answers with the classifier when it is trained, the word rule otherwise (no
// model, too few examples). The chats' kinds still come from the word rule: promoting this classifier is the owner's
// call once the card shows it agrees. Used by brainmodel/service.ts (classifiers) and wired in wiring.ts.
import type { AgentRun } from '../../shared/agents';
import type { KindModelCard } from '../../shared/brain-model';
import { taskOf } from '../../shared/work-concepts';
import { counts, earnIndex, earnedVerdict } from '../agents/standing';
import { kindOfRun, requestText } from '../agents/task-estimate';
import { MIN_PER_KIND, predict, trainAndTest, type Example } from './kind-centroids';
import { log, errText } from '../log';

export const MAX_EXAMPLES = 600;
const BATCH = 16;
const PAUSE_MS = 50;
const CARD_TTL_MS = 10 * 60e3;
const CACHE_MAX = 2000;

export interface KindModelDeps {
  runs: () => readonly AgentRun[];
  /** L2-normalised vectors in e5 query mode (the embedder adds the prefix), null without the model (HybridSearch.embed) */
  embed: (texts: string[]) => Promise<Float32Array[] | null>;
  /** the local model is downloaded and loaded */
  ready: () => boolean;
  now?: () => number;
  pause?: (ms: number) => Promise<void>;
}

/** The runs it learns from: ended, counted, not a review or a one-shot, with a request and a verified outcome; newest first. */
export function labelled(runs: readonly AgentRun[]): { run: AgentRun; text: string; kind: string }[] {
  const ix = earnIndex(runs);
  return runs.filter(r => counts(r) && !r.reviewOf && !r.oneshot && r.source !== 'oneshot' && r.agentId !== 'orchestrator' && earnedVerdict(r, ix) !== null)
    .map(run => ({ run, text: requestText(run.goal).trim().slice(0, 1000), kind: kindOfRun(run) as string }))
    .filter(x => x.text && x.kind !== 'orchestrator')
    .sort((a, b) => (b.run.endedAt ?? 0) - (a.run.endedAt ?? 0)).slice(0, MAX_EXAMPLES);
}

const perKind = (xs: readonly { kind: string }[]): KindModelCard['perKind'] =>
  [...xs.reduce((m, x) => m.set(x.kind, (m.get(x.kind) ?? 0) + 1), new Map<string, number>())].map(([kind, n]) => ({ kind, n })).sort((a, b) => b.n - a.n || a.kind.localeCompare(b.kind));

export class KindModel {
  private vecs = new Map<string, Float32Array>();
  private card: KindModelCard | null = null;
  private cardKey = '';
  private model: { centroids: Map<string, Float32Array>; threshold: number } | null = null;
  private running: Promise<KindModelCard> | null = null;
  private readonly now: () => number;
  private readonly pause: (ms: number) => Promise<void>;
  constructor(private readonly d: KindModelDeps) {
    this.now = d.now ?? Date.now;
    this.pause = d.pause ?? (ms => new Promise(r => { const t = setTimeout(r, ms); t.unref?.(); }));
  }

  /** The card now: a cached one while fresh; else it starts the computation and answers «busy» until it ends (the page
   *  never waits for the embeddings). `wait` = await the computation (tests). */
  async state(wait = false): Promise<KindModelCard> {
    const xs = labelled(this.d.runs());
    const key = `${xs.length}:${xs[0]?.run.runId ?? ''}`;
    const base = { examples: xs.length, perKind: perKind(xs), minPerKind: MIN_PER_KIND, at: this.now() };
    if (!this.d.ready()) return { ...base, state: 'no-model', kinds: [], threshold: null, test: null, altroProposed: null };
    if (this.card && this.cardKey === key && this.now() - this.card.at < CARD_TTL_MS) return this.card;
    if (!this.running) {
      this.running = this.compute(xs, key).catch(e => {
        log.warn('classifiers', 'kind model not trained', { cause: errText(e), hint: 'the word rule keeps deciding; reopen Classificatori to retry' });
        return { ...base, state: 'few' as const, kinds: [], threshold: null, test: null, altroProposed: null };
      }).finally(() => { this.running = null; });
    }
    if (wait) return this.running;
    return this.card && this.cardKey === key ? this.card : { ...base, state: 'busy', kinds: [], threshold: null, test: null, altroProposed: null };
  }

  private async compute(xs: ReturnType<typeof labelled>, key: string): Promise<KindModelCard> {
    const missing = xs.filter(x => !this.vecs.has(x.run.runId));
    for (let i = 0; i < missing.length; i += BATCH) {
      const part = missing.slice(i, i + BATCH);
      const vs = await this.d.embed(part.map(x => x.text));
      if (!vs) throw new Error('the local model answered no vectors');
      part.forEach((x, k) => { if (vs[k]) this.vecs.set(x.run.runId, vs[k]!); });
      if (i + BATCH < missing.length) await this.pause(PAUSE_MS);
    }
    if (this.vecs.size > CACHE_MAX) { const keep = new Set(xs.map(x => x.run.runId)); for (const k of [...this.vecs.keys()]) if (!keep.has(k)) this.vecs.delete(k); }
    const examples: Example[] = xs.flatMap(x => { const vec = this.vecs.get(x.run.runId); return vec ? [{ id: x.run.runId, kind: x.kind, vec }] : []; });
    const r = trainAndTest(examples);
    const base = { examples: xs.length, perKind: perKind(xs), minPerKind: MIN_PER_KIND, at: this.now() };
    this.model = r ? { centroids: r.centroids, threshold: r.threshold } : null;
    this.card = r ? { ...base, state: 'ready', kinds: [...r.centroids.keys()].sort(), threshold: r.threshold,
      test: { n: r.test.n, agree: r.test.agree, labels: r.test.labels, matrix: r.test.matrix }, altroProposed: r.test.altroProposed }
      : { ...base, state: 'few', kinds: [], threshold: null, test: null, altroProposed: null };
    this.cardKey = key;
    return this.card;
  }

  /** A request's kind: the classifier when trained and the model ready, else the word rule (no brain rules). */
  async classify(text: string): Promise<{ kind: string; by: 'examples' | 'words' }> {
    const words = { kind: taskOf('', requestText(text), undefined) as string, by: 'words' as const };
    if (!this.model || !this.d.ready()) return words;
    try {
      const v = (await this.d.embed([requestText(text).slice(0, 1000)]))?.[0];
      return v ? { kind: predict(v, this.model.centroids, this.model.threshold), by: 'examples' } : words;
    } catch { return words; }
  }
}
