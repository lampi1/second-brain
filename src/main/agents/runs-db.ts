// The agent runs' tables in userData/app.db (ADR 0199): one row per run (id, agent, start and end as indexed columns, the
// run's JSON) and a small key/value table for what is not a run (the rollups of pruned runs, prunedThrough, Flash's
// outcomes). AgentRunStore (runs.ts) keeps the runs in memory as before and writes here only the runs whose JSON changed,
// in one transaction; the one-time move from agent-runs.json is an import in one transaction whose counts are checked
// before it commits. `exportRuns` gives the old file's shape back, read only (the levels CLI via readRunsSource, tests).
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { APP_DB, migrate, openAppDbReadOnly, areaVersion, reopenAppDb, tx, type Migration } from '../app-db';

export const AREA = 'agent_runs';
/** The area's forward migrations: index i takes it from version i to i + 1. Never edit a shipped step; add one. */
export const RUNS_STEPS: readonly Migration[] = [
  db => db.exec(`
    create table agent_runs(id text primary key, agent_id text not null, started_at real not null, ended_at real, json text not null);
    create index agent_runs_agent on agent_runs(agent_id);
    create index agent_runs_started on agent_runs(started_at);
    create index agent_runs_ended on agent_runs(ended_at);
    create table agent_runs_meta(key text primary key, value text not null);
  `),
];

/** A run as stored: the indexed columns beside its JSON. */
export interface RunRow { id: string; agentId: string; startedAt: number; endedAt: number | null; json: string }
/** What one save changes: runs to insert or replace, runs to delete (pruned), meta keys to set (null = delete). */
export interface RunsWrite { upsert: readonly RunRow[]; remove: readonly string[]; meta: ReadonlyMap<string, string | null> }

export class RunsDb {
  private handle: DatabaseSync | null;
  /** `db`: the connection openAppDb gave for `file`; closed (close, closeAppDbs), it is opened again at the next use. */
  constructor(db: DatabaseSync, readonly file: string) { this.handle = db; migrate(db, AREA, RUNS_STEPS); }
  private get db(): DatabaseSync {
    if (!this.handle?.isOpen) this.handle = reopenAppDb(this.file);
    return this.handle;
  }

  /** No run and no meta row: a new database (or one that never held runs). */
  empty(): boolean {
    return !this.db.prepare('select 1 from agent_runs limit 1').get() && !this.db.prepare('select 1 from agent_runs_meta limit 1').get();
  }

  count(): number { return Number((this.db.prepare('select count(*) n from agent_runs').get() as { n: number }).n); }

  /** Every run's JSON in the order they were first written, and the meta keys. */
  load(): { rows: { id: string; json: string }[]; meta: Map<string, string> } {
    const rows = this.db.prepare('select id, json from agent_runs order by rowid').all() as unknown as { id: string; json: string }[];
    const meta = new Map((this.db.prepare('select key, value from agent_runs_meta').all() as unknown as { key: string; value: string }[]).map(r => [r.key, r.value]));
    return { rows, meta };
  }

  /** One save, in one transaction. */
  write(w: RunsWrite): void {
    if (!w.upsert.length && !w.remove.length && !w.meta.size) return;
    tx(this.db, () => this.apply(w));
  }

  /** The move from agent-runs.json: every run and meta key in one transaction, the row count and ids checked against
   *  what was given, then `beforeCommit` (the rename of the JSON file) and the commit; when the commit fails after it,
   *  `undo` (the rename back). Any failure rolls the import back and throws. */
  importAll(rows: readonly RunRow[], meta: ReadonlyMap<string, string>, beforeCommit: () => void, undo: () => void): void {
    this.db.exec('begin immediate');
    let renamed = false;
    try {
      if (!this.empty()) throw new Error('import refused: the database already holds agent runs'); // never overwritten
      this.apply({ upsert: rows, remove: [], meta });
      const n = this.count();
      if (n !== rows.length) throw new Error(`import check: ${n} rows written, ${rows.length} runs read`);
      const ids = new Set((this.db.prepare('select id from agent_runs').all() as unknown as { id: string }[]).map(r => r.id));
      if (rows.some(r => !ids.has(r.id))) throw new Error('import check: a run is missing after the import');
      const m = Number((this.db.prepare('select count(*) n from agent_runs_meta').get() as { n: number }).n);
      if (m !== meta.size) throw new Error(`import check: ${m} meta rows written, ${meta.size} expected`);
      beforeCommit(); renamed = true;
      this.db.exec('commit');
    } catch (e) {
      try { this.db.exec('rollback'); } catch { /* not in a transaction any more */ }
      if (renamed) undo();
      throw e;
    }
  }

