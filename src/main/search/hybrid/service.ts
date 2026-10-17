// The hybrid search in the main process (SPEC 23): starts the worker (out/main/search-worker.js) on the brain's index
// in userData/search, keeps it in sync with the brain folder (at start, when the folder changes, and a few seconds after
// a file changes: the brain watcher's onFile) and offers one API to the rest of the app: query (/api/search, Ctrl+K, the
// agents' brain_search tool), plus the building blocks of the agent classifier (ui-agents, SPEC 23 a): embed, cosine,
// topK. The model is downloaded once in the background (never blocking the start; progress and retry in the UI); until
// then, or if it fails, results come from BM25 only. A dead worker is restarted on the next call (not within 10 s of
// the last crash: no restart loop), a hung one is terminated when a call times out. Until the brain is indexed, query
// throws, so every caller falls back to its old search. Used by main/index.ts.
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { errText, log } from '../../log';
import { cosine, type Hit } from './engine';
import { THEME_FILES, themesOf, type ThemeKind, type Themes } from './themes';
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
  private restartAfter = 0;

  constructor(private deps: HybridDeps) {}

  /** Starts the worker and the first sync (call soon after boot). */
  start(): void { void this.ensure().then(() => this.sync()).catch(() => { /* logged by call */ }); }

  private ensure(): Promise<void> {
    if (this.worker) return Promise.resolve();
    const w = new Worker(this.deps.workerFile, { workerData: { dir: this.deps.dir } });
    this.worker = w;
    w.unref();
    w.on('message', (m: { id?: number; ok?: boolean; result?: unknown; error?: string; event?: string; status?: HybridStatus }) => {
      if (m.event === 'status' && m.status) { this.last = m.status; this.deps.onStatus?.(m.status); return; }
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
    const today = ROME_DAY.format(now), key = `${this.syncedRoot}|${today}|${rows.map(r => `${r.id}:${r.line}:${r.text.length}`).join(',')}`;
    const kept = this.themeCache.get(kind);
    if (kept?.key === key) return kept.themes;
    let fellBack = false;
    const t = await themesOf(kind, rows.map(r => ({ ...r, at: 0 })), today, { embed: texts => this.embedCached(texts).catch(e => { fellBack = true; throw e; }) });
    if (!fellBack) this.themeCache.set(kind, { key, themes: t }); // a fallback is retried on the next poll
    return t;
  }

  /** Passage vectors by text, kept between calls, embedded EMBED_BATCH at a time (one long call could time out and
   *  take the worker, and Ctrl+K with it, down). */
  private async embedCached(texts: string[]): Promise<Float32Array[]> {
    let missing = [...new Set(texts.filter(t => !this.textVecs.has(t)))];
    if (this.textVecs.size + missing.length > TEXT_VECS_MAX) { this.textVecs.clear(); missing = [...new Set(texts)]; }
    for (let i = 0; i < missing.length; i += EMBED_BATCH) {
      const batch = missing.slice(i, i + EMBED_BATCH);
      const vs = await this.embed(batch, 'passage');
      if (!vs) throw new Error('model not available');
      batch.forEach((t, k) => this.textVecs.set(t, vs[k]!));
    }
    return texts.map(t => this.textVecs.get(t)!);
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

/** The `k` items most similar to `q` (cosine, best first). */
export function topK(q: Float32Array, items: { id: string; vec: Float32Array }[], k: number): { id: string; score: number }[] {
  return items.map(i => ({ id: i.id, score: cosine(q, i.vec) })).sort((a, b) => b.score - a.score).slice(0, k);
}

/** The worker script next to the main bundle. */
export const workerFileNextTo = (mainDir: string): string => path.join(mainDir, 'search-worker.js');
