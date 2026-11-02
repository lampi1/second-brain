// The folders a delegated chat may work in (ADR 0083): its parent's folder, or one of the git worktrees of the parent's
// repository (`git worktree list`), so a Strategist in the main checkout can hand an Artisan the feature worktree it
// made, and a child in a worktree can send a Scout to read the main checkout. Anything else is outside: a child never
// leaves its parent's repository. `git worktree list` is not trusted as is: it echoes whatever a `.git/worktrees/<id>/
// gitdir` file says (a file any writer inside the repository can forge), so only an existing, non-prunable worktree
// whose own git common dir is the parent's counts. Used by agents/delegation.ts (agent_delegate's early check) and
// chats/manager.ts (the check at create, the one that counts), both fed by wiring.ts; pinned by
// test/unit/agents/worktrees.test.ts.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import type { ChatSummary, NewChat } from '../../shared/contract';
import type { AgentPolicy } from './tool-policy';
import { readLocal, writeLocal } from './local-store';
import path from 'node:path';
import { within } from './tool-policy';

const run = (cwd: string, args: string[]): Promise<string | null> => new Promise(resolve => {
  execFile('git', ['-c', 'protocol.allow=never', '-C', cwd, ...args], { timeout: 5000, windowsHide: true, env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: '' } }, (error, stdout) => resolve(error ? null : String(stdout)));
});
const isDir = (p: string): boolean => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const real = (p: string): string => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
/** Same path, compared as the file system sees it (links resolved; case-insensitive on Windows). */
const samePath = (a: string, b: string): boolean => {
  const x = real(a), y = real(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
};

/** The absolute git common dir of the repository at `cwd` (shared by all its worktrees), or null. */
export async function gitCommonDir(cwd: string): Promise<string | null> {
  if (!cwd || !path.isAbsolute(cwd) || !isDir(cwd)) return null;
  const out = await run(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const dir = out?.trim();
  return dir && path.isAbsolute(dir) ? dir : null;
}

/** The `worktree <path>` entries of `git worktree list --porcelain` that are worth checking: a non-empty absolute path,
 *  neither prunable nor bare. Exported for the tests. */
export function listedWorktrees(porcelain: string): string[] {
  const out: string[] = [];
  for (const block of porcelain.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const head = lines.find(l => l.startsWith('worktree '));
    if (!head) continue;
    const p = head.slice(9).trim();
    if (!p || !path.isAbsolute(p)) continue;
    if (lines.some(l => l === 'bare' || l === 'prunable' || l.startsWith('prunable '))) continue;
    out.push(path.resolve(p));
  }
  return out;
}

/** The git worktrees of the repository at `cwd`, main checkout included, each verified: an existing folder whose git
 *  common dir is `cwd`'s; none when `cwd` is no repository. With `target`, only the listed worktrees containing it. */
export async function gitWorktrees(cwd: string, target?: string): Promise<string[]> {
  const common = await gitCommonDir(cwd);
  if (!common) return [];
  const out = await run(cwd, ['worktree', 'list', '--porcelain']);
  if (out === null) return [];
  // Reuse knows the exact child folder. Verify only its containing listed worktree rather than spawning a Git
  // process per unrelated checkout: that fan-out can time out valid allocations on repositories with many trees.
  const candidates = listedWorktrees(out).filter(w => target === undefined || within(w, target));
  const checked = await Promise.all(candidates.map(async w => {
    if (!isDir(w)) return null;
    const own = await gitCommonDir(w);
    return own && samePath(own, common) ? w : null;
  }));
  return checked.filter((w): w is string => w !== null);
}

/** Whether `cwd` is inside the parent's folder or inside one of its repository's (verified) worktrees; outside the
 *  parent's folder, only an existing folder counts. */
export function withinParent(parentCwd: string, cwd: string, worktrees: readonly string[]): boolean {
  if (within(parentCwd, cwd)) return true;
  if (!isDir(cwd)) return false;
  return worktrees.some(w => !!w && path.isAbsolute(w) && within(w, cwd));
}


/** A writer is determined by its final narrowed tool classes, never the role's display name. Unknown policies and
 * external MCP tools can write; plan mode alone does not make those external tools read-only. */
export function needsIsolatedWorktree(policy: AgentPolicy | null): boolean {
  return !policy?.tools || policy.tools.allow.some(c => ['edit', 'shell', 'brain-write', 'mcp'].includes(c));
}

/** Shell-free git invocation; hooks never run during app-owned worktree creation/integration. */
export function worktreeGit(cwd: string, args: string[], input?: string): Promise<{ exit: number | null; out: string; error?: string }> {
  return new Promise(resolve => {
    const base = ['--no-optional-locks', '-c', `core.hooksPath=${os.devNull}`, '-c', 'core.fsmonitor=false', '-c', 'submodule.recurse=false', '-c', 'protocol.allow=never', '-C', cwd];
    const options = { timeout: 30_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: '' } };
    // Checkout and apply can invoke configured filters even with hooks disabled. Read their names without executing
    // them and override every driver for host commands; agent check sessions retain the repository's normal policy.
    execFile('git', [...base, 'config', '--no-includes', '--null', '--name-only', '--get-regexp', '^(.*\\.(promisor|partialclone|partialclonefilter)|include\\.path|includeif\\..*\\.path|filter\\..*\\.(clean|smudge|process|required)|merge\\..*\\.driver)$'], options, (configError, configured) => {
      if (configError && configError.code !== 1) { resolve({ exit: null, out: '' }); return; }
      const keys = String(configured).split('\0').filter(Boolean);
      if (keys.some(key => /\.(promisor|partialclone|partialclonefilter)$/i.test(key))) { resolve({ exit: null, out: '', error: 'Partial/promisor repository configuration could fetch missing objects; host isolation/integration is blocked.' }); return; }
      if (keys.some(key => /^include(?:if\..*)?\.path$/i.test(key))) { resolve({ exit: null, out: '', error: 'Repository configuration includes external or conditional files; host isolation/integration is blocked.' }); return; }
      if (keys.some(key => /^merge\..*\.driver$/.test(key))) { resolve({ exit: null, out: '', error: 'Repository has a configured custom merge driver; host isolation/integration is blocked.' }); return; }
      if (keys.length > 512 || keys.some(key => /[\r\n]/.test(key) || !/^filter\..*\.(clean|smudge|process|required)$/.test(key))) { resolve({ exit: null, out: '' }); return; }
      const drivers = [...new Set(keys.map(key => key.replace(/\.(clean|smudge|process|required)$/, '')))];
      const disabled = drivers.flatMap(driver => ['-c', `${driver}.clean=`, '-c', `${driver}.smudge=`, '-c', `${driver}.process=`, '-c', `${driver}.required=false`]);
      const child = execFile('git', [...base, ...disabled, ...args], options, (error, stdout) => {
        resolve({ exit: error ? typeof error.code === 'number' ? error.code : null : 0, out: String(stdout) });
      });
      child.stdin?.on('error', () => {});
      child.stdin?.end(input);
    });
  });
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

/** Real repository identity, pinned commit and clean state. A dirty baseline is never silently omitted, except the
 *  app-owned brain files when the checkout is `brainRoot` (see APP_OWNED_BRAIN). */
export async function cleanRepository(cwd: string, brainRoot?: string | null): Promise<{ root: string; common: string; head: string }> {
  const common = await gitCommonDir(cwd);
  if (!common) throw new Error('Writing delegation requires a Git repository with a commit; no shared-folder fallback.');
  const root = await requiredGit(cwd, ['rev-parse', '--show-toplevel']);
  if (!path.isAbsolute(root) || !samePath(await requiredGit(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']), common)) throw new Error('Repository identity could not be verified.');
  const head = await requiredGit(root, ['rev-parse', '--verify', 'HEAD^{commit}']);
  if (!/^[a-f0-9]{40,64}$/.test(head)) throw new Error('Repository has no valid committed baseline.');
  // untrimmed: requiredGit's trim would eat the first line's leading status column
  const status = await worktreeGit(root, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (status.exit !== 0) throw new Error(status.error ?? 'Git could not verify or prepare the isolated worktree; no child was started.');
  const blocking = blockingChanges(status.out, !!brainRoot && samePath(root, brainRoot));
  // the first paths name what to commit or preserve: the agent cannot tell an app-written file from the user's otherwise
  if (blocking.length) throw new Error(`Repository has uncommitted or untracked changes. Commit or preserve them before delegating; the app will not discard or silently omit them. Blocking: ${blocking.slice(0, 5).map(l => l.slice(3)).join(', ')}${blocking.length > 5 ? ', …' : ''}`);
  return { root: real(root), common: real(common), head };
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
}

/** A new sibling worktree, always outside the source checkout and on a unique branch (or detached for integration). */
export async function createIsolatedWorktree(source: { root: string; common: string; head: string }, purpose: 'delegate' | 'integration'): Promise<{ root: string; branch: string }> {
  // mkdtemp creates the destination atomically; its parent is outside every source file tracked by Git.
  const root = fs.mkdtempSync(path.join(path.dirname(source.root), `.second-brain-${purpose}-`));
  const branch = purpose === 'delegate' ? `sb/delegate-${randomUUID()}` : '';
  await requiredGit(source.root, ['worktree', 'add', ...(branch ? ['-b', branch] : ['--detach']), root, source.head]);
  const created = await cleanRepository(root);
  if (!samePath(created.root, root) || !samePath(created.common, source.common) || created.head !== source.head || samePath(root, source.root)) throw new Error('Isolated worktree verification failed; shared checkout was not used.');
  return { root: real(root), branch };
}

/** Production ChatManager calls prepare after computing its final policy and before starting any engine. App-owned
 * provenance is persisted separately from agent-editable roles/instructions, and bound to the actual created chat. */
export class DelegateWorktrees {
  private readonly allocations = new Map<string, IsolatedDelegation>();

  constructor(private readonly file?: string, private readonly brainRoot: () => string | null = () => null) {
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
      && path.basename(v.root).startsWith('.second-brain-delegate-') && within(v.root, v.cwd)
      && typeof v.branch === 'string' && /^sb\/delegate-[a-f0-9-]{36}$/.test(v.branch) && typeof v.base === 'string' && /^[a-f0-9]{40,64}$/.test(v.base);
  }

  prepare = async (parent: ChatSummary, req: NewChat, policy: AgentPolicy | null, continuationOf?: string): Promise<{ cwd: string; parentRunId: string | undefined; parentTaskVersion: number | undefined; bind?: (childId: string) => void }> => {
    const provenance = { parentRunId: parent.run?.runId, parentTaskVersion: parent.run?.taskVersion };
    const cwd = req.cwd;
    if (!needsIsolatedWorktree(policy)) return { cwd, ...provenance };
    // One checkout is verified once: each Git spawn costs up to seconds on Windows with real-time antivirus scanning.
    const brain = this.brainRoot();
    const parentRepo = await cleanRepository(parent.cwd, brain), source = samePath(parent.cwd, cwd) ? parentRepo : await cleanRepository(cwd, brain);
    if (!samePath(parentRepo.common, source.common)) throw new Error('Writing delegation cannot leave its parent repository.');
    let base = source.head;
    if (continuationOf !== undefined) {
      const previous = this.allocation(parent, { id: continuationOf, parentId: parent.id, cwd } as ChatSummary);
      if (previous.common !== source.common || !samePath(previous.root, source.root)
        || await requiredGit(source.root, ['symbolic-ref', '--short', 'HEAD']) !== previous.branch
        || (await worktreeGit(source.root, ['merge-base', '--is-ancestor', previous.base, source.head])).exit !== 0) throw new Error('Continuation source no longer matches its original isolated baseline.');
      base = previous.base;
    }
    const relative = path.relative(source.root, real(cwd));
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Delegation folder is outside the repository.');
    const isolated = await createIsolatedWorktree(source, 'delegate');
    const childCwd = path.join(isolated.root, relative);
    if (!isDir(childCwd) || !within(isolated.root, childCwd)) throw new Error('Requested project folder is absent from the committed isolated worktree.');
    // Detect source edits made during checkout; do not launch on a stale baseline.
    // status and HEAD are checkout-wide: the parent's folder in the same checkout needs no second probe
    const after = await cleanRepository(source.root, brain), parentAfter = samePath(parentRepo.root, source.root) ? after : await cleanRepository(parent.cwd, brain);
    if (after.head !== source.head || parentAfter.head !== parentRepo.head) throw new Error('Repository changed while preparing isolation; retry delegation.');
    return { cwd: childCwd, ...provenance, bind: childId => {
      const owned: IsolatedDelegation = { childId, parentId: parent.id, ...provenance, parentCwd: parent.cwd,
        common: source.common, root: isolated.root, cwd: childCwd, branch: isolated.branch, base };
      if (!this.valid(owned)) throw new Error('Invalid host-owned isolation provenance.');
      const next = new Map(this.allocations); next.set(real(childCwd), owned);
      if (this.file) writeLocal(this.file, [...next.values()]);
      this.allocations.set(real(childCwd), owned);
    } };
  };

  allocation(parent: ChatSummary, child: ChatSummary): IsolatedDelegation {
    const owned = this.allocations.get(real(child.cwd));
    if (!owned || owned.childId !== child.id || child.parentId !== parent.id || owned.parentId !== parent.id || owned.parentRunId !== parent.run?.runId
      || owned.parentTaskVersion !== parent.run?.taskVersion || !samePath(owned.parentCwd, parent.cwd)) throw new Error('No host-owned isolated worktree for this parent assignment; delegate a fresh child.');
    return { ...owned };
  }
}