  private apply(w: RunsWrite): void {
    const put = this.db.prepare(`insert into agent_runs(id, agent_id, started_at, ended_at, json) values(?, ?, ?, ?, ?)
      on conflict(id) do update set agent_id = excluded.agent_id, started_at = excluded.started_at, ended_at = excluded.ended_at, json = excluded.json`);
    for (const r of w.upsert) put.run(r.id, r.agentId, r.startedAt, r.endedAt, r.json);
    const del = this.db.prepare('delete from agent_runs where id = ?');
    for (const id of w.remove) del.run(id);
    const set = this.db.prepare('insert into agent_runs_meta(key, value) values(?, ?) on conflict(key) do update set value = excluded.value');
    const unset = this.db.prepare('delete from agent_runs_meta where key = ?');
    for (const [k, v] of w.meta) { if (v === null) unset.run(k); else set.run(k, v); }
  }

  /** Releases the connection (the WAL is folded into app.db); the next use opens it again. */
  close(): void { try { if (this.handle?.isOpen) this.handle.close(); } catch { /* already closed */ } this.handle = null; }
}

/** The agent runs of an app.db in agent-runs.json's shape `{version: 1, runs, rollups?, prunedThrough?, flash?}`, read
 *  only (the levels CLI while the app runs, tests). null = the database holds no agent runs. A run whose JSON does not
 *  parse is passed on as null, so the reader counts it as out of shape. */
export function exportRuns(file: string): { version: 1; runs: unknown[]; rollups?: unknown[]; prunedThrough?: number; flash?: unknown } | null {
  const db = openAppDbReadOnly(file);
  try {
    if (areaVersion(db, AREA) < 1) return null;
    const parse = (s: string): unknown => { try { return JSON.parse(s) as unknown; } catch { return null; } };
    const runs = (db.prepare('select json from agent_runs order by rowid').all() as unknown as { json: string }[]).map(r => parse(r.json));
    const meta = new Map((db.prepare('select key, value from agent_runs_meta').all() as unknown as { key: string; value: string }[]).map(r => [r.key, r.value]));
    if (!runs.length && !meta.size) return null;
    const rollups = meta.has('rollups') ? parse(meta.get('rollups')!) : undefined;
    return { version: 1, runs,
      ...(rollups !== undefined ? { rollups: rollups as unknown[] } : {}),
      ...(meta.has('prunedThrough') ? { prunedThrough: Number(meta.get('prunedThrough')) } : {}),
      ...(meta.has('flash') ? { flash: parse(meta.get('flash')!) } : {}) };
  } finally { db.close(); }
}

/** The first bytes of every SQLite database file. */
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1');
export function isSqliteFile(file: string): boolean {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(SQLITE_MAGIC.length);
    return fs.readSync(fd, head, 0, head.length, 0) === head.length && head.equals(SQLITE_MAGIC);
  } catch { return false; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

/** The runs the levels CLI diagnoses (`npm run levels -- <path>`), read only: an app.db, an agent-runs.json (or a
 *  migrated copy of it), or a userData folder (its app.db when that holds runs, else its agent-runs.json). Throws with
 *  a readable reason when there is nothing to read. */
export function readRunsSource(p: string): { file: string; content: unknown } {
  if (fs.statSync(p).isDirectory()) {
    const db = path.join(p, APP_DB), json = path.join(p, 'agent-runs.json');
    const content = fs.existsSync(db) ? exportRuns(db) : null;
    if (content) return { file: db, content };
    if (fs.existsSync(json)) return { file: json, content: JSON.parse(fs.readFileSync(json, 'utf8')) as unknown };
    throw new Error(`no agent runs in ${p} (neither app.db nor agent-runs.json holds any)`);
  }
  if (isSqliteFile(p)) {
    const content = exportRuns(p);
    if (!content) throw new Error(`no agent runs in ${p}`);
    return { file: p, content };
  }
  return { file: p, content: JSON.parse(fs.readFileSync(p, 'utf8')) as unknown };
}
