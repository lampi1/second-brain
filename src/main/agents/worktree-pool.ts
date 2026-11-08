// The worktree pool (ADR 0227): the git worktrees a writing delegation works in are reused per repository instead of
// made new each time (a `git worktree add` measured 72 s under load on the owner's PC, a full checkout of every file),
// and the app's leftover worktrees are cleaned and capped. Any git repository a chat works in gets its own pool, made on
// demand; nothing is hard-coded. A slot is reset between uses with `git checkout -B <fresh branch> <parent HEAD>` and
// `git clean -fd` (never -x: bin/obj/node_modules stay, the point of reusing). Only worktrees the app made and marked are
// reused or removed, and never one with uncommitted changes or commits on no remote branch and not on the repository's
// base branch: those are only reported. Used by agents/worktrees.ts (DelegateWorktrees.prepare takes a slot) and
// wiring.ts (cleanup at start and every 6 h, Settings → Avanzate through worktrees:usage/cleanup; the timer only scans until the first manual cleanup); pinned by
// test/unit/agents/worktree-pool.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { WorktreeLimits, WorktreeRepoUsage, WorktreeReported, WorktreeUsage } from '../../shared/contract';
import { errText, log } from '../log';
import { readLocal, writeLocal } from './local-store';
import { within } from './tool-policy';
import { GitSession, cleanRepository } from './worktrees';

/** A reusable worktree of the pool: `usedAt` orders the reuse (most recent first) and the trim (least recent first). */
export interface PoolSlot { root: string; common: string; createdAt: number; usedAt: number; branch: string }
/** One `git worktree list --porcelain` entry. */
export interface ListedWorktree { path: string; branch: string | null; prunable: boolean; locked: boolean }

/** The app's delegation branches: 12 hex since the pool (guard-safe, no GUID shape), a UUID before it. */
export const POOL_BRANCH = /^sb\/delegate-(?:[a-f0-9]{12}|[a-f0-9-]{36})$/;
/** The folder names the app gives its worktrees (fs.mkdtemp: a prefix and 6 characters). */
export const APP_DIR = /^\.second-brain-(?:delegate|integration)-[A-Za-z0-9]{6}$/;
const MARKER = 'second-brain-owned';
const LEASE_MS = 10 * 60_000;
const SIZE_TTL_MS = 10 * 60_000;
/** a worktree touched more recently than this is left alone by the cleanup (a terminal or an editor may be in it) */
const RECENT_MS = 30 * 60_000;
/** add/remove/checkout of a whole tree: 72 s measured for an add under load (2026-11-07) */
const SLOW_MS = 10 * 60_000;
const win = process.platform === 'win32';
const real = (p: string): string => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
const keyOf = (p: string): string => win ? real(p).toLowerCase() : real(p);
const isDir = (p: string): boolean => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

export const poolBranch = (): string => `sb/delegate-${randomBytes(6).toString('hex')}`;

