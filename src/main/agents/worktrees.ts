// The folder a chat works in (ADR 0358): whoever opens it names any existing folder (folderProblem is the only refusal)
// and how: `here`, in that folder itself (the default: nothing is copied, uncommitted changes are only said), or `copy`,
// an isolated worktree of the folder's repository, made only when asked. The folder is no permission: tool classes and
// the ceiling still only go down (agents/tool-policy.ts). Used by agents/delegation.ts and appctl/tools.ts (the early
// check) and chats/manager.ts (the check at create, the one that counts). A copy comes from DelegateWorktrees.prepare: a
// reused slot of the repository's pool (worktree-pool.ts, ADR 0227) or a new one, with one GitSession per prepare (the
// filter policy read once per folder, spawns counted) and each step's ms logged as 'delegation worktree ready'.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import type { ChatSummary, NewChat } from '../../shared/contract';
import type { AgentPolicy } from './tool-policy';
import { readLocal, writeLocal } from './local-store';
import path from 'node:path';
import { within } from './tool-policy';
import type { WorktreePool } from './worktree-pool';
import { log } from '../log';

const isDir = (p: string): boolean => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const real = (p: string): string => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
/** Same path, compared as the file system sees it (links resolved; case-insensitive on Windows). */
const samePath = (a: string, b: string): boolean => {
  const x = real(a), y = real(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
};

/** Why a chat may not work in a folder, naming it (ADR 0358); null = it may. The only refusal about a folder. */
export function folderProblem(cwd: unknown): string | null {
  const f = typeof cwd === 'string' ? cwd.trim() : '';
  if (!f) return 'Cartella non valida: (vuota).';
  if (!path.isAbsolute(f)) return `Cartella non valida: ${f}: serve un percorso assoluto.`;
  let st: fs.Stats;
  try { st = fs.statSync(f); } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return `Cartella non valida: ${f}: ${code === 'ENOENT' || code === 'ENOTDIR' ? 'non esiste' : `non è accessibile (${code ?? 'errore'})`}.`;
  }
  if (!st.isDirectory()) return `Cartella non valida: ${f}: è un file, non una cartella.`;
  try { fs.readdirSync(f); } catch (e) { return `Cartella non valida: ${f}: non è accessibile (${(e as NodeJS.ErrnoException).code ?? 'errore'}).`; }
  return null;
}

/** Same folder as the file system sees it. */
export const sameFolder = (a: string, b: string): boolean => samePath(a, b);
/** One folder is the other or inside it: two chats that write there can touch the same files. */
export const overlapping = (a: string, b: string): boolean => within(real(a), real(b)) || within(real(b), real(a));

/** A writer is determined by the tool classes its part needs (the contract's), never the role's display name. Unknown policies and
 * external MCP tools can write; plan mode alone does not make those external tools read-only. */
export function needsIsolatedWorktree(policy: AgentPolicy | null): boolean {
  return !policy?.tools || policy.tools.allow.some(c => ['edit', 'shell', 'brain-write', 'mcp'].includes(c));
}

export type GitResult = { exit: number | null; out: string; error?: string };
const gitBase = (cwd: string): string[] => ['--no-optional-locks', '-c', `core.hooksPath=${os.devNull}`, '-c', 'core.fsmonitor=false', '-c', 'submodule.recurse=false', '-c', 'protocol.allow=never', '-C', cwd];
const gitOptions = (timeout = 30_000) => ({ timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: '' } });

/** The repository's host policy for `cwd`: the overrides that disable every configured filter driver, or why host git
 *  must not run there at all. One git spawn; read without executing anything the configuration names. */
