// "Compare with HEAD" without a usable git (regression of PR #26): when git cannot be started (not installed, not on
// PATH: e.g. a GitHub Desktop user, whose git is bundled), main/file-diff.ts says so (reason 'git': "git could not read
// that version.") instead of "Commit or branch not found.", and works again once git is there.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {readFileDiff} from '../../../src/main/file-diff';

const temporary: string[] = [];
const savedPath = process.env.PATH;
afterEach(() => { process.env.PATH = savedPath; for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-C', cwd, ...args], { encoding: 'utf8' }).trim();

it('Compare with HEAD without a usable git does not claim the commit is missing, and retries after installation', async () => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-review-nogit-'))); temporary.push(dir);
  git(dir, 'init', '-q', '-b', 'main'); fs.writeFileSync(path.join(dir, 'a.ts'), 'one\n'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'first');
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-review-emptybin-')); temporary.push(empty);
  process.env.PATH = empty; // no git anywhere on PATH
  const result = await readFileDiff(path.join(dir, 'a.ts'), { kind: 'head' });
  expect(result).toEqual({ kind: 'refused', reason: 'git' });
  process.env.PATH = savedPath;
  expect(await readFileDiff(path.join(dir, 'a.ts'), {kind:'head'})).toMatchObject({kind:'diff'});
});