/** Every entry of `git worktree list --porcelain`, the main checkout first. Exported for the tests. */
export function parseWorktrees(porcelain: string): ListedWorktree[] {
  const out: ListedWorktree[] = [];
  for (const block of porcelain.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const head = lines.find(l => l.startsWith('worktree '));
    const p = head?.slice(9).trim();
    if (!p || !path.isAbsolute(p)) continue;
    const b = lines.find(l => l.startsWith('branch '))?.slice(7).trim();
    out.push({ path: path.resolve(p), branch: b ? b.replace(/^refs\/heads\//, '') : null,
      prunable: lines.some(l => l === 'prunable' || l.startsWith('prunable ')), locked: lines.some(l => l === 'locked' || l.startsWith('locked ')) });
  }
  return out;
}

/** The private git dir of a linked worktree (its `.git` file says "gitdir: …"), read without a git spawn; null when
 *  `.git` is no such file (a main checkout, or no worktree). */
export function privateGitDir(root: string): string | null {
  try {
    const text = fs.readFileSync(path.join(root, '.git'), 'utf8').trim();
    const m = /^gitdir:\s*(.+)$/.exec(text);
    return m ? path.resolve(root, m[1]!.trim()) : null;
  } catch { return null; }
}
const isMarked = (root: string): boolean => { const g = privateGitDir(root); return !!g && fs.existsSync(path.join(g, MARKER)); };
function mark(root: string): void {
  const g = privateGitDir(root);
  if (g) fs.writeFileSync(path.join(g, MARKER), `${new Date().toISOString()}\n`);
}
/** When git last touched the worktree (its index or HEAD), ms; 0 unknown. */
function touchedAt(root: string): number {
  const g = privateGitDir(root);
  if (!g) return 0;
  let t = 0;
  for (const f of ['index', 'HEAD']) { try { t = Math.max(t, fs.statSync(path.join(g, f)).mtimeMs); } catch { /* absent */ } }
  return t;
}

/** Bytes under `dir`, links and junctions not followed (a node_modules junction to the parent's is not counted). */
export async function folderBytes(dir: string): Promise<number> {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    let ents: fs.Dirent[];
    try { ents = await fs.promises.readdir(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) { try { total += (await fs.promises.lstat(p)).size; } catch { /* gone */ } }
    }
  }
  return total;
}

/** Unlinks the links and junctions in the first two levels of a worktree (a `node_modules` junction to the parent's
 *  checkout), never what they point to, before `git worktree remove` deletes the folder. */
function unlinkLinks(root: string): void {
  const walk = (dir: string, depth: number): void => {
    let ents: fs.Dirent[];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name === '.git') continue;
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink()) { try { fs.unlinkSync(p); } catch { /* git refuses the remove if it stays */ } }
      else if (e.isDirectory() && depth < 2) walk(p, depth + 1);
    }
  };
  walk(root, 1);
}

async function limitedAll<T, R>(items: readonly T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]!); }
  }));
  return out;
}

export interface WorktreePoolOptions {
  /** the registry (userData/worktree-pool.json); none = memory only (tests) */
  file?: string;
  limits: () => WorktreeLimits;
  /** an open chat (or a running engine) works inside `root` */
  inUse: (root: string) => boolean;
  /** the folders the app's chats work in: the repositories they belong to are the ones the cleanup looks at */
  knownCwds: () => Iterable<string>;
  /** the delegation allocations (delegation-worktrees.json): app-owned roots made before the pool */
  allocated?: () => Iterable<{ root: string; common: string }>;
  now?: () => number;
}

type EntryState = 'inUse' | 'recent' | 'changes' | 'unpushed' | 'clean' | 'unknown';
interface Entry { root: string; branch: string | null; slot: PoolSlot | undefined; state: EntryState; usedAt: number; bytes: number | null }
interface RepoScan { main: string; common: string; worktrees: number; entries: Entry[] }

export class WorktreePool {
  private slots: PoolSlot[] = [];
  private readonly leases = new Map<string, number>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly commons = new Map<string, string | null>();
  private readonly baseRefs = new Map<string, string | null>();
  private readonly sizes = new Map<string, { bytes: number; at: number }>();
  private last: WorktreeUsage | null = null;
  private lastCleanup: { removed: number; at: number } | null = null;
  /** when the user first pressed «Pulisci ora»: until then the timer only scans (the user's decision, ADR 0227) */
  private manualAt: number | null = null;
  private job: Promise<WorktreeUsage> | null = null;
  private readonly now: () => number;

