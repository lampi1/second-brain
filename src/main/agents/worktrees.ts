// The folders a delegated chat may work in (ADR 0083): its parent's folder, or one of the git worktrees of the parent's
// repository (`git worktree list`), so a Strategist in the main checkout can hand an Artisan the feature worktree it
// made, and a child in a worktree can send a Scout to read the main checkout. Anything else is outside: a child never
// leaves its parent's repository. Used by agents/delegation.ts (agent_delegate's early check) and chats/manager.ts
// (the check at create, the one that counts), both fed by wiring.ts; pinned by test/unit/agents/worktrees.test.ts.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { within } from './tool-policy';

/** The git worktrees of the repository at `cwd`, main checkout included; none when it is no repository. */
export function gitWorktrees(cwd: string): Promise<string[]> {
  return new Promise(resolve => {
    execFile('git', ['-C', cwd, 'worktree', 'list', '--porcelain'], { timeout: 5000, windowsHide: true }, (error, stdout) => {
      if (error) { resolve([]); return; }
      resolve(String(stdout).split(/\r?\n/).filter(l => l.startsWith('worktree ')).map(l => path.resolve(l.slice(9).trim())));
    });
  });
}

/** Whether `cwd` is inside the parent's folder or inside one of its repository's worktrees. */
export function withinParent(parentCwd: string, cwd: string, worktrees: readonly string[]): boolean {
  return within(parentCwd, cwd) || worktrees.some(w => path.isAbsolute(w) && within(w, cwd));
}
