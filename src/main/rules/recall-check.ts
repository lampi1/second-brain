// How well the launch memory finds the right fact (ADR 0235; owner, 2026-11-09: «misurare la memoria prima di cambiare
// tecnologia»). Why: a role's launch loads at most LAUNCH_MEMORY_RECORDS facts ranked by shared words only
// (launch-memory.ts rankByWords), so a goal written in other words or in another language than the fact may miss it;
// nobody had measured how often. The test needs no labels and spends no tokens: every launchable fact that a recorded
// run wrote (its sourceRunId) is a case, that run's goal is the question, and the fact counts as found when it is among
// the first K facts of its own scope. Two rankings are compared on the same cases: the launch's words, and words fused
// with the meaning (local e5 vectors, cosine ≥ MEANING_MIN, reciprocal rank k = 60, the same as memory_recall in
// memory-service.ts). The cases are optimistic for words (a fact is often written with the words of its own task), and
// the card says so. Read-only: nothing is written, the launch is unchanged. The pure part is `evaluateRecall`; the
// service `RecallCheck` reads the memory and the runs, embeds at low pace in the search worker and caches the vectors.
// Used by wiring.ts (services.recallCheck) and 'memory:recallCheck'; shown by MemoryInsights.tsx (Memoria → Statistiche).
// Tests: test/unit/recall-check.test.ts.
import { createHash } from 'node:crypto';
import type { AgentRun } from '../../shared/agents';
import type { MemoryRecallCard } from '../../shared/brain-model';
import { errText, log } from '../log';
import { requestText } from '../agents/task-estimate';
import { LAUNCH_MEMORY_RECORDS, launchCandidates, rankByWords } from './launch-memory';
import { readMemoryRecords, memoryAt, type MemoryRecord } from './memory-records';

/** Below this many cases the card says «too few» instead of a percentage. */
export const MIN_CASES = 5;
/** The cosine a fact needs to count as near in meaning (as memory_recall). */
export const MEANING_MIN = 0.8;
const RRF_K = 60;
const MAX_CASES = 400;
const MISSED_SHOWN = 3;
const BATCH = 16;
const PAUSE_MS = 50;
const CARD_TTL_MS = 10 * 60e3;
const CACHE_MAX = 6000;

export interface RecallCase { fact: MemoryRecord; goal: string; runId: string }
type Vec = Float32Array;

/** The launch's scope equality (memory-records.ts sameScope): an absent field and an empty one differ. */
const scopeKey = (r: MemoryRecord): string => JSON.stringify([r.scope.roleId, r.scope.userId ?? null, r.scope.project ?? null, r.scope.repository ?? null, r.scope.environment ?? null]);
export const factText = (r: Pick<MemoryRecord, 'subject' | 'predicate' | 'value'>): string => `${r.subject}: ${r.predicate}: ${r.value}`;

/** The launchable facts of every scope, and one case per launchable fact written by a recorded run with a goal. */
export function recallCases(records: readonly MemoryRecord[], runs: readonly AgentRun[], asOf?: string): { cases: RecallCase[]; pools: Map<string, MemoryRecord[]> } {
  const visible = records.flatMap(r => { const v = memoryAt(r, asOf); return v ? [v] : []; });
  const byScope = new Map<string, MemoryRecord[]>();
  for (const r of visible) byScope.set(scopeKey(r), [...(byScope.get(scopeKey(r)) ?? []), r]);
  const pools = new Map([...byScope].map(([k, rows]) => [k, launchCandidates(rows)]));
  const goals = new Map(runs.map(run => [run.runId, requestText(run.goal).trim().slice(0, 2000)]));
  const cases = [...pools.values()].flat().flatMap(fact => { const goal = goals.get(fact.sourceRunId); return goal ? [{ fact, goal, runId: fact.sourceRunId }] : []; })
    .sort((a, b) => b.fact.observedAt.localeCompare(a.fact.observedAt)).slice(0, MAX_CASES);
  return { cases, pools };
}

