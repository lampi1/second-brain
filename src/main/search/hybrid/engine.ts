// The hybrid search engine (SPEC 23): brain files cut into chunks (chunk.ts), ranked by BM25 (FTS5, every query word
// optional, unknown words widened to near indexed words: typo.ts) and by meaning (local embeddings: embedder.ts), the
// two lists merged by reciprocal rank fusion. Exact names and codes win through BM25, paraphrases and the other language
// through the vectors; without the model it is BM25 only. Incremental: a sync re-reads only files whose size or mtime
// changed, and only new chunk texts are embedded (newest files first, in small batches). Files = the brain's git files
// (tracked or new, never ignored ones: tmp/ clones stay out), notes only (.md, .txt; no scripts), no secret files. Runs in the worker thread
// (worker.ts); tests drive it in-process with a fake embedder.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { errText, log } from '../../log';
import type { Embedder, Mode } from './embedder';
import { chunkText } from './chunk';
import { cosine, type ChunkRow, type Store } from './store';
import { allowedTypos, nearWords } from './typo';

export const BRAIN = 'brain:';
const EXT = /\.(md|txt)$/i; // notes only: scripts may hold a token, and the agents read every hit
const SECRET = /(^|\/)\.env|credentials|secret/i;
const FILE_BYTES = 1024 * 1024;
const MAX_FILES = 6000;
const RRF_K = 60;
const POOL = 60; // candidates taken from each ranking
const MIN_SIMILARITY = 0.8; // e5 unrelated passages often score around 0.7; rank alone is not relevance

export interface Hit { doc: string; path: string; line: number; text: string; chunk: string; at: number; score: number; via: 'words' | 'meaning' | 'both' }

/** Lower case, accents off, letters and digits only (as FTS5's unicode61 remove_diacritics 2). */
const foldWords = (s: string): string[] => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** The query's folded words (at most 12, one-letter words dropped when there are others). */
export function queryWords(q: string): string[] {
  const w = foldWords(q);
  return [...new Set(w.length > 1 ? w.filter(x => x.length > 1) : w)].slice(0, 12);
}

/** The brain's searchable files ('/'-separated): git's tracked and untracked-not-ignored files, else a folder walk. */
export async function brainFiles(root: string): Promise<string[]> {
  let list: string[];
  try {
    const { stdout } = await promisify(execFile)('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    list = stdout.split('\0').filter(Boolean);
  } catch (e) {
    // A worktree may use a .git file, and the brain may be a subfolder of a repository.
    for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, '.git'))) throw e;
      if (path.dirname(dir) === dir) break;
    }
    list = [];
    const walk = (dir: string, rel: string, depth: number) => {
      const ents = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of ents) {
        if (list.length >= MAX_FILES) return;
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) { if (depth < 8 && !/^(\.|node_modules$|tmp$)/.test(e.name)) walk(path.join(dir, e.name), r, depth + 1); }
        else if (e.isFile()) list.push(r);
      }
    };
    walk(root, '', 0);
  }
  return [...new Set(list)].filter(f => EXT.test(f) && !SECRET.test(f)).slice(0, MAX_FILES);
}

export class Engine {
  private embedder: Embedder | null = null;
  private vocabCache: { at: number; words: string[] } | null = null;

  constructor(private store: Store, private listFiles: (root: string) => Promise<string[]> = brainFiles) {}

  setEmbedder(e: Embedder | null): void { this.embedder = e; }
  get model(): string | null { return this.embedder?.id ?? null; }

