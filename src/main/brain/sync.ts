// Multi-PC sync of the brain's domains (ADR 0059). For every domain with a remote (only "everywhere" ones, domains.ts):
// at start and before a chat that reads the brain, a sync (commit what changed, fetch, rebase on the remote, push); after
// the brain's files change and settle (debounced), the same. One writer at a time: one cycle per domain in this process,
// and a lock file in the domain's .git so a second app on this PC (stable and dev) waits its turn. Before every push the
// publish guard scans what would be sent (guard.ts): a finding, or no guard on this PC, blocks the push; exactly the
// scanned commit is pushed, never a HEAD that moved meanwhile. The rebase runs in a temporary worktree, never in the
// user's folder: their files are never reset; the branch then moves with `reset --keep` (refused if it would touch an
// edit made meanwhile: that edit is committed and the cycle retries). A rebase conflict stops that domain's sync until the
// user chooses: keep mine / keep theirs (rebase again with that side winning the conflicting lines) / open both (a .txt
// copy of each version, sync still stopped). Changes made during a cycle are not lost: a cycle that ends with something
// uncommitted or unpushed schedules the next. The app's commits carry a neutral identity (second-brain,
// sync@example.com) and no host name. Never silent: every stop is a status with its reason and a feed event. Git
// runs with prompts off; the remote is fetched into refs/sb-sync/<branch> so the app never adds or changes a git remote.
// Plain Node, unit-tested with real git on temp repos. Used by brain/index.ts.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DomainSyncStatus, SyncBlock, SyncChoice, SyncState } from '../../shared/contract';
import type { Domain } from './domains';
import { noGuardHint, scanCommits, type GuardPaths } from './guard';
import type { NodeRunner } from './node';
import { log, errText } from '../log';

export const SYNC_PREFIX = 'sync: ';
const LOCK_STALE_MS = 5 * 60_000;

export interface SyncDeps {
  domains: () => Domain[];
  /** the publish guard for a domain (its own deny list); null = missing, the push is blocked */
  guard: (d: Domain) => GuardPaths | null;
  node: NodeRunner;
  /** userData/sync-state.json: the last sync of each domain, kept across restarts */
  stateFile: string;
  /** where "open both" writes the two versions of a conflicting file */
  conflictsDir: string;
  onState: (s: SyncState) => void;
  /** a domain stopped (conflict, guard, no guard): the feed and a notification */
  onBlocked?: (d: DomainSyncStatus) => void;
  /** after the brain's files change, how long they must stay still before a sync (ms) */
  settleMs?: number;
  /** watch the domains' folders (off in unit tests that drive the cycles themselves) */
  watch?: boolean;
  now?: () => number;
}

/** The identity of the app's own commits (and of the rebased ones' committer): never the user's global one. */
export const APP_IDENTITY = ['-c', 'user.name=second-brain', '-c', 'user.email=sync@example.com'];

interface Git { code: number; out: string; err: string }

function git(cwd: string, args: string[], timeoutMs = 120_000): Promise<Git> {
  return new Promise(resolve => {
    execFile('git', ['-c', 'protocol.ext.allow=never', '-c', 'core.quotePath=false', ...args], {
      cwd, timeout: timeoutMs, maxBuffer: 1 << 26, windowsHide: true,
      // never a prompt or a credential window from a background sync; English messages to read the outcome
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '', LC_ALL: 'C', LANG: 'C' },
    }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0;
      resolve({ code, out: String(stdout ?? '').trim(), err: String(stderr ?? '').trim() || (err?.message ?? '') });
    });
  });
}

const lastLine = (s: string) => s.split(/\r?\n/).filter(Boolean).pop()?.slice(0, 240) ?? '';

class Blocked extends Error { constructor(readonly block: SyncBlock) { super(block.kind); } }
const gitError = (what: string, r: Git, hint: string) => new Blocked({ kind: 'error', message: `${what}: ${lastLine(r.err) || `codice ${r.code}`}`, hint });

