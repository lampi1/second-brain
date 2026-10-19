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
import path from 'node:path';
import { within } from './tool-policy';

const run = (cwd: string, args: string[]): Promise<string | null> => new Promise(resolve => {
  execFile('git', ['-C', cwd, ...args], { timeout: 5000, windowsHide: true }, (error, stdout) => resolve(error ? null : String(stdout)));
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
 *  common dir is `cwd`'s; none when `cwd` is no repository. */
export async function gitWorktrees(cwd: string): Promise<string[]> {
  const common = await gitCommonDir(cwd);
  if (!common) return [];
  const out = await run(cwd, ['worktree', 'list', '--porcelain']);
  if (out === null) return [];
  const checked = await Promise.all(listedWorktrees(out).map(async w => {
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