  constructor(private readonly o: WorktreePoolOptions) {
    this.now = o.now ?? Date.now;
    const stored = o.file ? readLocal(o.file) : undefined;
    if (stored === undefined) return;
    const v = stored as { version?: number; slots?: unknown[]; manualAt?: unknown } | null;
    if (!v || v.version !== 1 || !Array.isArray(v.slots) || v.slots.length > 1000) throw new Error('Invalid worktree pool registry; original file preserved.');
    this.manualAt = typeof v.manualAt === 'number' && Number.isFinite(v.manualAt) ? v.manualAt : null;
    this.slots = v.slots.filter((s): s is PoolSlot => {
      const x = s as PoolSlot | null;
      return !!x && typeof x.root === 'string' && path.isAbsolute(x.root) && typeof x.common === 'string' && path.isAbsolute(x.common)
        && APP_DIR.test(path.basename(x.root)) && typeof x.branch === 'string' && Number.isFinite(x.createdAt) && Number.isFinite(x.usedAt);
    });
  }

  private save(): void { if (this.o.file) writeLocal(this.o.file, { version: 1, slots: this.slots, ...(this.manualAt !== null ? { manualAt: this.manualAt } : {}) }); }

  /** One operation at a time per repository: a take and a cleanup never pick the same slot. */
  private serial<T>(common: string, fn: () => Promise<T>): Promise<T> {
    const k = keyOf(common);
    const run = (this.queues.get(k) ?? Promise.resolve()).catch(() => {}).then(fn);
    this.queues.set(k, run);
    return run;
  }

  private leased(root: string): boolean {
    const until = this.leases.get(keyOf(root));
    return until !== undefined && until > this.now();
  }
  /** The prepare that took `root` ended (bound to its chat, or failed): the chat's own use now protects it. */
  release(root: string): void { this.leases.delete(keyOf(root)); }

  /** The pool slot containing `cwd`, if any. */
  slotOf(cwd: string): PoolSlot | undefined { return this.slots.find(s => within(s.root, cwd)); }
  /** Where the next child of `cwd`'s repository will most likely work: the slot take() would reset next (the most
   *  recently used free one), at `cwd`'s path inside its slot; null when `cwd` is in no slot or no other slot is free.
   *  The warm pool starts the next child's engine there (ADR 0227 proposal 5). */
  nextCwd(cwd: string): string | null {
    const mine = this.slotOf(cwd);
    if (!mine) return null;
    const next = this.slotsOf(mine.common).filter(s => s !== mine && isDir(s.root) && !this.leased(s.root) && !this.o.inUse(s.root))
      .sort((a, b) => b.usedAt - a.usedAt)[0];
    const target = next ? path.join(next.root, path.relative(mine.root, cwd)) : null;
    return target && isDir(target) ? target : null;
  }
  /** The slots of one repository (tests, the report). */
  slotsOf(common: string): PoolSlot[] { const k = keyOf(common); return this.slots.filter(s => keyOf(s.common) === k); }

  /** The repository's base branch ref: origin's HEAD, else a local master or main; null when none. Cached. */
  private async baseRef(main: string, common: string, session: GitSession, fresh = false): Promise<string | null> {
    const k = keyOf(common);
    if (!fresh && this.baseRefs.has(k)) return this.baseRefs.get(k)!;
    const r = await session.git(main, ['for-each-ref', '--format=%(refname) %(symref)', 'refs/remotes/origin/HEAD', 'refs/heads/master', 'refs/heads/main']);
    const rows = r.exit === 0 ? r.out.split(/\r?\n/).map(l => l.trim().split(' ')) : [];
    const origin = rows.find(([ref]) => ref === 'refs/remotes/origin/HEAD')?.[1];
    const base = origin || rows.find(([ref]) => ref === 'refs/heads/master')?.[0] || rows.find(([ref]) => ref === 'refs/heads/main')?.[0] || null;
    this.baseRefs.set(k, base);
    return base;
  }

  /** Commits of `root`'s HEAD on no remote branch, not on the base branch and not in `also`; null when git failed. */
  private async unique(root: string, base: string | null, session: GitSession, also: string[] = []): Promise<number | null> {
    const r = await session.git(root, ['rev-list', '--count', 'HEAD', '--not', '--remotes', ...(base ? [base] : []), ...also]);
    const n = r.exit === 0 ? Number(r.out.trim()) : NaN;
    return Number.isSafeInteger(n) ? n : null;
  }

