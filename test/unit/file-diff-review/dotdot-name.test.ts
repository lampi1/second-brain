// Review proof for PR #26 (runs against the #26 head, 058f5f9): main/file-diff.ts atRef decides "outside the
// repository" with rel.startsWith('..'), so a tracked file whose name merely starts with two dots (e.g. `..notes.md`)
// at the repository top is reported as "not in a git repository" instead of being compared with HEAD.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {readFileDiff} from '../../../src/main/file-diff';

const temporary: string[] = [];
afterEach(() => { for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-C', cwd, ...args], { encoding: 'utf8' }).trim();

it('a tracked file named `..notes.md` at the repository top is compared with HEAD', async () => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-review-dotdot-'))); temporary.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  const file = path.join(dir, '..notes.md');
  fs.writeFileSync(file, 'one\n'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'first');
  fs.writeFileSync(file, 'two\n');
  expect(await readFileDiff(file, { kind: 'head' })).toMatchObject({ kind: 'diff', left: { text: 'one\n' }, right: { text: 'two\n' } });
});