  /** Brings the brain's documents up to date; returns how many were (re)indexed or removed. */
  async sync(root: string): Promise<number> {
    // Reject before mutation: the service must not label the retained index as a newly selected unavailable root.
    if (!fs.statSync(root).isDirectory()) throw new Error('brain root is not a directory');
    const files = await this.listFiles(root);
    const known = this.store.docs(BRAIN);
    let changed = 0;
    for (const rel of files) {
      const key = BRAIN + rel;
      // synchronous reads: this runs in the worker, and awaiting each file would queue it behind every embedding batch
      let st: fs.Stats;
      try { st = fs.statSync(path.join(root, rel)); } catch { continue; }
      const old = known.get(key);
      known.delete(key);
      if (old && old.size === st.size && old.mtimeMs === st.mtimeMs) continue;
      let text = '';
      if (st.size <= FILE_BYTES) { try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; } }
      this.store.put({ key, size: st.size, mtimeMs: st.mtimeMs }, text ? chunkText(text) : []);
      changed++;
    }
    for (const key of known.keys()) { this.store.remove(key); changed++; }
    if (changed) this.vocabCache = null;
    return changed;
  }

  /** Embeds up to `batch` chunks still without a vector; returns how many were done (0 = nothing left or no model). */
  async embedPending(batch = 16): Promise<number> {
    const e = this.embedder;
    if (!e) return 0;
    // of the newest missing chunks, the shortest go together: a batch is padded to its longest text
    const todo = this.store.missingVectors(e.id, batch * 4).sort((a, b) => a.text.length - b.text.length).slice(0, batch);
    if (!todo.length) { this.store.pruneVectors(e.id); return 0; }
    const vs = await e.embed(todo.map(t => t.text), 'passage');
    this.store.putVectors(e.id, todo.map((t, i) => ({ hash: t.hash, v: vs[i]! })));
    return todo.length;
  }

  async embed(texts: string[], mode: Mode): Promise<Float32Array[] | null> {
    return this.embedder ? this.embedder.embed(texts, mode) : null;
  }

  /** The FTS5 expression for the query words: each word (the last one also as a prefix: search while typing) or, when
   *  the index does not know it, its near words. Words are OR-ed: BM25 ranks chunks with more of them first. */
  matchExpr(words: string[]): string | null {
    const q = (w: string) => `"${w.replace(/"/g, '""')}"`;
    const parts: string[] = [];
    words.forEach((w, i) => {
      const alts = [q(w)];
      if (i === words.length - 1 && w.length >= 3) alts.push(`${q(w)}*`);
      if (allowedTypos(w.length) && !this.store.known(w)) alts.push(...nearWords(w, this.vocab()).map(q));
      parts.push(alts.length > 1 ? `(${alts.join(' OR ')})` : alts[0]!);
    });
    return parts.length ? parts.join(' OR ') : null;
  }

  private vocab(): string[] {
    if (!this.vocabCache || Date.now() - this.vocabCache.at > 60_000) this.vocabCache = { at: Date.now(), words: this.store.vocab(3, 40) };
    return this.vocabCache.words;
  }

  /** The best chunks for `q` (best first). `prefix` limits the documents (e.g. "brain:ai-errors.md"). */
  async query(q: string, opts: { limit?: number; prefix?: string } = {}): Promise<Hit[]> {
    const limit = opts.limit ?? 20, prefix = opts.prefix ?? BRAIN;
    const words = queryWords(q);
    if (!words.length) return [];
    const expr = this.matchExpr(words);
    const lexical = expr ? this.store.bm25(expr, POOL, prefix) : [];
    let semantic: { id: number; score: number }[] = [];
    if (this.embedder) {
      try {
        const [v] = await this.embedder.embed([q], 'query');
        if (v) semantic = this.store.nearest(this.embedder.id, v, POOL, prefix).filter(r => r.score >= MIN_SIMILARITY);
      } catch (e) { log.warn('search', 'query embedding failed', { cause: errText(e), hint: 'answering with BM25 words only' }); }
    }
    const fused = new Map<number, { score: number; words: boolean; meaning: boolean }>();
    lexical.forEach((r, i) => fused.set(r.id, { score: 1 / (RRF_K + i + 1), words: true, meaning: false }));
    semantic.forEach((r, i) => {
      const f = fused.get(r.id) ?? { score: 0, words: false, meaning: false };
      f.score += 1 / (RRF_K + i + 1); f.meaning = true;
      fused.set(r.id, f);
    });
    const top = [...fused].sort((a, b) => b[1].score - a[1].score).slice(0, limit);
    const rows = new Map(this.store.chunks(top.map(([id]) => id)).map(r => [r.id, r]));
    return top.flatMap(([id, f]) => {
      const r = rows.get(id);
      if (!r) return [];
      const at = bestLine(r, words);
      return [{ doc: r.doc, path: r.doc.slice(r.doc.indexOf(':') + 1), line: at.line, text: at.text, chunk: r.text, at: r.at, score: Math.round(f.score * 1e5) / 1e5, via: f.words && f.meaning ? 'both' as const : f.words ? 'words' as const : 'meaning' as const }];
    });
  }

  /** Every embedded chunk under `prefix` (themes, error recall). */
  vectors(prefix: string): (ChunkRow & { v: Float32Array })[] { return this.embedder ? this.store.vectors(this.embedder.id, prefix) : []; }

  status(): { docs: number; chunks: number; vectors: number; vec: boolean } {
    return { ...this.store.counts(this.embedder?.id ?? ''), vec: this.store.vec };
  }
}

/** The chunk's line with the most query words (else its first text line), as the hit's line and excerpt. */
function bestLine(r: ChunkRow, words: string[]): { line: number; text: string } {
  const lines = r.text.split('\n');
  let best = -1, bestN = 0;
  lines.forEach((l, i) => {
    const low = foldWords(l).join(' ');
    const n = words.filter(w => low.includes(w)).length;
    if (n > bestN) { best = i; bestN = n; }
  });
  if (best < 0) best = Math.max(0, lines.findIndex(l => l.trim() && !/^#{1,6}\s/.test(l)));
  return { line: r.line + best, text: (lines[best] ?? '').trim().slice(0, 240) };
}

export { cosine };