  /** A worktree on a fresh branch at `source.head`, outside the source checkout: a free slot of the repository reset in
   *  place, else a new one. Leased until release(). Never refused for the limits: the cleanup trims later. */
  async take(source: { root: string; common: string; head: string }, session: GitSession): Promise<{ root: string; branch: string; reused: boolean }> {
    return this.serial(source.common, async () => {
      const branch = poolBranch();
      const free = this.slotsOf(source.common).filter(s => isDir(s.root) && !this.leased(s.root) && !this.o.inUse(s.root) && keyOf(s.root) !== keyOf(source.root))
        .sort((a, b) => b.usedAt - a.usedAt);
      for (const slot of free) {
        this.leases.set(keyOf(slot.root), this.now() + LEASE_MS);
        try {
          if (await this.reset(slot.root, source, branch, session)) {
            slot.usedAt = this.now(); slot.branch = branch; this.save();
            return { root: real(slot.root), branch, reused: true };
          }
        } catch (e) { log.info('agents', 'pool slot not reusable', { data: { slot: path.basename(slot.root), cause: errText(e) } }); }
        this.release(slot.root);
      }
      const root = fs.mkdtempSync(path.join(path.dirname(source.root), '.second-brain-delegate-'));
      this.leases.set(keyOf(root), this.now() + LEASE_MS);
      try {
        const add = await session.git(source.root, ['worktree', 'add', '-b', branch, root, source.head], SLOW_MS);
        if (add.exit !== 0) throw new Error(add.error ?? 'Git could not verify or prepare the isolated worktree; no child was started.');
        mark(root);
        const made = await cleanRepository(root, null, session);
        if (keyOf(made.root) !== keyOf(root) || keyOf(made.common) !== keyOf(source.common) || made.head !== source.head) throw new Error('Isolated worktree verification failed; shared checkout was not used.');
      } catch (e) { this.release(root); throw e; }
      const t = this.now();
      this.slots.push({ root: real(root), common: real(source.common), createdAt: t, usedAt: t, branch });
      this.save();
      const { perRepo, total } = this.o.limits();
      if (this.slotsOf(source.common).length > perRepo || this.slots.length > total) log.warn('agents', 'worktree pool above its limit', { data: { repo: path.basename(path.dirname(source.common)), slots: this.slotsOf(source.common).length, perRepo, total }, hint: 'the next cleanup removes the least used free slots' });
      return { root: real(root), branch, reused: false };
    });
  }

  /** Resets one slot to `head` on `branch` when it is safely reusable: the same repository, nothing uncommitted, no
   *  commit that exists only there. false = leave it (the cleanup reports it). */
  private async reset(root: string, source: { root: string; common: string; head: string }, branch: string, session: GitSession): Promise<boolean> {
    const was = await cleanRepository(root, null, session);
    if (keyOf(was.root) !== keyOf(root) || keyOf(was.common) !== keyOf(source.common)) return false;
    // asked in the slot itself (it shares the repository's refs): one git policy probe for the whole reset
    const base = await this.baseRef(root, source.common, session);
    if (await this.unique(root, base, session, [source.head]) !== 0) return false;
    // -B moves only the new branch; the old one stays as a ref (no commit is lost). clean -fd without -x: the ignored
    // build outputs (bin/obj, node_modules) are what makes a reused slot fast
    const co = await session.git(root, ['checkout', '-q', '-B', branch, source.head], SLOW_MS);
    if (co.exit !== 0) return false;
    const clean = await session.git(root, ['clean', '-fdq'], SLOW_MS);
    if (clean.exit !== 0) return false;
    const head = await session.git(root, ['rev-parse', 'HEAD']);
    return head.exit === 0 && head.out.trim() === source.head;
  }

