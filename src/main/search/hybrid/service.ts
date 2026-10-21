// The hybrid search in the main process (SPEC 23): starts the worker (out/main/search-worker.js) on the brain's index
// in userData/search, keeps it in sync with the brain folder (at start, when the folder changes, and a few seconds after
// a file changes: the brain watcher's onFile) and offers one API to the rest of the app: query (/api/search, Ctrl+K, the
// agents' brain_search tool), plus the building blocks of the agent classifier (ui-agents, SPEC 23 a): embed, cosine,
// topK; and the past errors similar to a prompt (recall: SPEC 23 c/d, served to the brain's hook by recall.ts). The model is downloaded once in the background (never blocking the start; progress and retry in the UI); until
// then, or if it fails, results come from BM25 only. A dead worker is restarted on the next call (not within 10 s of
// the last crash: no restart loop), a hung one is terminated when a call times out. Until the brain is indexed, query
// throws, so every caller falls back to its old search. Used by main/index.ts.
import crypto from 'node:crypto';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { errText, log } from '../../log';
import { cosine, type Hit } from './engine';
import { errorEntries, THEME_FILES, themesOf, type ThemeKind, type Themes } from './themes';
import { read } from '../../rules/storage';
import { RECALL_MIN_ERRORS, lexicalErrors, RECALL_K, recallIndex, similarErrors, type Recall, type RecallIndex } from './recall';
import { CorrectionDetector, type Correction } from './corrections';
import type { HybridStatus, WorkerReq } from './protocol';

export interface HybridDeps {
  /** userData/search: the index and the model */
  dir: string;
  brainRoot: () => string | null;
  /** the worker script (out/main/search-worker.js next to the main bundle) */
  workerFile: string;
  /** download the model at start when missing (off in tests and the demo) */
  download: boolean;
  onStatus?: (s: HybridStatus) => void;
}

const SYNC_DELAY_MS = 3000;
const CALL_TIMEOUT_MS = 60_000;
const RESTART_PAUSE_MS = 10_000;
const TEXT_VECS_MAX = 5000; // idea texts embedded for the themes, cleared past this
const EMBED_BATCH = 16;
const ROME_DAY = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' });

export class HybridSearch {
  private worker: Worker | null = null;
  private seq = 0;
  private waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private last: HybridStatus = { model: { state: 'missing' }, docs: 0, chunks: 0, vectors: 0, vec: false };
  private syncTimer: NodeJS.Timeout | null = null;
  private syncedRoot: string | null = null;
  private textVecs = new Map<string, Float32Array>();
  private themeCache = new Map<ThemeKind, { key: string; themes: Themes }>();
  private errorVecs: { key: string; index: RecallIndex } | null = null;
  private warming: Promise<void> | null = null;
  private restartAfter = 0;

  private corrections: CorrectionDetector;
  constructor(private deps: HybridDeps) {
    this.corrections = new CorrectionDetector({
      root: deps.brainRoot,
      ready: () => !!this.syncedRoot && this.syncedRoot === deps.brainRoot() && this.last.model.state === 'ready',
      entries: async () => errorEntries((await this.vectors(`brain:${THEME_FILES.errors}`)).map(r => ({ ...r, at: 0 }))),
      passages: texts => this.embedCached(texts),
      query: text => this.embed([text], 'query'),
    });
  }

  detectCorrection(text: string): Promise<Correction> { return this.corrections.detect(text); }

  /** Starts the worker and the first sync (call soon after boot). */
  start(): void { void this.ensure().then(() => this.sync()).catch(() => { /* logged by call */ }); }