function gitPolicy(cwd: string): Promise<{ flags: string[] } | { blocked: GitResult }> {
  return new Promise(resolve => {
    // Checkout and apply can invoke configured filters even with hooks disabled. Read their names without executing
    // them and override every driver for host commands; agent check sessions retain the repository's normal policy.
    execFile('git', [...gitBase(cwd), 'config', '--no-includes', '--null', '--name-only', '--get-regexp', '^(.*\\.(promisor|partialclone|partialclonefilter)|include\\.path|includeif\\..*\\.path|filter\\..*\\.(clean|smudge|process|required)|merge\\..*\\.driver)$'], gitOptions(), (configError, configured) => {
      const no = (error?: string): void => resolve({ blocked: { exit: null, out: '', ...(error ? { error } : {}) } });
      if (configError && configError.code !== 1) { no(); return; }
      const keys = String(configured).split('\0').filter(Boolean);
      if (keys.some(key => /\.(promisor|partialclone|partialclonefilter)$/i.test(key))) { no('Partial/promisor repository configuration could fetch missing objects; host isolation/integration is blocked.'); return; }
      if (keys.some(key => /^include(?:if\..*)?\.path$/i.test(key))) { no('Repository configuration includes external or conditional files; host isolation/integration is blocked.'); return; }
      if (keys.some(key => /^merge\..*\.driver$/.test(key))) { no('Repository has a configured custom merge driver; host isolation/integration is blocked.'); return; }
      if (keys.length > 512 || keys.some(key => /[\r\n]/.test(key) || !/^filter\..*\.(clean|smudge|process|required)$/.test(key))) { no(); return; }
      const drivers = [...new Set(keys.map(key => key.replace(/\.(clean|smudge|process|required)$/, '')))];
      resolve({ flags: drivers.flatMap(driver => ['-c', `${driver}.clean=`, '-c', `${driver}.smudge=`, '-c', `${driver}.process=`, '-c', `${driver}.required=false`]) });
    });
  });
}