  /** The last report, or a fresh scan (removes nothing) when there is none or `refresh`. */
  usage(refresh = false): Promise<WorktreeUsage> {
    if (this.job) return this.job;
    if (this.last && !refresh) return Promise.resolve({ ...this.last, running: false });
    return this.start(false);
  }
  /** Removes the app's orphan and over-limit worktrees (only clean ones with no commit of their own), adopts clean
   *  legacy ones as slots, prunes git's stale records; then reports. */
  cleanup(): Promise<WorktreeUsage> {
    if (this.manualAt === null) { this.manualAt = this.now(); this.save(); }
    return this.job ?? this.start(true);
  }
  /** The timer's run: a cleanup once the user has pressed «Pulisci ora» at least once, a scan (removes nothing) before. */
  autoCleanup(): Promise<WorktreeUsage> { return this.manualAt === null ? this.usage(true) : this.job ?? this.start(true); }
  /** The last report without any work (null = none yet). */
  snapshot(): WorktreeUsage | null { return this.last ? { ...this.last, running: !!this.job } : null; }

  private start(apply: boolean): Promise<WorktreeUsage> {
    const job = this.run(apply).finally(() => { this.job = null; });
    this.job = job;
    return job;
  }

  /** The repositories the app knows: the ones of its chats' folders, of the pool and of the allocations. */
  private async repos(session: GitSession): Promise<string[]> {
    const byCommon = new Map<string, string>();
    const add = (common: string, via: string): void => { const k = keyOf(common); if (!byCommon.has(k) && isDir(via)) byCommon.set(k, via); };
    for (const s of this.slots) add(s.common, s.root);
    for (const a of this.o.allocated?.() ?? []) add(a.common, a.root);
    const cwds = [...new Set([...this.o.knownCwds()].filter(c => c && path.isAbsolute(c)))]
      // a chat in one of the app's own worktrees names a repository the pool or the allocations already know
      .filter(c => !c.split(/[\\/]/).some(seg => APP_DIR.test(seg)));
    await limitedAll(cwds, 4, async cwd => {
      const k = keyOf(cwd);
      if (!this.commons.has(k)) {
        if (!isDir(cwd)) return;
        const r = await session.git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
        const c = r.exit === 0 ? r.out.trim() : '';
        this.commons.set(k, c && path.isAbsolute(c) ? real(c) : null);
      }
      const common = this.commons.get(k);
      if (common) add(common, cwd);
    });
    return [...byCommon.values()];
  }