  private ensure(): Promise<void> {
    if (this.worker) return Promise.resolve();
    const w = new Worker(this.deps.workerFile, { workerData: { dir: this.deps.dir } });
    this.worker = w;
    w.unref();
    w.on('message', (m: { id?: number; ok?: boolean; result?: unknown; error?: string; event?: string; status?: HybridStatus }) => {
      if (m.event === 'status' && m.status) {
        const wasReady = this.last.model.state === 'ready';
        this.last = m.status; this.deps.onStatus?.(m.status);
        // warm once when the model becomes ready (indexing pushes a status every ~200 passages); syncs warm too
        if (!wasReady && m.status.model.state === 'ready') this.corrections.warm();
        return;
      }
      const p = m.id !== undefined ? this.waiting.get(m.id) : undefined;
      if (!p) return;
      this.waiting.delete(m.id!); clearTimeout(p.timer);
      if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error ?? 'search worker error'));
    });
    const gone = (why: string) => {
      if (this.worker !== w) return;
      this.worker = null; this.syncedRoot = null; this.restartAfter = Date.now() + RESTART_PAUSE_MS;
      for (const p of this.waiting.values()) { clearTimeout(p.timer); p.reject(new Error(why)); }
      this.waiting.clear();
    };
    w.on('error', e => { log.warn('search', 'hybrid search worker failed', { cause: errText(e), hint: 'restarted on the next search; until then Ctrl+K falls back to its own index' }); gone(errText(e)); });
    w.on('exit', code => gone(`search worker exited (${code})`));
    return this.call({ op: 'init', download: this.deps.download }).then(() => undefined);
  }

  private async call<T>(req: WorkerReq): Promise<T> {
    if (!this.worker) {
      if (Date.now() < this.restartAfter) throw new Error('search worker restarting');
      await this.ensure();
    }
    const w = this.worker;
    if (!w) throw new Error('search worker stopped');
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      // no answer in time = a hung worker (every later call would wait too): end it, the next call starts a new one
      const timer = setTimeout(() => { this.waiting.delete(id); reject(new Error(`search worker did not answer ${req.op} in time`)); void w.terminate(); }, CALL_TIMEOUT_MS);
      this.waiting.set(id, { resolve: v => resolve(v as T), reject, timer });
      w.postMessage({ ...req, id });
    });
  }

  /** Re-reads the brain's changed files (also after the brain folder was switched); false when it failed. */
  async sync(): Promise<boolean> {
    const root = this.deps.brainRoot();
    if (!root) return false;
    try {
      const n = await this.call<number>({ op: 'sync', root });
      if (root !== this.syncedRoot) log.info('search', 'brain indexed', { data: { changed: n, ...this.last } });
      this.syncedRoot = root;
      this.corrections.warm();
      return true;
    } catch (e) { log.warn('search', 'brain index not updated', { cause: errText(e), hint: 'retried on the next file change or search' }); return false; }
  }

  /** A brain file changed (live feed's watcher): sync a few seconds later, once for a burst of changes. */
  fileChanged(): void {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => { this.syncTimer = null; void this.sync(); }, SYNC_DELAY_MS);
    this.syncTimer.unref();
  }

  async query(q: string, opts: { limit?: number; prefix?: string } = {}): Promise<Hit[]> {
    if (this.deps.brainRoot() !== this.syncedRoot && !(await this.sync())) throw new Error('brain index not ready');
    return this.call<Hit[]>({ op: 'query', q: q.slice(0, 500), ...opts });
  }

  /** Vectors for `texts` (L2-normalised), null when the model is not available: callers fall back to words. */
  embed(texts: string[], mode: 'query' | 'passage'): Promise<Float32Array[] | null> { return this.call({ op: 'embed', texts, mode }); }

  /** Every embedded chunk of the documents under a key prefix ("brain:ai-errors.md"). */
  vectors(prefix: string): Promise<{ id: number; doc: string; line: number; text: string; v: Float32Array }[]> { return this.call({ op: 'vectors', prefix }); }

  /** Errors or ideas grouped by theme (the Dashboard's Temi tab); not ready without the model or a synced index. The
   *  result is kept until the file's chunks or the day change: the tab polls every minute and clustering runs here, in
   *  the main process. */
  async themes(kind: ThemeKind, now = Date.now()): Promise<Themes> {
    const notReady: Themes = { kind, ready: false, entries: 0, themes: [], duplicates: [] };
    if (this.deps.brainRoot() !== this.syncedRoot && !(await this.sync())) return notReady;
    if (this.last.model.state !== 'ready') return notReady;
    const rows = await this.vectors(`brain:${THEME_FILES[kind]}`);
    const today = ROME_DAY.format(now), key = `${today}|${rowsKey(this.syncedRoot, rows)}`;
    const kept = this.themeCache.get(kind);
    if (kept?.key === key) return kept.themes;
    let fellBack = false;
    const t = await themesOf(kind, rows.map(r => ({ ...r, at: 0 })), today, { embed: texts => this.embedCached(texts).catch(e => { fellBack = true; throw e; }) });
    if (!fellBack) this.themeCache.set(kind, { key, themes: t }); // a fallback is retried on the next poll
    return t;
  }

  /** The past errors most similar to `text`. Never waits for a sync or for the errors' vectors (the brain's hook asks
   *  on every prompt with a short timeout): until they exist it answers ready:false and builds them in the background;
   *  after a change of ai-errors.md it answers from the previous vectors while the new lines are embedded. */
  async recall(text: string, k = RECALL_K): Promise<Recall> {
    const notReady: Recall = { ready: false, errors: [] };
    const root = this.deps.brainRoot();
    if (root) {
      try {
        const textFile = read(root, THEME_FILES.errors);
        const entries = errorEntries([{ id: 0, doc: 'brain:ai-errors.md', line: 1, at: 0, text: textFile, v: new Float32Array() }]);
        if (entries.length > 0 && entries.length < RECALL_MIN_ERRORS) return { ready: true, errors: lexicalErrors(text, entries, k) };
      } catch { /* unreadable error file retains the normal unavailable behavior */ }
    }
    if (this.deps.brainRoot() !== this.syncedRoot) { this.errorVecs = null; void this.sync(); return notReady; }
    if (this.last.model.state !== 'ready') return notReady;
    const rows = await this.vectors(`brain:${THEME_FILES.errors}`);
    const key = rowsKey(this.syncedRoot, rows);
    if (this.errorVecs?.key !== key) this.warmErrors(rows, key);
    const kept = this.errorVecs?.key.startsWith(`${this.syncedRoot}|`) ? this.errorVecs : null; // never another brain's
    if (!kept) return notReady;
    const [q] = (await this.embed([text], 'query')) ?? [];
    return q ? { ready: true, errors: similarErrors(q, kept.index, k) } : notReady;
  }

  private warmErrors(rows: { id: number; doc: string; line: number; text: string; v: Float32Array }[], key: string): void {
    if (this.warming) return;
    const entries = errorEntries(rows.map(r => ({ ...r, at: 0 })));
    this.warming = this.embedCached(entries.map(e => e.text))
      .then(vs => {
        // the brain folder may have changed meanwhile: its vectors are built on the next prompt
        if (key.startsWith(`${this.syncedRoot}|`)) this.errorVecs = { key, index: recallIndex(entries.map((entry, i) => ({ entry, v: vs[i]! }))) };
      })
      .catch(e => log.warn('search', 'error recall vectors failed', { cause: errText(e) }))
      .finally(() => { this.warming = null; });
  }

  /** Passage vectors by text, kept between calls, embedded EMBED_BATCH at a time (one long call could time out and
   *  take the worker, and Ctrl+K with it, down). */
  private async embedCached(texts: string[]): Promise<Float32Array[]> {
    // vectors are read back from `got`, not the shared cache: another caller may clear it between two batches
    const got = new Map(texts.flatMap(t => { const v = this.textVecs.get(t); return v ? [[t, v] as const] : []; }));
    const missing = [...new Set(texts.filter(t => !got.has(t)))];
    if (this.textVecs.size + missing.length > TEXT_VECS_MAX) this.textVecs.clear();
    for (let i = 0; i < missing.length; i += EMBED_BATCH) {
      const batch = missing.slice(i, i + EMBED_BATCH);
      const vs = await this.embed(batch, 'passage');
      if (!vs) throw new Error('model not available');
      batch.forEach((t, k) => { got.set(t, vs[k]!); this.textVecs.set(t, vs[k]!); });
    }
    return texts.map(t => got.get(t)!);
  }

  status(): HybridStatus { return this.last; }

  /** Starts (or restarts after a failure) the model download. */
  async retryModel(): Promise<HybridStatus> { return this.call<HybridStatus>({ op: 'download' }); }

  stop(): void {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    const w = this.worker;
    this.worker = null;
    void w?.terminate();
  }
}

export { cosine };

/** The brain folder and a hash of a file's chunks (ids, lines, text): a cached result stays valid while it is the same. */
const rowsKey = (root: string | null, rows: { id: number; line: number; text: string }[]): string => {
  const h = crypto.createHash('sha1');
  for (const r of rows) h.update(`${r.id}:${r.line}:${r.text}\n`);
  return `${root}|${h.digest('base64url')}`;
};

/** The `k` items most similar to `q` (cosine, best first). */
export function topK(q: Float32Array, items: { id: string; vec: Float32Array }[], k: number): { id: string; score: number }[] {
  return items.map(i => ({ id: i.id, score: cosine(q, i.vec) })).sort((a, b) => b.score - a.score).slice(0, k);
}

/** The worker script next to the main bundle. */
export const workerFileNextTo = (mainDir: string): string => path.join(mainDir, 'search-worker.js');