function gitWith(cwd: string, flags: string[], args: string[], input?: string, timeout?: number): Promise<GitResult> {
  return new Promise(resolve => {
    const child = execFile('git', [...gitBase(cwd), ...flags, ...args], gitOptions(timeout), (error, stdout) => {
      resolve({ exit: error ? typeof error.code === 'number' ? error.code : null : 0, out: String(stdout) });
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
  });
}

/** Shell-free git invocation; hooks never run during app-owned worktree creation/integration. */
export async function worktreeGit(cwd: string, args: string[], input?: string, timeout?: number): Promise<GitResult> {
  const policy = await gitPolicy(cwd);
  return 'blocked' in policy ? policy.blocked : gitWith(cwd, policy.flags, args, input, timeout);
}

/** worktreeGit for one short operation (a delegation's prepare): the policy of each checkout is read once and reused by
 *  the operation's next commands there. Measured 2026-11-07: each git spawn cost 0.9-6 s on the owner's PC (antivirus,
 *  load) and a prepare made 29 of them (ADR 0227). */
export class GitSession {
  private readonly policies = new Map<string, Promise<{ flags: string[] } | { blocked: GitResult }>>();
  /** the git spawns this session made (the prepare log reports them) */
  spawns = 0;
  async git(cwd: string, args: string[], timeout?: number): Promise<GitResult> {
    const key = process.platform === 'win32' ? path.resolve(cwd).toLowerCase() : path.resolve(cwd);
    let policy = this.policies.get(key);
    if (!policy) { this.spawns++; policy = gitPolicy(cwd); this.policies.set(key, policy); }
    const p = await policy;
    if ('blocked' in p) return p.blocked;
    this.spawns++;
    return gitWith(cwd, p.flags, args, undefined, timeout);
  }
  async required(cwd: string, args: string[]): Promise<string> {
    const result = await this.git(cwd, args);
    if (result.exit !== 0) throw new Error(result.error ?? 'Git could not verify or prepare the isolated worktree; no child was started.');
    return result.out.trim();
  }
}

export async function requiredGit(cwd: string, args: string[]): Promise<string> {
  const result = await worktreeGit(cwd, args);
  if (result.exit !== 0) throw new Error(result.error ?? 'Git could not verify or prepare the isolated worktree; no child was started.');
  return result.out.trim();
}

/** The brain files the app itself rewrites at any moment (the memory store and the notes derived from it, the brain's
 *  changelog, the open-threads note and the AI error/win logs the brain rules make agents update at once through the
 *  app's CLI, rules/memory.ts), never the user's work: a pending edit to them alone does not block a delegation started
 *  in the brain folder (a Cursor Scout was refused on memory/records.json, then Cursor and OpenCode on changelog.md, then
 *  Strategist and Sentinel on now.md and ai-errors.md, #324). The child's worktree holds their committed version; agents
 *  read memory and the changelog through the app's tools. */
const APP_OWNED_BRAIN = /^(?:memory\/records\.json|memory\/shared\.md|agents\/[^/]+\/memory\.md|changelog\.md|now\.md|ai-errors\.md|ai-wins\.md)$/;
/** New files only the app creates in the brain: the changelog, the open-threads note and the AI error/win logs on their
 *  first entry, and a command saved by itself after
 *  an «Esegui» run (auto-scripts.ts scriptNameOf: cmd-<command name>-<8 hex>.ps1|sh, directly in scripts/). The parent
 *  keeps them untouched; the child simply does not see them. Any other untracked file still blocks. */
const APP_CREATED_BRAIN = /^(?:changelog\.md|now\.md|ai-errors\.md|ai-wins\.md|scripts\/cmd-[a-z0-9-]{1,24}-[a-f0-9]{8}\.(?:ps1|sh))$/;

/** The `git status --porcelain=v1` lines that block a baseline. With appOwned (the checkout is the brain folder), a
 *  tracked app-owned file that is only modified, and an untracked app-created file, are left out; other additions,
 *  deletions, renames, conflicts, untracked and quoted paths always block. Exported for the tests. */
export function blockingChanges(porcelain: string, appOwned: boolean): string[] {
  return porcelain.split(/\r?\n/).filter(l => l.length > 3)
    .filter(l => !(appOwned && ((/^(?: M|M |MM) /.test(l) && APP_OWNED_BRAIN.test(l.slice(3)))
      || (l.startsWith('?? ') && APP_CREATED_BRAIN.test(l.slice(3))))));
}

/** A checkout as git names it: its top folder, its repository (the common dir its worktrees share) and its commit. */
type Checkout = { root: string; common: string; head: string };

/** The folder is no Git repository with a commit, or one the host policy refuses to run git in (gitPolicy: the
 *  refusal is the repository's own configuration, so every checkout of it gets the same one). Any other failure of
 *  git (a timeout, a crash) is a plain Error: a repository that could not be read is never taken for a missing one. */
class NoRepository extends Error {}
const NO_REPOSITORY = 'Writing delegation requires a Git repository with a commit; no shared-folder fallback.';

/** Real repository identity and pinned commit, read by one rev-parse: the three come from the same git process, so they
 *  cannot disagree (before 2026-11-07 four separate spawns, each 1-6 s under load). Paths as git prints them. */
async function repositoryIdentity(cwd: string, session: GitSession): Promise<Checkout> {
  if (!cwd || !path.isAbsolute(cwd) || !isDir(cwd)) throw new NoRepository(NO_REPOSITORY);
  const ids = await session.git(cwd, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir', 'HEAD^{commit}']);
  if (ids.error) throw new NoRepository(ids.error);
  // 128 is git's own fatal «not a repository» (or no commit yet); a killed or otherwise failed git says nothing about it
  if (ids.exit === 128) throw new NoRepository(NO_REPOSITORY);
  if (ids.exit !== 0) throw new Error(`Git could not read the repository at ${cwd}; no child was started. Retry the delegation.`);
  const [root = '', common = '', head = ''] = ids.out.split(/\r?\n/).map(l => l.trim());
  if (!common || !path.isAbsolute(common)) throw new Error(NO_REPOSITORY);
  if (!root || !path.isAbsolute(root)) throw new Error('Repository identity could not be verified.');
  if (!/^[a-f0-9]{40,64}$/.test(head)) throw new Error('Repository has no valid committed baseline.');
  return { root, common, head };
}

/** The clean state of an identified checkout. A dirty baseline is never silently omitted, except the app-owned brain
 *  files when the checkout is `brainRoot` (see APP_OWNED_BRAIN). Returns it with its links resolved. */
async function requireClean({ root, common, head }: Checkout, brainRoot: string | null | undefined, session: GitSession): Promise<Checkout> {
  // untrimmed: requiredGit's trim would eat the first line's leading status column. `normal` names an untracked folder
  // once instead of walking it (a new untracked folder still blocks, by its name)
  const status = await session.git(root, ['status', '--porcelain=v1', '--untracked-files=normal']);
  if (status.exit !== 0) throw new Error(status.error ?? 'Git could not verify or prepare the isolated worktree; no child was started.');
  const blocking = blockingChanges(status.out, !!brainRoot && samePath(root, brainRoot));
  // the first paths name what to commit or preserve: the agent cannot tell an app-written file from the user's otherwise
  if (blocking.length) throw new Error(`Repository has uncommitted or untracked changes. Commit or preserve them before delegating; the app will not discard or silently omit them. Blocking: ${blocking.slice(0, 5).map(l => l.slice(3)).join(', ')}${blocking.length > 5 ? ', …' : ''}`);
  return { root: real(root), common: real(common), head };
}

/** Real repository identity, pinned commit and clean state. */
export async function cleanRepository(cwd: string, brainRoot?: string | null, session = new GitSession()): Promise<Checkout> {
  return requireClean(await repositoryIdentity(cwd, session), brainRoot, session);
}

/** Provenance held by the host, not accepted from a tool argument, role instruction or mutable agent profile. */
export interface IsolatedDelegation {
  childId: string;
  parentId: string;
  parentRunId: string | undefined;
  parentCwd: string;
  parentTaskVersion: number | undefined;
  common: string;
  root: string;
  cwd: string;
  branch: string;
  base: string;
  /** only for a child of another repository than its parent's (ADR 0345): the checkout it was branched from, where its
   *  changes are staged (delegation-integration.ts); absent = the parent's repository */
  sourceRoot?: string;
}

/** A new sibling worktree, always outside the source checkout and on a unique branch (or detached for integration). */
export async function createIsolatedWorktree(source: { root: string; common: string; head: string }, purpose: 'delegate' | 'integration', session = new GitSession()): Promise<{ root: string; branch: string }> {
  // mkdtemp creates the destination atomically; its parent is outside every source file tracked by Git.
  const root = fs.mkdtempSync(path.join(path.dirname(source.root), `.second-brain-${purpose}-`));
  const branch = purpose === 'delegate' ? `sb/delegate-${randomBytes(6).toString('hex')}` : '';
  // a whole checkout: 72 s measured under load (2026-11-07), past the 30 s of a short command
  const add = await session.git(source.root, ['worktree', 'add', ...(branch ? ['-b', branch] : ['--detach']), root, source.head], 10 * 60_000);
  if (add.exit !== 0) throw new Error(add.error ?? 'Git could not verify or prepare the isolated worktree; no child was started.');
  const created = await cleanRepository(root, null, session);
  if (!samePath(created.root, root) || !samePath(created.common, source.common) || created.head !== source.head || samePath(root, source.root)) throw new Error('Isolated worktree verification failed; shared checkout was not used.');
  return { root: real(root), branch };
}

/** Production ChatManager calls prepare after computing its final policy and before starting any engine. App-owned
 * provenance is persisted separately from agent-editable roles/instructions, and bound to the actual created chat. */
export class DelegateWorktrees {
  private readonly allocations = new Map<string, IsolatedDelegation>();

  /** `pool` (ADR 0227): writing children get a reused worktree of the repository's pool; none = a new one each time */
  constructor(private readonly file?: string, private readonly brainRoot: () => string | null = () => null, private readonly pool?: WorktreePool) {
    const stored = file ? readLocal(file) : undefined;
    if (stored === undefined) return;
    if (!Array.isArray(stored) || stored.length > 10_000 || stored.some(v => !this.valid(v))) throw new Error('Invalid delegation isolation provenance; original file preserved.');
    for (const owned of stored as IsolatedDelegation[]) this.allocations.set(real(owned.cwd), owned);
  }

  private valid(value: unknown): value is IsolatedDelegation {
    const v = value as IsolatedDelegation | null;
    return !!v && typeof v === 'object' && typeof v.childId === 'string' && !!v.childId && typeof v.parentId === 'string' && !!v.parentId
      && (v.parentRunId === undefined || typeof v.parentRunId === 'string') && (v.parentTaskVersion === undefined || (Number.isSafeInteger(v.parentTaskVersion) && v.parentTaskVersion > 0))
      && [v.parentCwd, v.common, v.root, v.cwd].every(p => typeof p === 'string' && path.isAbsolute(p))
      && (v.sourceRoot === undefined || (typeof v.sourceRoot === 'string' && path.isAbsolute(v.sourceRoot)))
      && path.basename(v.root).startsWith('.second-brain-delegate-') && within(v.root, v.cwd)
      // 12 hex since the pool (guard-safe), a UUID before it: worktree-pool.ts POOL_BRANCH
      && typeof v.branch === 'string' && /^sb\/delegate-(?:[a-f0-9]{12}|[a-f0-9-]{36})$/.test(v.branch) && typeof v.base === 'string' && /^[a-f0-9]{40,64}$/.test(v.base);
  }

  /** A child that works in a worktree made for it: its changes are integrated; any other child's are already in its folder. */
  isolated = (child: Pick<ChatSummary, 'id' | 'cwd'>): boolean => this.allocations.get(real(child.cwd))?.childId === child.id;

  /** What a chat that writes in place must know of its folder: the changes nobody committed. Nothing is touched, and a
   *  folder git cannot read says nothing. */
  private async uncommitted(cwd: string): Promise<string[]> {
    const s = await new GitSession().git(cwd, ['status', '--porcelain=v1', '--untracked-files=normal']).catch(() => null);
    const lines = s?.exit === 0 ? blockingChanges(s.out, false) : [];
    if (!lines.length) return [];
    return [`La cartella ${cwd} ha ${lines.length} ${lines.length === 1 ? 'modifica non committata' : 'modifiche non committate'} (${lines.slice(0, 5).map(l => l.slice(3)).join(', ')}${lines.length > 5 ? ', …' : ''}). Restano dove sono: non perderle, non spostarle, niente stash, checkout, reset o clean su di loro.`];
  }

  prepare = async (parent: ChatSummary, req: NewChat, policy: AgentPolicy | null, continuationOf?: string, inherit?: boolean): Promise<{ cwd: string; parentRunId: string | undefined; parentTaskVersion: number | undefined; notes?: string[]; isolated?: boolean; bind?: (childId: string) => void }> => {
    const provenance = { parentRunId: parent.run?.runId, parentTaskVersion: parent.run?.taskVersion };
    const cwd = req.cwd;
    if (!needsIsolatedWorktree(policy)) return { cwd, ...provenance };
    // a chat that goes on in its own worktree keeps it, with its base and its branch: no second copy. inherit (ADR 0354): a
    // chat stopped on its credit limit goes on in a successor on another engine with the same worktree, uncommitted
    // changes included; the predecessor works no more (its process ends), so one writer
    const kept = continuationOf === undefined ? undefined : this.allocations.get(real(cwd));
    if (kept && kept.childId === continuationOf) {
      if (!isDir(kept.cwd)) throw new Error('The worktree of the chat to continue is gone; delegate a fresh child.');
      return { cwd: kept.cwd, ...provenance, isolated: true, notes: inherit ? [] : await this.uncommitted(cwd), bind: childId => {
        const owned: IsolatedDelegation = inherit ? { ...kept, childId } : { ...kept, childId, ...provenance, parentId: parent.id, parentCwd: parent.cwd };
        if (!this.valid(owned)) throw new Error('Invalid host-owned isolation provenance.');
        const next = new Map(this.allocations); next.set(real(cwd), owned);
        if (this.file) writeLocal(this.file, [...next.values()]);
        this.allocations.set(real(cwd), owned);
      } };
    }
    // in the folder itself (ADR 0358): nothing is copied, nothing is refused
    if (req.place !== 'copy') return { cwd, ...provenance, notes: await this.uncommitted(cwd) };
    // One checkout is verified once, through one session (each checkout's policy read once): each Git spawn costs up to
    // seconds on Windows with real-time antivirus scanning (ADR 0227 measured the steps)
    const brain = this.brainRoot(), session = new GitSession(), t0 = Date.now();
    // the folder names the repository; the parent's own checkout is never read for its state, only to know whether it is
    // the same repository (where the copy's changes are staged, delegation-integration.ts). A git that failed there is no
    // reason to refuse: the copy is then staged in its own checkout
    const sourceId = await repositoryIdentity(cwd, session);
    const parentId = samePath(parent.cwd, cwd) ? sourceId : await repositoryIdentity(parent.cwd, session).catch((e: unknown) => { if (e instanceof NoRepository) return null; throw e; });
    const sameRepo = !!parentId && samePath(parentId.common, sourceId.common);
    const source = await requireClean(sourceId, brain, session), base = source.head, sourceRoot = source.root;
    const relative = path.relative(source.root, real(cwd));
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Delegation folder is outside the repository.');
    const t1 = Date.now();
    const isolated = this.pool ? await this.pool.take(source, session) : { ...await createIsolatedWorktree(source, 'delegate', session), reused: false };
    const t2 = Date.now();
    try {
      if (samePath(isolated.root, source.root)) throw new Error('Isolated worktree verification failed; shared checkout was not used.');
      const childCwd = path.join(isolated.root, relative);
      if (!isDir(childCwd) || !within(isolated.root, childCwd)) throw new Error('Requested project folder is absent from the committed isolated worktree.');
      // Detect source edits made during checkout; do not launch on a stale baseline. A fresh session: the checks must
      // read the checkout now
      const again = new GitSession();
      const after = await cleanRepository(source.root, brain, again);
      if (after.head !== source.head) throw new Error('Repository changed while preparing isolation; retry delegation.');
      log.info('agents', 'delegation worktree ready', { data: { reused: isolated.reused, statusMs: t1 - t0, takeMs: t2 - t1, verifyMs: Date.now() - t2, spawns: session.spawns + again.spawns } });
      return { cwd: childCwd, ...provenance, isolated: true, bind: childId => {
        const owned: IsolatedDelegation = { childId, parentId: parent.id, ...provenance, parentCwd: parent.cwd,
          common: source.common, root: isolated.root, cwd: childCwd, branch: isolated.branch, base, ...(sameRepo ? {} : { sourceRoot }) };
        if (!this.valid(owned)) throw new Error('Invalid host-owned isolation provenance.');
        // a reused slot belongs to this child only: an earlier child's record of the same worktree goes
        const next = new Map([...this.allocations].filter(([, a]) => !samePath(a.root, isolated.root))); next.set(real(childCwd), owned);
        if (this.file) writeLocal(this.file, [...next.values()]);
        this.allocations.clear();
        for (const [k, v] of next) this.allocations.set(k, v);
        this.pool?.release(isolated.root);
      } };
    } catch (e) { this.pool?.release(isolated.root); throw e; }
  };

  /** Why an archived child may not be reopened (null = it may): its worktree now belongs to another child, or the
   *  cleanup removed it. Reopening would run it on someone else's checkout, or nowhere. */
  reopenBlocked = (chat: ChatSummary): string | null => {
    const owned = this.allocations.get(real(chat.cwd));
    if (owned?.childId === chat.id) return isDir(chat.cwd) ? null : 'This delegated chat\'s worktree was cleaned up; delegate a fresh child.';
    if (owned || this.pool?.slotOf(chat.cwd)) return 'This delegated chat\'s worktree now belongs to another delegated chat; delegate a fresh child.';
    return null;
  };

  /** The app-owned worktrees the allocations name (the pool's cleanup counts them as the app's). */
  allocatedRoots(): { root: string; common: string }[] {
    return [...this.allocations.values()].map(a => ({ root: a.root, common: a.common }));
  }

  allocation(parent: ChatSummary, child: ChatSummary): IsolatedDelegation {
    const owned = this.allocations.get(real(child.cwd));
    if (!owned || owned.childId !== child.id || child.parentId !== parent.id || owned.parentId !== parent.id || owned.parentRunId !== parent.run?.runId
      || owned.parentTaskVersion !== parent.run?.taskVersion || !samePath(owned.parentCwd, parent.cwd)) throw new Error('No host-owned isolated worktree for this parent assignment; delegate a fresh child.');
    return { ...owned };
  }
}