  private async scan(via: string, session: GitSession): Promise<RepoScan | null> {
    const ids = await session.git(via, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    const common = ids.exit === 0 ? ids.out.trim() : '';
    if (!common || !path.isAbsolute(common)) return null;
    const list = await session.git(via, ['worktree', 'list', '--porcelain']);
    if (list.exit !== 0) return null;
    const all = parseWorktrees(list.out);
    const main = all[0]?.path;
    if (!main) return null;
    const base = await this.baseRef(main, common, session, true);
    const allocatedRoots = new Set([...(this.o.allocated?.() ?? [])].map(a => keyOf(a.root)));
    const linked = all.slice(1).filter(w => !w.prunable && !w.locked && isDir(w.path));
    const owned = linked.filter(w => {
      const slot = this.slotOf(w.path);
      if (slot && keyOf(slot.root) === keyOf(w.path)) return true;
      if (!APP_DIR.test(path.basename(w.path))) return false;
      return allocatedRoots.has(keyOf(w.path)) || isMarked(w.path) || w.branch === null || POOL_BRANCH.test(w.branch);
    });
    const entries = await limitedAll(owned, 4, async (w): Promise<Entry> => {
      const slot = this.slots.find(s => keyOf(s.root) === keyOf(w.path));
      const touched = touchedAt(w.path);
      const e: Entry = { root: w.path, branch: w.branch, slot, state: 'unknown', usedAt: slot?.usedAt ?? touched, bytes: null };
      if (this.o.inUse(w.path) || this.leased(w.path)) { e.state = 'inUse'; return e; }
      const st = await session.git(w.path, ['status', '--porcelain=v1', '--untracked-files=normal']);
      if (st.exit !== 0) return e;
      if (st.out.trim()) { e.state = 'changes'; return e; }
      const n = await this.unique(w.path, base, session);
      if (n === null) return e;
      if (n > 0) { e.state = 'unpushed'; return e; }
      e.state = touched > this.now() - RECENT_MS ? 'recent' : 'clean';
      return e;
    });
    return { main, common: real(common), worktrees: linked.length, entries };
  }

  private async measure(entries: Entry[]): Promise<void> {
    await limitedAll(entries, 2, async e => {
      const k = keyOf(e.root), hit = this.sizes.get(k);
      if (hit && hit.at > this.now() - SIZE_TTL_MS) { e.bytes = hit.bytes; return; }
      e.bytes = await folderBytes(e.root);
      this.sizes.set(k, { bytes: e.bytes, at: this.now() });
    });
  }

  /** Which clean, unused app worktrees go: the non-slots (orphans) beyond the ones adopted as slots, then the least
   *  used slots beyond the per-repository count, the total count and the disk cap. */
  private plan(scans: RepoScan[], limits: WorktreeLimits): { remove: Entry[]; adopt: Entry[] } {
    const remove: Entry[] = [], adopt: Entry[] = [];
    const kept: Entry[] = [];
    for (const r of scans) {
      const slots = r.entries.filter(e => e.slot);
      let room = limits.perRepo - slots.length;
      // free clean slots beyond the per-repository count go, the least used first
      const freeSlots = slots.filter(e => e.state === 'clean').sort((a, b) => b.usedAt - a.usedAt);
      const busySlots = slots.length - freeSlots.length;
      const keepSlots = Math.max(0, limits.perRepo - busySlots);
      freeSlots.forEach((e, i) => (i < keepSlots ? kept : remove).push(e));
      for (const e of r.entries.filter(x => !x.slot && x.state === 'clean').sort((a, b) => b.usedAt - a.usedAt)) {
        if (room > 0 && path.basename(e.root).startsWith('.second-brain-delegate-')) { adopt.push(e); kept.push(e); room--; }
        else remove.push(e);
      }
    }
    // the total and the disk cap over all repositories: the least used kept slots go first
    const busy = scans.flatMap(r => r.entries.filter(e => (e.slot || adopt.includes(e)) && e.state !== 'clean')).length;
    kept.sort((a, b) => a.usedAt - b.usedAt);
    while (kept.length && kept.length + busy > limits.total) remove.push(kept.shift()!);
    const cap = limits.diskGb * 1e9;
    const appBytes = (): number => scans.flatMap(r => r.entries).filter(e => !remove.includes(e)).reduce((s, e) => s + (e.bytes ?? 0), 0);
    while (kept.length && appBytes() > cap) remove.push(kept.shift()!);
    return { remove, adopt: adopt.filter(e => !remove.includes(e)) };
  }

  private async removeEntry(r: RepoScan, e: Entry, session: GitSession): Promise<boolean> {
    // checked again under the repository's lock: a take may have started meanwhile
    if (this.o.inUse(e.root) || this.leased(e.root)) return false;
    unlinkLinks(e.root);
    const rm = await session.git(r.main, ['worktree', 'remove', e.root], SLOW_MS);
    if (rm.exit !== 0) { log.warn('agents', 'app worktree not removed', { data: { path: e.root }, hint: 'git refused (a locked file or a change appeared); the next cleanup tries again' }); return false; }
    // its branch had no commit of its own (checked by the scan): nothing is lost
    if (e.branch && POOL_BRANCH.test(e.branch)) await session.git(r.main, ['branch', '-D', e.branch]);
    this.slots = this.slots.filter(s => keyOf(s.root) !== keyOf(e.root));
    this.sizes.delete(keyOf(e.root));
    return true;
  }

  private async run(apply: boolean): Promise<WorktreeUsage> {
    const started = this.now(), session = new GitSession(), limits = this.o.limits();
    const vias = await this.repos(session);
    const seen = new Set<string>();
    const scans: RepoScan[] = [];
    for (const via of vias) {
      try {
        const s = await this.scan(via, session);
        if (s && !seen.has(keyOf(s.common))) { seen.add(keyOf(s.common)); scans.push(s); }
      } catch (e) { log.warn('agents', 'worktree scan failed', { data: { repo: via, cause: errText(e) }, hint: 'that repository is left out of this report' }); }
    }
    // slots of a repository whose folder is gone, or no longer listed by git, leave the registry
    const listed = new Set(scans.flatMap(r => r.entries.map(e => keyOf(e.root))));
    const scanned = new Set(scans.map(r => keyOf(r.common)));
    const before = this.slots.length;
    this.slots = this.slots.filter(s => !scanned.has(keyOf(s.common)) || listed.has(keyOf(s.root)) || this.leased(s.root));
    await this.measure(scans.flatMap(r => r.entries));
    let removed = 0;
    if (apply) {
      const { remove, adopt } = this.plan(scans, limits);
      for (const e of adopt) {
        const r = scans.find(x => x.entries.includes(e))!;
        mark(e.root);
        const slot: PoolSlot = { root: real(e.root), common: r.common, createdAt: e.usedAt, usedAt: e.usedAt, branch: e.branch ?? '' };
        this.slots.push(slot); e.slot = slot;
      }
      for (const r of scans) {
        await this.serial(r.common, async () => {
          for (const e of remove.filter(x => r.entries.includes(x))) {
            if (await this.removeEntry(r, e, session)) { removed++; r.entries = r.entries.filter(x => x !== e); r.worktrees--; }
          }
          await session.git(r.main, ['worktree', 'prune']);
          // the app's branches already on the base branch and checked out nowhere: nothing of theirs is lost
          const base = this.baseRefs.get(keyOf(r.common));
          if (base) {
            const merged = await session.git(r.main, ['for-each-ref', '--format=%(refname:short)', `--merged=${base}`, 'refs/heads/sb/']);
            const out = new Set(r.entries.map(e => e.branch));
            const gone = merged.exit === 0 ? merged.out.split(/\r?\n/).map(l => l.trim()).filter(b => POOL_BRANCH.test(b) && !out.has(b)).slice(0, 200) : [];
            if (gone.length) await session.git(r.main, ['branch', '-D', ...gone]);
          }
        });
      }
      if (removed) this.lastCleanup = { removed, at: this.now() };
    }
    if (apply || this.slots.length !== before) this.save();
    const repos: WorktreeRepoUsage[] = scans.map(r => {
      const reported: WorktreeReported[] = r.entries.filter(e => e.state === 'changes' || e.state === 'unpushed').map(e => ({ path: e.root, why: e.state as WorktreeReported['why'] }));
      const measured = r.entries.every(e => e.bytes !== null);
      return { repo: r.main, name: path.basename(r.main), worktrees: r.worktrees, app: r.entries.length, pool: r.entries.filter(e => e.slot).length,
        inUse: r.entries.filter(e => e.state === 'inUse').length, reported, bytes: measured ? r.entries.reduce((s, e) => s + (e.bytes ?? 0), 0) : null };
    }).sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0));
    const totalBytes = repos.every(r => r.bytes !== null) ? repos.reduce((s, r) => s + (r.bytes ?? 0), 0) : null;
    this.last = { repos, totalBytes, limits, at: this.now(), lastCleanup: this.lastCleanup, auto: this.manualAt !== null, running: false };
    log.info('agents', apply ? 'worktree cleanup done' : 'worktree scan done', { data: { repos: repos.length, app: repos.reduce((s, r) => s + r.app, 0),
      removed, reported: repos.reduce((s, r) => s + r.reported.length, 0), bytes: totalBytes, spawns: session.spawns, ms: this.now() - started } });
    return this.last;
  }
}