const cosine = (a: Vec, b: Vec): number => {
  if (a.length !== b.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; aa += a[i]! ** 2; bb += b[i]! ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
};

/** The ids of the first `k` facts by words fused with meaning: reciprocal rank of the words' order plus that of the facts
 *  at cosine ≥ MEANING_MIN; ties keep the words' order. Without a goal vector, the words' order alone. */
export function rankHybrid(pool: readonly MemoryRecord[], goal: string, goalVec: Vec | null, vecOf: (r: MemoryRecord) => Vec | null, k = LAUNCH_MEMORY_RECORDS): string[] {
  const words = rankByWords(pool, goal), fused = new Map<string, number>(), order = new Map<string, number>();
  words.forEach(({ r }, i) => { fused.set(r.memoryId, 1 / (RRF_K + 1 + i)); order.set(r.memoryId, i); });
  if (goalVec) {
    pool.flatMap(r => { const v = vecOf(r); const sim = v ? cosine(goalVec, v) : 0; return sim >= MEANING_MIN ? [{ id: r.memoryId, sim }] : []; })
      .sort((a, b) => b.sim - a.sim).forEach((x, i) => fused.set(x.id, (fused.get(x.id) ?? 0) + 1 / (RRF_K + 1 + i)));
  }
  return [...fused].sort((a, b) => b[1] - a[1] || (order.get(a[0]) ?? Infinity) - (order.get(b[0]) ?? Infinity) || a[0].localeCompare(b[0])).slice(0, k).map(([id]) => id);
}

export interface RecallResult {
  n: number; k: number; words: number; hybrid: number;
  /** found with the meaning but not by the words, and the other way round */
  onlyHybrid: number; onlyWords: number;
  missed: { fact: string; goal: string; role: string }[];
}
/** Both rankings on every case. `vecOf` answers a fact's vector, `goalVecOf` a case's goal vector (null = not embedded). */
export function evaluateRecall(cases: readonly RecallCase[], pools: ReadonlyMap<string, readonly MemoryRecord[]>, vecOf: (r: MemoryRecord) => Vec | null, goalVecOf: (c: RecallCase) => Vec | null, k = LAUNCH_MEMORY_RECORDS): RecallResult {
  let words = 0, hybrid = 0, onlyHybrid = 0, onlyWords = 0;
  const missed: RecallResult['missed'] = [];
  for (const c of cases) {
    const pool = pools.get(scopeKey(c.fact)) ?? [];
    const w = rankByWords(pool, c.goal).slice(0, k).some(x => x.r.memoryId === c.fact.memoryId);
    const h = rankHybrid(pool, c.goal, goalVecOf(c), vecOf, k).includes(c.fact.memoryId);
    if (w) words++;
    if (h) hybrid++;
    if (h && !w) { onlyHybrid++; if (missed.length < MISSED_SHOWN) missed.push({ fact: factText(c.fact).slice(0, 300), goal: c.goal.slice(0, 300), role: c.fact.scope.roleId }); }
    if (w && !h) onlyWords++;
  }
  return { n: cases.length, k, words, hybrid, onlyHybrid, onlyWords, missed };
}

export interface RecallCheckDeps {
  /** the brain folder, null without one */
  root: () => string | null;
  runs: () => readonly AgentRun[];
  /** L2-normalised e5 vectors (the embedder adds the prefix), null without the model (HybridSearch.embed) */
  embed: (texts: string[], mode: 'query' | 'passage') => Promise<Float32Array[] | null>;
  /** the local model is downloaded and loaded */
  ready: () => boolean;
  now?: () => number;
  pause?: (ms: number) => Promise<void>;
}

const hash = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 24);

/** The card for Memoria → Statistiche: computed when the tab asks, «busy» while it embeds, kept for CARD_TTL_MS or until
 *  the facts or the runs change. One computation at a time. */
export class RecallCheck {
  private vecs = new Map<string, Vec>();
  private card: MemoryRecallCard | null = null;
  private cardKey = '';
  private running: Promise<MemoryRecallCard> | null = null;
  private readonly now: () => number;
  private readonly pause: (ms: number) => Promise<void>;
  constructor(private readonly d: RecallCheckDeps) {
    this.now = d.now ?? Date.now;
    this.pause = d.pause ?? (ms => new Promise(r => { const t = setTimeout(r, ms); t.unref?.(); }));
  }

