// The folder a chat works in (src/main/agents/worktrees.ts, ADR 0360): any existing one, and the one refusal; and what blocks a writing child's baseline in the
// brain folder (the app-owned files do not, #324).

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import os from 'node:os';
import { blockingChanges, folderProblem } from '../../../src/main/agents/worktrees';

const roots: string[] = [];
afterEach(() => { for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('worktrees', () => {
  it('any existing folder is fine; the only refusal names the folder and why (ADR 0360)', () => {
    const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-folders-')); roots.push(outer);
    const repo = path.join(outer, 'repo');
    fs.mkdirSync(repo);
    expect(folderProblem(repo)).toBeNull();
    expect(folderProblem(outer)).toBeNull();
    expect(folderProblem(path.join(outer, 'missing'))).toBe(`Cartella non valida: ${path.join(outer, 'missing')}: non esiste.`);
    expect(folderProblem('other')).toMatch(/other: serve un percorso assoluto/);
    expect(folderProblem('')).toMatch(/vuota/);
    fs.writeFileSync(path.join(outer, 'file.txt'), 'x');
    expect(folderProblem(path.join(outer, 'file.txt'))).toMatch(/file\.txt: è un file, non una cartella/);
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
