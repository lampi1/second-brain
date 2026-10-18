// Review proof for PR #26 (runs against the #26 head, 058f5f9): when git cannot be started (not installed, not on
// PATH: e.g. a GitHub Desktop user, whose git is bundled), main/file-diff.ts atRef turns the failed `rev-parse` into
// reason 'ref', so "Compare with HEAD" on a file in a real repository says "Commit or branch not found." instead of
// the reason that exists for it ('git': "git could not read that version.").
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
// main/file-diff.ts exists only on the #26 head (feat/file-viewer-v3b), not on the review branch (based on #29): it is
// loaded by a computed path so that branch still type-checks; run this file on the #26 head (docs/reviews/pr-26-29.md)
const FILE_DIFF = '../../../../src/main/file-diff';
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the module's types are on the #26 head only
const { readFileDiff } = (await import(/* @vite-ignore */ FILE_DIFF)) as Record<string, any>;

const temporary: string[] = [];
const savedPath = process.env.PATH;
afterEach(() => { process.env.PATH = savedPath; for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-C', cwd, ...args], { encoding: 'utf8' }).trim();

it.skipIf(process.platform === 'win32')('Compare with HEAD without a usable git does not claim the commit is missing', async () => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-review-nogit-'))); temporary.push(dir);
  git(dir, 'init', '-q', '-b', 'main'); fs.writeFileSync(path.join(dir, 'a.ts'), 'one\n'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'first');
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-review-emptybin-')); temporary.push(empty);
  process.env.PATH = empty; // no git anywhere on PATH
  const result = await readFileDiff(path.join(dir, 'a.ts'), { kind: 'head' });
  expect(result).not.toEqual({ kind: 'refused', reason: 'ref' });
});
