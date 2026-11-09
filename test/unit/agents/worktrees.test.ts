// The folders a delegated chat may work in (src/main/agents/worktrees.ts, ADR 0083): the parent's folder or a worktree
// of the parent's repository, read from a real `git worktree list`; any other folder, and a folder of no repository,
// stays outside. A forged `.git/worktrees/<id>/gitdir` (empty, prunable, or pointing at another repository) adds nothing.

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { blockingChanges, listedWorktrees } from '../../../src/main/agents/worktrees';

const roots: string[] = [];
afterEach(() => { for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('worktrees', () => {
  it('reads only usable entries from the porcelain list', () => {
    const abs = path.resolve('/a/b'), other = path.resolve('/c');
    const out = [`worktree ${abs}`, 'HEAD 1', 'branch refs/heads/main', '', 'worktree ', 'HEAD 0', 'detached',
      'prunable gitdir file points to non-existent location', '', `worktree ${other}`, 'bare', '', 'worktree rel/x', '',
      `worktree ${path.resolve('/d')}`, 'HEAD 0', 'prunable', ''].join('\n');
    expect(listedWorktrees(out)).toEqual([abs]);
  });

  it('lets only a modified app-owned brain file through a brain baseline', () => {
    const status = [' M memory/records.json', 'M  memory/shared.md', 'MM agents/scout/memory.md', ''].join('\n');
    expect(blockingChanges(status, true)).toEqual([]);
    expect(blockingChanges(status, false)).toHaveLength(3);
    for (const line of [' M notes.md', '?? memory/records.json', ' D memory/records.json', 'R  a -> memory/records.json', 'UU memory/records.json', ' M agents/a/b/memory.md'])
      expect(blockingChanges([' M memory/records.json', line].join('\n'), true)).toEqual([line]);
  });

  it('lets the changelog and a command the app saved by itself through a brain baseline', () => {
    const status = [' M changelog.md', '?? changelog.md', '?? scripts/cmd-git-603c1ec1.ps1', '?? scripts/cmd-npm-0123abcd.sh', ''].join('\n');
    expect(blockingChanges(status, true)).toEqual([]);
    expect(blockingChanges(status, false)).toHaveLength(4);
    for (const line of ['?? scripts/backup.ps1', '?? scripts/cmd-git-603c1ec.ps1', '?? scripts/sub/cmd-git-603c1ec1.ps1', '?? scripts/cmd-git-603c1ec1.mjs',
      ' M scripts/cmd-git-603c1ec1.ps1', ' D changelog.md', '?? notes/changelog.md'])
      expect(blockingChanges([' M changelog.md', line].join('\n'), true)).toEqual([line]);
  });

  it('lets the open-threads note and the AI error/win logs through a brain baseline (#324)', () => {
    const status = [' M now.md', ' M ai-errors.md', 'M  ai-wins.md', '?? now.md', '?? ai-errors.md', ''].join('\n');
    expect(blockingChanges(status, true)).toEqual([]);
    expect(blockingChanges(status, false)).toHaveLength(5);
    for (const line of [' M notes/now.md', ' D now.md', ' M ai-errors.md.bak', 'R  x -> ai-errors.md', ' M ideas.md'])
      expect(blockingChanges([' M now.md', line].join('\n'), true)).toEqual([line]);
  });
});
