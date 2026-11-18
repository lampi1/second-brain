// Simple cross-process locks of the routine runtime (ADR 0175): routines started from different terminals share one
// lock folder (`%LOCALAPPDATA%\routine-runtime\locks` for the CLI), whatever their runs root. One file per resource
// (a work item, a workspace folder, a package's watcher), created exclusively; it names its owner run, pid and host and
// expires (refreshed at every step). A lock is taken over when it expired or its process on this host is gone.
// Best effort by design: two hosts sharing a folder, clock skew, a process alive under a reused pid and two takers of
// the same stale lock at the same instant are not covered.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_LOCK_TTL_MS = 6 * 3_600_000;

export interface LockOwner { owner: string; pid: number; host: string; at: number; expiresAt: number }

export interface Locks {
  /** Takes `name` for `owner` (re-entrant for the same owner). null = another live owner holds it (see `holder`). */
  acquire(name: string, owner: string): LockOwner | null;
  /** Moves the expiry of the locks `owner` holds forward. */
  refresh(names: string[], owner: string): void;
  /** Frees the locks `owner` holds; another owner's lock is left alone. */
  release(names: string[], owner: string): void;
  /** The live holder of `name`, if any. */
  holder(name: string): LockOwner | null;
}

export interface LocksOptions { ttlMs?: number; now?: () => number; pid?: number; host?: string; alive?: (pid: number) => boolean }

const processAlive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
};

/** A lock name for a filesystem path: case- and separator-insensitive, short. */
export const pathLockName = (prefix: string, target: string): string =>
  `${prefix}-${createHash('sha256').update(path.resolve(target).replace(/\\/g, '/').toLowerCase()).digest('hex').slice(0, 16)}`;

export function createLocks(dir: string, options: LocksOptions = {}): Locks {
  const ttl = options.ttlMs ?? DEFAULT_LOCK_TTL_MS, now = options.now ?? (() => Date.now());
  const pid = options.pid ?? process.pid, host = options.host ?? os.hostname(), alive = options.alive ?? processAlive;
  const file = (name: string) => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(name) || name.includes('..')) throw new Error(`Invalid lock name "${name}"`);
    return path.join(dir, `${name}.lock`);
  };
  const read = (name: string): LockOwner | null => {
    try { return JSON.parse(fs.readFileSync(file(name), 'utf8')) as LockOwner; } catch { return null; }
  };
  const live = (o: LockOwner | null): o is LockOwner => Boolean(o && o.expiresAt > now() && !(o.host === host && !alive(o.pid)));
  const content = (owner: string): LockOwner => { const at = now(); return { owner, pid, host, at, expiresAt: at + ttl }; };
  // a rewrite goes through a temp file and a rename, a create through a temp file and a hard link: a reader never sees a
  // half-written lock (and takes it for free)
  const temp = (name: string, value: LockOwner) => {
    const at = `${file(name)}.${pid}.${Math.random().toString(36).slice(2)}.tmp`;
    fs.writeFileSync(at, JSON.stringify(value));
    return at;
  };
  const rewrite = (name: string, value: LockOwner) => {
    const at = temp(name, value);
    try { fs.renameSync(at, file(name)); } catch (e) { fs.rmSync(at, { force: true }); throw e; }
  };
  // the exclusive create links a fully written temp file into place (EEXIST = taken): the lock never exists empty
  const create = (name: string, value: LockOwner) => {
    const at = temp(name, value);
    try { fs.linkSync(at, file(name)); } finally { fs.rmSync(at, { force: true }); }
  };

  const locks: Locks = {
    acquire(name, owner) {
      fs.mkdirSync(dir, { recursive: true });
      for (let tries = 0; tries < 2; tries++) {
        const mine = content(owner);
        try { create(name, mine); return mine; }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
        const held = read(name);
        if (held?.owner === owner) { rewrite(name, mine); return mine; }
        if (live(held)) return null;
        // expired, or its process on this host is gone: remove it and retry the exclusive create once. Best effort: two
        // takers at the same instant can both win (the second removes the first one's fresh lock); accepted, rare.
        try { fs.rmSync(file(name), { force: true }); } catch { /* another process removed it */ }
      }
      return null;
    },
    refresh(names, owner) {
      for (const name of names) if (read(name)?.owner === owner) { try { rewrite(name, content(owner)); } catch { /* best effort: it expires later */ } }
    },
    release(names, owner) {
      for (const name of names) if (read(name)?.owner === owner) { try { fs.rmSync(file(name), { force: true }); } catch { /* best effort */ } }
    },
    holder(name) { const held = read(name); return live(held) ? held : null; },
  };
  return locks;
}