export class DomainSync {
  /** the domains as last read (their deny list, for the guard) */
  private doms = new Map<string, Domain>();
  private status = new Map<string, DomainSyncStatus>();
  private runs = new Map<string, Promise<void>>();
  private again = new Set<string>();
  private watchers: fs.FSWatcher[] = [];
  private timers = new Map<string, NodeJS.Timeout>();
  private lastPull = 0;
  private stopped = false;
  private readonly now: () => number;

  constructor(private deps: SyncDeps) {
    this.now = deps.now ?? Date.now;
    this.refresh();
  }

  /** Re-reads the domains (start, brain folder changed); keeps the last sync and a conflict of a domain still there. */
  refresh(): void {
    const saved = this.loadSaved();
    const next = new Map<string, DomainSyncStatus>();
    this.doms.clear();
    for (const d of this.deps.domains()) {
      this.doms.set(d.name, d);
      const old = this.status.get(d.name);
      const keep = old && old.root === d.root && old.remote === d.remote ? old : null;
      next.set(d.name, {
        name: d.name, root: d.root, scope: d.scope, remote: d.remote, problem: d.problem,
        state: !d.remote ? 'off' : keep?.state === 'blocked' ? 'blocked' : 'idle',
        lastSync: keep?.lastSync ?? saved[d.name] ?? null, ahead: keep?.ahead ?? null, behind: keep?.behind ?? null,
        blocked: d.remote ? keep?.blocked ?? null : null,
      });
    }
    this.status = next;
    this.emit();
  }

  state(): SyncState { return { domains: [...this.status.values()].map(s => structuredClone(s)), at: this.now() }; }

  private synced(): DomainSyncStatus[] { return [...this.status.values()].filter(s => !!s.remote); }

  /** At start: a sync of every synced domain, then the watchers. */
  async start(): Promise<void> {
    this.stopped = false;
    if (this.deps.watch !== false) this.watch();
    await this.syncAll();
  }

