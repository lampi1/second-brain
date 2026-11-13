// The hybrid search index on disk (userData/search/index.db, node:sqlite): documents (a brain file) with their size and
// mtime, their chunks, an FTS5 table for BM25 (accents folded) with its vocabulary for typo tolerance, and the chunk
// vectors keyed by the chunk text's hash (an edit re-embeds only the chunks that changed; a vector of a chunk that no
// longer exists is dropped). Vectors are scored with sqlite-vec's vec_distance_cosine when the extension loads, else
// in JS (same result, slower). Only the worker thread opens it (hybrid/engine.ts); tests open it in memory.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Chunk } from './chunk';

export interface DocMeta { key: string; size: number; mtimeMs: number }
export interface ChunkRow { id: number; doc: string; line: number; text: string; at: number }

const SCHEMA = `
create table if not exists docs(key text primary key, size integer not null, mtime real not null);
create table if not exists chunks(id integer primary key, doc text not null, line integer not null, text text not null, hash text not null);
create index if not exists chunks_doc on chunks(doc);
create index if not exists chunks_hash on chunks(hash);
create virtual table if not exists fts using fts5(title, body, tokenize = 'unicode61 remove_diacritics 2');
create virtual table if not exists fts_vocab using fts5vocab(fts, 'row');
create table if not exists vecs(hash text primary key, model text not null, v blob not null);
`;

const hashOf = (s: string): string => crypto.createHash('sha1').update(s).digest('hex');
/** A path as words: "journal/2026-10.md" → "journal 2026 10 md" (FTS then matches file names too). */
const titleOf = (key: string): string => key.replace(/^[a-z]+:/, '').replace(/[-_/.\\]/g, ' ');
/** A key prefix as a range (keys hold "_" and "%", LIKE's wildcards): key >= lo and key < hi. */
const range = (prefix: string): [string, string] => [prefix, `${prefix}\u{10FFFF}`];
const blob = (v: Float32Array): Uint8Array => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
const unblob = (b: Uint8Array): Float32Array => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s; // vectors are L2-normalised
}

/** The loadable sqlite-vec library for this platform, or null (not installed, or copied next to the build: out/native). */
export function vecExtension(nativeDir?: string): string | null {
  try {
    if (nativeDir) return `${nativeDir}/vec0`;
    return (createRequire(import.meta.url)('sqlite-vec') as { getLoadablePath: () => string }).getLoadablePath();
  } catch { return null; }
}

export class Store {
  readonly db: DatabaseSync;
  readonly vec: boolean;

