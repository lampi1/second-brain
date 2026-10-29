// The app's own SQLite database, userData/app.db (ADR 0199), on node:sqlite (DatabaseSync, the Node that Electron bundles;
// the hybrid search index uses it too, search/hybrid/store.ts). Opened with WAL, synchronous=normal and a busy timeout, its
// pages checked (quick_check) at every open. A file SQLite reports as corrupt is renamed aside (never deleted) with its
// -wal/-shm and a new one is created; any other failure (a lock, a runtime without node:sqlite) throws, so the caller keeps
// its JSON file instead. Each area (first: the agent runs, agents/runs-db.ts) has its own schema version in
// `schema_version` and forward migrations, each in one transaction. Used by agents/runs-db.ts and the levels CLI.
import fs from 'node:fs';
import path from 'node:path';
import type * as NodeSqlite from 'node:sqlite';
import type { DatabaseSync } from 'node:sqlite';
import { renameWithRetry } from './agents/local-store';

export const APP_DB = 'app.db';
/** How long a statement waits for another connection's write lock (the levels CLI reading, a second store) before failing. */
export const BUSY_MS = 5000;

/** One forward step of an area's schema (index i takes the area from version i to i + 1). */
export type Migration = (db: DatabaseSync) => void;

/** node:sqlite, loaded at first use: a runtime without it (Node < 22.5) throws here, never at import. */
export function sqlite(): typeof NodeSqlite {
  const m = process.getBuiltinModule?.('node:sqlite') as typeof NodeSqlite | undefined;
  if (!m?.DatabaseSync) throw new Error(`node:sqlite is not available in this runtime (Node ${process.versions.node})`);
  return m;
}

/** SQLITE_CORRUPT (11) and SQLITE_NOTADB (26), or our quick_check failure: the only errors that move a database aside. */
export function isCorrupt(e: unknown): boolean {
  const err = e as { errcode?: unknown; corrupt?: unknown } | null;
  if (err?.corrupt === true) return true;
  return typeof err?.errcode === 'number' && [11, 26].includes(err.errcode & 0xff);
}

/** begin immediate … commit, rolled back when `fn` throws. */
export function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('begin immediate');
  let result: T;
  try { result = fn(); } catch (e) { try { db.exec('rollback'); } catch { /* already rolled back */ } throw e; }
  db.exec('commit');
  return result;
}

/** Every connection opened here and not closed yet: closeAppDbs releases them (a test before removing its folder: on
 *  Windows an open SQLite file cannot be deleted). Each owner opens its connection again at its next use. */
const handles = new Set<DatabaseSync>();
function track(db: DatabaseSync): DatabaseSync {
  for (const h of handles) if (!h.isOpen) handles.delete(h);
  handles.add(db);
  return db;
}
/** Closes every app.db connection of this process (tests; their owners reopen at their next use). */
export function closeAppDbs(): void {
  for (const h of handles) { try { if (h.isOpen) h.close(); } catch { /* already closed */ } }
  handles.clear();
}

/** A database opened again after its owner (or closeAppDbs) closed it: the pragmas of a connection, no check. */
export function reopenAppDb(file: string): DatabaseSync {
  const db = new (sqlite().DatabaseSync)(file);
  try { db.exec(`pragma busy_timeout = ${BUSY_MS}; pragma synchronous = normal;`); } catch (e) { db.close(); throw e; }
  return track(db);
}

function openChecked(file: string): DatabaseSync {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new (sqlite().DatabaseSync)(file);
  try {
    db.exec(`pragma busy_timeout = ${BUSY_MS}`); // first: a writer elsewhere is waited for, not taken for damage
    db.exec('pragma journal_mode = wal; pragma synchronous = normal;');
    const check = (db.prepare('pragma quick_check').all() as { quick_check?: unknown }[]).map(r => String(r.quick_check));
    if (check.join() !== 'ok') throw Object.assign(new Error(`quick_check: ${check.slice(0, 3).join('; ')}`), { corrupt: true });
    db.exec('create table if not exists schema_version(area text primary key, version integer not null, at integer not null)');
  } catch (e) {
    // closed, or Windows keeps the file locked and it cannot be moved aside
    try { db.close(); } catch { /* already closed */ }
    throw e;
  }
  return track(db);
}

/** Renames a database and its -wal/-shm to <name>.corrupt-<stamp>[-wal|-shm]; returns the new main file's path. */
function moveAside(file: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let aside = `${file}.corrupt-${stamp}`;
  for (let i = 2; fs.existsSync(aside); i++) aside = `${file}.corrupt-${stamp}-${i}`;
  renameWithRetry(file, aside);
  for (const ext of ['-wal', '-shm']) if (fs.existsSync(file + ext)) renameWithRetry(file + ext, aside + ext);
  return aside;
}

export interface OpenedDb {
  db: DatabaseSync;
  /** set when the file found was corrupt: where it was moved (the db is then a new, empty one) */
  aside: string | null;
  /** why it was taken for corrupt */
  cause: string | null;
}

/** Opens (creates) the database at `file`. A corrupt one is moved aside and a new one created; other errors throw. */
export function openAppDb(file: string): OpenedDb {
  try { return { db: openChecked(file), aside: null, cause: null }; } catch (e) {
    if (!isCorrupt(e) || !fs.existsSync(file)) throw e;
    const aside = moveAside(file);
    return { db: openChecked(file), aside, cause: e instanceof Error ? e.message : String(e) };
  }
}

/** A database opened read only (the levels CLI while the app runs): no schema change, no move aside. */
export function openAppDbReadOnly(file: string): DatabaseSync {
  const db = new (sqlite().DatabaseSync)(file, { readOnly: true });
  try { db.exec(`pragma busy_timeout = ${BUSY_MS}`); } catch (e) { db.close(); throw e; }
  return db;
}

/** The schema version of an area (0 = none yet). */
export function areaVersion(db: DatabaseSync, area: string): number {
  try { return Number((db.prepare('select version from schema_version where area = ?').get(area) as { version?: number } | undefined)?.version ?? 0); } catch { return 0; }
}

/** Brings an area to the last of its steps, one transaction per step. A version newer than this build's (a database
 *  written by a later release, then a rollback) throws: the caller keeps its JSON path and never downgrades the file. */
export function migrate(db: DatabaseSync, area: string, steps: readonly Migration[]): number {
  const from = areaVersion(db, area);
  if (from > steps.length) throw new Error(`${area}: schema version ${from} is newer than this release knows (${steps.length})`);
  for (let v = from; v < steps.length; v++) {
    tx(db, () => {
      steps[v]!(db);
      db.prepare('insert into schema_version(area, version, at) values(?, ?, ?) on conflict(area) do update set version = excluded.version, at = excluded.at')
        .run(area, v + 1, Date.now());
    });
  }
  return steps.length;
}