  stop(): void {
    this.stopped = true;
    for (const w of this.watchers) { try { w.close(); } catch { /* already closed */ } }
    this.watchers = [];
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  /** Waits for the cycles running now (shutdown, tests). */
  async idle(): Promise<void> { while (this.runs.size) await Promise.allSettled([...this.runs.values()]); }

  async syncAll(): Promise<SyncState> {
    await Promise.all(this.synced().map(s => this.sync(s.name)));
    return this.state();
  }

  /** Before a chat that reads the brain: the remote's changes first. Bounded (a slow remote never holds a chat back
   *  longer than `maxMs`), at most once every `minGapMs`, never throws. */
  async beforeRead(maxMs = 15_000, minGapMs = 60_000): Promise<void> {
    if (!this.synced().length || this.now() - this.lastPull < minGapMs) return;
    this.lastPull = this.now();
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([this.syncAll().catch(() => undefined), new Promise<void>(r => { timer = setTimeout(r, maxMs); })]);
    if (timer) clearTimeout(timer);
  }

  /** One cycle of one domain; a cycle already running is followed by one more (changes made meanwhile are not lost). */
  sync(name: string): Promise<void> {
    const s = this.status.get(name);
    if (!s?.remote) return Promise.resolve();
    const running = this.runs.get(name);
    if (running) { this.again.add(name); return running; }
    const p = this.cycle(name).finally(() => {
      this.runs.delete(name);
      if (this.again.delete(name) && !this.stopped) void this.sync(name);
    });
    this.runs.set(name, p);
    return p;
  }

  /** The user's choice on a conflict (never an agent's: the UI's click). */
  async resolve(name: string, choice: SyncChoice): Promise<SyncState> {
    const s = this.status.get(name);
    if (!s?.remote) throw new Error(`dominio "${name}" non sincronizzato`);
    if (s.blocked?.kind !== 'conflict') throw new Error(`dominio "${name}": nessun conflitto da risolvere`);
    await this.runs.get(name);
    if (choice === 'both') {
      const copies = await this.writeBoth(s);
      this.set(name, { blocked: { kind: 'conflict', files: s.blocked.files, copies } });
      log.info('sync', 'conflict: both versions written for the user', { data: { domain: name, files: copies.length } });
      return this.state();
    }
    const p = this.cycle(name, choice).finally(() => { this.runs.delete(name); });
    this.runs.set(name, p);
    await p;
    return this.state();
  }

  // ── internals ──

  private watch(): void {
    for (const s of this.synced()) {
      try {
        const w = fs.watch(s.root, { recursive: true }, (_ev, file) => {
          const f = String(file ?? '').replace(/\\/g, '/');
          if (f === '.git' || f.startsWith('.git/') || this.stopped) return;
          // never dropped, even during a cycle (it re-runs once after) or right after one (git's own writes cost at most
          // one cycle that finds nothing to do)
          this.schedule(s.name, true);
        });
        w.on('error', e => log.warn('sync', 'domain watcher failed', { cause: errText(e), hint: 'the domain still syncs at start and before each chat', data: { domain: s.name } }));
        this.watchers.push(w);
      } catch (e) {
        log.warn('sync', 'cannot watch a domain folder', { cause: errText(e), hint: 'the domain still syncs at start and before each chat', data: { domain: s.name } });
      }
    }
  }

  /** A sync after the settle time; `restart` = debounce (a new change pushes the timer back). */
  private schedule(name: string, restart = false): void {
    if (this.stopped) return;
    const t = this.timers.get(name);
    if (t && !restart) return;
    if (t) clearTimeout(t);
    this.timers.set(name, setTimeout(() => { this.timers.delete(name); void this.sync(name); }, this.deps.settleMs ?? 30_000));
  }

  private set(name: string, patch: Partial<DomainSyncStatus>): void {
    const s = this.status.get(name);
    if (!s) return;
    const wasBlocked = s.blocked;
    Object.assign(s, patch);
    if (patch.blocked !== undefined) s.state = patch.blocked ? 'blocked' : patch.state ?? 'idle';
    this.emit();
    if (patch.blocked && JSON.stringify(patch.blocked) !== JSON.stringify(wasBlocked) && patch.blocked.kind !== 'error') this.deps.onBlocked?.(structuredClone(s));
  }

  private emit(): void { try { this.deps.onState(this.state()); } catch { /* a listener's problem is not the sync's */ } }

  private async cycle(name: string, choice?: Exclude<SyncChoice, 'both'>): Promise<void> {
    const s = this.status.get(name);
    if (!s?.remote || this.stopped) return;
    if (s.blocked?.kind === 'conflict' && !choice) return; // stopped until the user chooses
    const prevBlock = s.blocked;
    this.set(name, { state: 'syncing' });
    let release: (() => void) | null = null;
    try {
      const gitDir = await this.gitDir(s.root);
      release = this.lock(gitDir);
      if (!release) {
        // the other app on this PC (stable or dev) is syncing it: try again a little later
        this.set(name, { state: prevBlock ? 'blocked' : 'idle' });
        log.info('sync', 'another writer holds the domain: retry later', { data: { domain: name } });
        if (!this.timers.has(name) && !this.stopped) this.timers.set(name, setTimeout(() => { this.timers.delete(name); void this.sync(name); }, 15_000));
        return;
      }
      for (const f of ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD']) {
        if (fs.existsSync(path.join(gitDir, f))) throw new Blocked({ kind: 'error', message: 'un\'operazione git è in corso nella cartella del dominio', hint: 'finiscila o annullala (git rebase --abort / git merge --abort), poi «Sincronizza ora»' });
      }
      const branch = await this.branch(s.root);
      await this.commitLocal(s.root);
      let pushed = false;
      const upstream = `refs/sb-sync/${branch}`;
      for (let attempt = 0; attempt < 4 && !pushed; attempt++) {
        const has = await this.fetch(s.root, s.remote, branch);
        if (has) {
          const behind = Number((await git(s.root, ['rev-list', '--count', `HEAD..${upstream}`])).out) || 0;
          this.set(name, { behind });
          // false: an edit made during the sync sits on a file the remote changed: commit it and go again
          if (behind > 0 && !(await this.rebase(s, upstream, choice))) { await this.commitLocal(s.root); continue; }
        }
        const range = has ? `${upstream}..HEAD` : 'HEAD';
        let commits = (await git(s.root, ['rev-list', '--reverse', range])).out.split('\n').filter(Boolean);
        this.set(name, { ahead: commits.length, behind: 0 });
        if (!commits.length) { pushed = true; break; }
        // a push the guard stopped: the app's own commits are squashed into one, so a word removed since never reaches
        // the remote's history; the user's own commits are never rewritten
        if (prevBlock?.kind === 'guard' && has && commits.length > 1 && await this.allOwn(s.root, commits)) {
          await this.squash(s.root, upstream);
          commits = (await git(s.root, ['rev-list', '--reverse', range])).out.split('\n').filter(Boolean);
        }
        const dom = this.doms.get(name);
        const g = await scanCommits(s.root, commits, dom ? this.deps.guard(dom) : null, this.deps.node, noGuardHint(dom?.denyList));
        if (!g.ok) {
          if ('missing' in g) throw new Blocked({ kind: 'no-guard', hint: g.missing });
          if ('findings' in g) throw new Blocked({ kind: 'guard', findings: g.findings });
          throw new Blocked({ kind: 'error', message: g.error, hint: 'riprova con «Sincronizza ora»; se torna, guarda i log (scope sync)' });
        }
        // exactly what was scanned: a commit made after the scan waits for the next cycle (and its scan)
        const tip = commits[commits.length - 1]!;
        const r = await git(s.root, ['push', '--porcelain', s.remote, `${tip}:refs/heads/${branch}`]);
        if (r.code === 0) { await git(s.root, ['update-ref', upstream, tip]); pushed = true; break; }
        if (!/rejected|non-fast-forward|fetch first/i.test(`${r.out}\n${r.err}`)) throw gitError('invio non riuscito', r, 'controlla la rete e l\'accesso al remote, poi «Sincronizza ora»');
        // someone pushed in the meantime: fetch and rebase again, once
      }
      if (!pushed) throw new Blocked({ kind: 'error', message: 'il remote o i file sono cambiati più volte durante la sincronizzazione', hint: 'riprova con «Sincronizza ora»' });
      const at = this.now();
      const ahead = Number((await git(s.root, ['rev-list', '--count', `${upstream}..HEAD`])).out) || 0;
      this.set(name, { state: 'idle', blocked: null, ahead, behind: 0, lastSync: at });
      this.saveLast(name, at);
      // changed during this cycle (uncommitted, or committed after the scan): one more cycle once it settles
      if (ahead > 0 || (await git(s.root, ['status', '--porcelain'])).out) this.schedule(name);
      if (prevBlock) log.info('sync', 'domain sync running again', { data: { domain: name, was: prevBlock.kind } });
    } catch (e) {
      if (e instanceof Blocked) {
        this.set(name, { blocked: e.block });
        const b = e.block;
        log.warn('sync', `domain sync stopped: ${b.kind}`, {
          cause: b.kind === 'error' ? b.message : b.kind === 'guard' ? `${b.findings.length} finding(s): ${b.findings.slice(0, 5).map(f => `${f.file}${f.line ? `:${f.line}` : ''} ${f.rule}`).join(', ')}` : b.kind === 'conflict' ? `conflict in ${b.files.join(', ')}` : 'publish guard missing',
          hint: b.kind === 'error' ? b.hint : b.kind === 'no-guard' ? b.hint : b.kind === 'guard' ? 'remove the work content from the flagged files (work facts go to the work domain); then the sync resumes' : 'choose keep mine / keep theirs / open both in the sync status',
          data: { domain: name },
        });
      } else {
        this.set(name, { blocked: { kind: 'error', message: errText(e).slice(0, 240), hint: 'riprova con «Sincronizza ora»; se torna, guarda i log (scope sync)' } });
        log.error('sync', 'domain sync failed', { cause: errText(e), hint: 'see the message in the sync status; git must be on PATH', data: { domain: name } });
      }
    } finally {
      release?.();
    }
  }

  private async gitDir(root: string): Promise<string> {
    const r = await git(root, ['rev-parse', '--absolute-git-dir']);
    if (r.code !== 0) throw new Blocked({ kind: 'error', message: 'la cartella del dominio non è un repository git', hint: 'clonala dal suo remote (scripts/setup-pc.mjs) o crea il repository' });
    return r.out;
  }

  private async branch(root: string): Promise<string> {
    const r = await git(root, ['symbolic-ref', '--short', 'HEAD']);
    if (r.code !== 0 || !/^[\w./-]+$/.test(r.out)) throw new Blocked({ kind: 'error', message: 'il dominio non è su un ramo (HEAD staccato)', hint: 'torna sul suo ramo (git switch main), poi «Sincronizza ora»' });
    return r.out;
  }

  private async commitLocal(root: string): Promise<void> {
    let r = await git(root, ['add', '-A']);
    if (r.code !== 0) throw gitError('git add non riuscito', r, 'un file è bloccato da un altro programma? riprova tra poco');
    if ((await git(root, ['diff', '--cached', '--quiet'])).code === 0) return;
    r = await git(root, [...APP_IDENTITY, 'commit', '-q', '-m', `${SYNC_PREFIX}${new Date(this.now()).toISOString()}`]);
    if (r.code !== 0) throw gitError('commit non riuscito', r, 'un hook del repository ha rifiutato il commit? guarda il messaggio');
  }

  /** Fetches the remote's branch into refs/sb-sync/<branch>; false = the remote has no such branch yet (a new repo). */
  private async fetch(root: string, remote: string, branch: string): Promise<boolean> {
    const r = await git(root, ['fetch', '--no-tags', '--quiet', remote, `+refs/heads/${branch}:refs/sb-sync/${branch}`]);
    if (r.code === 0) return true;
    if (/couldn't find remote ref/i.test(r.err)) return false;
    throw gitError('ricezione non riuscita', r, 'controlla la rete e l\'accesso al remote (il PC è collegato a GitHub?), poi «Sincronizza ora»');
  }

  /** Rebases this PC's commits on the remote's in a temporary worktree (the user's folder is never reset), then moves the
   *  branch there with `reset --keep`. true = done; false = an edit made meanwhile would be overwritten (the caller
   *  commits it and retries). A conflict throws a Blocked conflict and leaves the user's folder as it was. */
  private async rebase(s: DomainSyncStatus, upstream: string, choice?: Exclude<SyncChoice, 'both'>): Promise<boolean> {
    // in a rebase "ours" is the remote's side and "theirs" the commits being replayed: this PC's
    const x = choice === 'mine' ? ['-X', 'theirs'] : choice === 'theirs' ? ['-X', 'ours'] : [];
    const head = (await git(s.root, ['rev-parse', 'HEAD'])).out;
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-sync-rebase-'));
    const wt = path.join(base, 'w');
    let next = '';
    try {
      const add = await git(s.root, ['worktree', 'add', '--detach', '--quiet', wt, head]);
      if (add.code !== 0) throw gitError('cartella di lavoro temporanea non creata', add, 'riprova con «Sincronizza ora»; se torna, guarda i log (scope sync)');
      const r = await git(wt, [...APP_IDENTITY, 'rebase', '--quiet', ...x, upstream]);
      if (r.code !== 0) {
        const files = (await git(wt, ['diff', '--name-only', '--diff-filter=U'])).out.split('\n').filter(Boolean);
        await git(wt, ['rebase', '--abort']);
        const known = s.blocked?.kind === 'conflict' ? s.blocked.files : [];
        throw new Blocked({ kind: 'conflict', files: files.length ? files : known.length ? known : ['(file non individuato)'] });
      }
      next = (await git(wt, ['rev-parse', 'HEAD'])).out;
    } finally {
      const rm = await git(s.root, ['worktree', 'remove', '--force', wt]);
      if (rm.code !== 0) await git(s.root, ['worktree', 'prune']);
      fs.rmSync(base, { recursive: true, force: true });
    }
    // the branch moves only from where the rebase started; local edits stay (reset --keep refuses to overwrite one)
    if ((await git(s.root, ['rev-parse', 'HEAD'])).out !== head) return false;
    const k = await git(s.root, ['reset', '--keep', '--quiet', next]);
    if (k.code === 0) return true;
    const gitDir = await this.gitDir(s.root);
    const unmerged = (await git(s.root, ['diff', '--name-only', '--diff-filter=U'])).out;
    if (unmerged || ['rebase-merge', 'rebase-apply', 'MERGE_HEAD'].some(d => fs.existsSync(path.join(gitDir, d)))) {
      throw new Blocked({ kind: 'error', message: 'un\'operazione git è in corso nella cartella del dominio', hint: 'finiscila o annullala (git rebase --abort / git merge --abort), poi «Sincronizza ora»' });
    }
    return false;
  }

  private async allOwn(root: string, commits: string[]): Promise<boolean> {
    for (const c of commits) if (!(await git(root, ['log', '-1', '--format=%s', c])).out.startsWith(SYNC_PREFIX)) return false;
    return true;
  }

  private async squash(root: string, upstream: string): Promise<void> {
    const r = await git(root, ['reset', '--soft', upstream]);
    if (r.code !== 0) throw gitError('riunione dei commit non riuscita', r, 'riprova con «Sincronizza ora»');
    await this.commitLocal(root);
  }

  private async writeBoth(s: DomainSyncStatus): Promise<string[]> {
    if (s.blocked?.kind !== 'conflict') return [];
    const branch = await this.branch(s.root);
    const dir = path.join(this.deps.conflictsDir, s.name.replace(/[^\w.-]/g, '_'), String(this.now()));
    const out: string[] = [];
    for (const f of s.blocked.files) {
      const ext = path.extname(f);
      const base = f.slice(0, f.length - ext.length).replace(/[\\/]/g, '__');
      for (const [side, ref] of [['mia', 'HEAD'], ['loro', `refs/sb-sync/${branch}`]] as const) {
        const r = await git(s.root, ['show', `${ref}:${f}`]);
        if (r.code !== 0) continue; // deleted on that side
        // .txt: opening a copy shows its text, never runs it (a conflicting file may be a script)
        const file = path.join(dir, `${base}.${side}${ext}.txt`);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, `${r.out}\n`);
        out.push(file);
      }
    }
    return out;
  }

  /** A lock file in the domain's .git (wx = only one creator); a lock older than 5 min is a crashed writer's. */
  private lock(gitDir: string): (() => void) | null {
    const f = path.join(gitDir, 'sb-sync.lock');
    const take = () => { fs.writeFileSync(f, `${process.pid} ${new Date(this.now()).toISOString()}\n`, { flag: 'wx' }); return () => { try { fs.unlinkSync(f); } catch { /* gone */ } }; };
    try { return take(); } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(f).mtimeMs > LOCK_STALE_MS) { fs.unlinkSync(f); return take(); } } catch { /* raced: the other writer has it */ }
      return null;
    }
  }

  private loadSaved(): Record<string, number> {
    try {
      const o = JSON.parse(fs.readFileSync(this.deps.stateFile, 'utf8')) as { lastSync?: Record<string, unknown> };
      return Object.fromEntries(Object.entries(o.lastSync ?? {}).filter((e): e is [string, number] => typeof e[1] === 'number'));
    } catch { return {}; }
  }

  private saveLast(name: string, at: number): void {
    try {
      const all = { ...this.loadSaved(), [name]: at };
      fs.mkdirSync(path.dirname(this.deps.stateFile), { recursive: true });
      fs.writeFileSync(this.deps.stateFile, JSON.stringify({ lastSync: all }, null, 1));
    } catch (e) { log.warn('sync', 'last sync time not saved', { cause: errText(e), hint: 'check userData is writable; only the time shown after a restart is lost' }); }
  }
}

/** Wraps a chat manager's create (wiring.ts): a new chat reads the brain, so the remote's changes land first. `before`
 *  is bounded by DomainSync.beforeRead itself; its failure never stops the chat. */
export function syncBeforeCreate<A extends unknown[], R>(target: { create: (...a: A) => Promise<R> }, before: () => Promise<void>): void {
  const create = target.create.bind(target);
  target.create = async (...a: A) => { await before().catch(() => undefined); return create(...a); };
}