  /** `wait` = await the computation (tests). */
  async state(wait = false): Promise<MemoryRecallCard> {
    const root = this.d.root();
    const empty = (state: MemoryRecallCard['state'], n = 0): MemoryRecallCard => ({ state, at: this.now(), n, k: LAUNCH_MEMORY_RECORDS, minCases: MIN_CASES, words: null, hybrid: null, onlyHybrid: 0, onlyWords: 0, missed: [] });
    if (!root) return empty('few');
    let input: ReturnType<typeof recallCases>;
    try { input = recallCases(readMemoryRecords(root), this.d.runs()); } catch (e) {
      log.warn('memory', 'recall check: the memory store cannot be read', { cause: errText(e), hint: 'open Memoria → Approvate to see the facts; the launch memory is unchanged' });
      return empty('few');
    }
    const { cases } = input;
    if (cases.length < MIN_CASES) return empty('few', cases.length);
    // the cases and every fact of their pools: a fact added, retracted or edited in a tested scope changes the rankings
    const pooled = [...new Set(cases.map(c => scopeKey(c.fact)))].flatMap(k => input.pools.get(k) ?? []);
    const key = `${root}:${hash([...cases.map(c => `${c.fact.memoryId}:${hash(c.goal)}`), '#', ...pooled.map(r => `${r.memoryId}:${r.status}:${hash(factText(r))}`)].join('|'))}`;
    if (this.card && this.cardKey === key && this.now() - this.card.at < CARD_TTL_MS) return this.card;
    if (!this.d.ready()) return { ...empty('no-model', cases.length), ...this.wordsOnly(input) };
    if (!this.running) {
      this.running = this.compute(input, key).catch(e => {
        log.warn('memory', 'recall check not computed', { cause: errText(e), hint: 'reopen Memoria → Statistiche later to retry; the launch memory is unchanged' });
        // kept like a result (its TTL, its key), so the page stops asking instead of retrying the model every 5 s
        this.card = { ...empty('no-model', cases.length), ...this.wordsOnly(input) }; this.cardKey = key;
        return this.card;
      }).finally(() => { this.running = null; });
    }
    if (wait) return this.running;
    return this.card && this.cardKey === key ? this.card : { ...empty('busy', cases.length), ...this.wordsOnly(input) };
  }

  /** The words' side alone (it needs no model): shown while the meaning is computed or missing. */
  private wordsOnly(input: ReturnType<typeof recallCases>): Pick<MemoryRecallCard, 'words'> {
    return { words: evaluateRecall(input.cases, input.pools, () => null, () => null).words };
  }

  private async embedMissing(texts: string[], mode: 'query' | 'passage'): Promise<void> {
    const todo = [...new Set(texts)].filter(t => !this.vecs.has(`${mode}:${hash(t)}`));
    for (let i = 0; i < todo.length; i += BATCH) {
      const part = todo.slice(i, i + BATCH), vs = await this.d.embed(part, mode);
      if (!vs) throw new Error('the local model answered no vectors');
      part.forEach((t, j) => { if (vs[j]) this.vecs.set(`${mode}:${hash(t)}`, vs[j]!); });
      if (i + BATCH < todo.length) await this.pause(PAUSE_MS);
    }
  }

  private async compute(input: ReturnType<typeof recallCases>, key: string): Promise<MemoryRecallCard> {
    const facts = [...new Set(input.cases.map(c => scopeKey(c.fact)))].flatMap(k => input.pools.get(k) ?? []);
    if (this.vecs.size > CACHE_MAX) this.vecs.clear();
    await this.embedMissing(input.cases.map(c => c.goal), 'query');
    await this.embedMissing(facts.map(factText), 'passage');
    const r = evaluateRecall(input.cases, input.pools, f => this.vecs.get(`passage:${hash(factText(f))}`) ?? null, c => this.vecs.get(`query:${hash(c.goal)}`) ?? null);
    this.card = { state: 'ready', at: this.now(), n: r.n, k: r.k, minCases: MIN_CASES, words: r.words, hybrid: r.hybrid, onlyHybrid: r.onlyHybrid, onlyWords: r.onlyWords, missed: r.missed };
    this.cardKey = key;
    return this.card;
  }
}