  constructor(file: string, extension: string | null) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true }); // a new profile has no userData/search yet
    this.db = new DatabaseSync(file, { allowExtension: true });
    let vec = false;
    if (extension) { try { this.db.loadExtension(extension); vec = true; } catch { /* JS cosine instead */ } }
    this.vec = vec;
    try {
      this.db.exec('pragma journal_mode = wal; pragma synchronous = normal;');
      this.db.exec(SCHEMA);
    } catch (e) {
      // a corrupt file ("file is not a database"): close it, or Windows keeps it locked and openStore cannot delete it
      try { this.db.close(); } catch { /* already closed */ }
      throw e;
    }
  }

  docs(prefix: string): Map<string, DocMeta> {
    const rows = this.db.prepare('select key, size, mtime from docs where key >= ? and key < ?').all(...range(prefix)) as unknown as { key: string; size: number; mtime: number }[];
    return new Map(rows.map(r => [r.key, { key: r.key, size: r.size, mtimeMs: r.mtime }]));
  }

  /** Replaces a document's chunks (in one transaction). */
  put(meta: DocMeta, chunks: Chunk[]): void {
    this.tx(() => {
      this.drop(meta.key);
      this.db.prepare('insert into docs(key, size, mtime) values(?, ?, ?)').run(meta.key, meta.size, meta.mtimeMs);
      const ins = this.db.prepare('insert into chunks(doc, line, text, hash) values(?, ?, ?, ?)');
      const fts = this.db.prepare('insert into fts(rowid, title, body) values(?, ?, ?)');
      const title = titleOf(meta.key);
      for (const c of chunks) {
        const r = ins.run(meta.key, c.line, c.text, hashOf(c.text));
        fts.run(r.lastInsertRowid, title, c.text);
      }
    });
  }

  remove(key: string): void { this.tx(() => this.drop(key)); }

  private drop(key: string): void {
    this.db.prepare('delete from fts where rowid in (select id from chunks where doc = ?)').run(key);
    this.db.prepare('delete from chunks where doc = ?').run(key);
    this.db.prepare('delete from docs where key = ?').run(key);
  }

  private tx(fn: () => void): void {
    this.db.exec('begin');
    try { fn(); this.db.exec('commit'); } catch (e) { this.db.exec('rollback'); throw e; }
  }

  /** BM25 over the chunks: an FTS5 MATCH expression → best first, with a score where higher is better. */
  bm25(match: string, limit: number, prefix = ''): { id: number; score: number }[] {
    const rows = this.db.prepare(`select f.rowid id, bm25(fts, 2.0, 1.0) s from fts f join chunks c on c.id = f.rowid
      where fts match ? and c.doc >= ? and c.doc < ? order by s limit ?`).all(match, ...range(prefix), limit) as unknown as { id: number; s: number }[];
    return rows.map(r => ({ id: r.id, score: -r.s }));
  }

  /** Is this word in the index (any column)? */
  known(word: string): boolean { return !!this.db.prepare('select 1 from fts_vocab where term = ?').get(word); }

  /** The indexed words of a length window (typo candidates), most frequent first. */
  vocab(minLen: number, maxLen: number, limit = 50_000): string[] {
    return (this.db.prepare('select term from fts_vocab where length(term) between ? and ? order by cnt desc limit ?').all(minLen, maxLen, limit) as unknown as { term: string }[]).map(r => r.term);
  }

  chunks(ids: number[]): ChunkRow[] {
    if (!ids.length) return [];
    const rows = this.db.prepare(`select c.id id, c.doc doc, c.line line, c.text text, d.mtime at from chunks c join docs d on d.key = c.doc where c.id in (${ids.map(() => '?').join(',')})`).all(...ids) as unknown as ChunkRow[];
    const by = new Map(rows.map(r => [r.id, r]));
    return ids.map(i => by.get(i)).filter((r): r is ChunkRow => !!r);
  }

  /** Chunk texts that have no vector for `model` yet (the last indexed first), at most `limit`. No grouping or sort over
   *  the whole table: this runs once per small batch. A text found twice in a batch is embedded twice, harmlessly. */
  missingVectors(model: string, limit: number): { hash: string; text: string }[] {
    return this.db.prepare(`select c.hash hash, c.text text from chunks c where not exists (select 1 from vecs v where v.hash = c.hash and v.model = ?)
      order by c.id desc limit ?`).all(model, limit) as unknown as { hash: string; text: string }[];
  }

  putVectors(model: string, rows: { hash: string; v: Float32Array }[]): void {
    this.tx(() => { const ins = this.db.prepare('insert or replace into vecs(hash, model, v) values(?, ?, ?)'); for (const r of rows) ins.run(r.hash, model, blob(r.v)); });
  }

  /** Drops vectors of chunks that no longer exist or of another model. */
  pruneVectors(model: string): void {
    this.db.prepare('delete from vecs where model <> ? or hash not in (select hash from chunks)').run(model);
  }

  counts(model: string): { docs: number; chunks: number; vectors: number } {
    const one = (sql: string, ...a: string[]) => Number((this.db.prepare(sql).get(...a) as { n: number }).n);
    return { docs: one('select count(*) n from docs'), chunks: one('select count(*) n from chunks'), vectors: one('select count(distinct c.hash) n from chunks c join vecs v on v.hash = c.hash and v.model = ?', model) };
  }

  /** The chunks nearest to `q` by cosine (best first), restricted to documents whose key starts with `prefix`. */
  nearest(model: string, q: Float32Array, limit: number, prefix = ''): { id: number; score: number }[] {
    if (this.vec) {
      const rows = this.db.prepare(`select c.id id, vec_distance_cosine(v.v, ?) d from chunks c join vecs v on v.hash = c.hash and v.model = ?
        where c.doc >= ? and c.doc < ? order by d limit ?`).all(blob(q), model, ...range(prefix), limit) as unknown as { id: number; d: number }[];
      return rows.map(r => ({ id: r.id, score: 1 - r.d }));
    }
    const rows = this.db.prepare('select c.id id, v.v v from chunks c join vecs v on v.hash = c.hash and v.model = ? where c.doc >= ? and c.doc < ?').all(model, ...range(prefix)) as unknown as { id: number; v: Uint8Array }[];
    return rows.map(r => ({ id: r.id, score: cosine(q, unblob(r.v)) })).sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /** Every chunk of the documents under `prefix` with its vector (themes, error recall); chunks without one are left out. */
  vectors(model: string, prefix: string): (ChunkRow & { v: Float32Array })[] {
    const rows = this.db.prepare(`select c.id id, c.doc doc, c.line line, c.text text, d.mtime at, v.v v from chunks c join docs d on d.key = c.doc join vecs v on v.hash = c.hash and v.model = ?
      where c.doc >= ? and c.doc < ? order by c.doc, c.line`).all(model, ...range(prefix)) as unknown as (ChunkRow & { v: Uint8Array })[];
    return rows.map(r => ({ ...r, v: unblob(r.v) }));
  }

  close(): void { try { this.db.close(); } catch { /* already closed */ } }
}

/** The index, rebuilt from scratch when the file is unreadable (it is only a cache of the brain). */
export function openStore(file: string, extension: string | null): Store {
  try { return new Store(file, extension); } catch {
    for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
    return new Store(file, extension);
  }
}
