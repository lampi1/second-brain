// Review proof for PR #26 (runs against the #26 head, 058f5f9): main/file-diff.ts findRepo promises to refuse a
// repository whose git folder or objects "could lead to a network share", but it follows links with statSync/realpath
// (which on Windows already connect to the share and send the login, unlike open-path.ts linksToShare, which lstat/readlinks
// first) and, when the share does not answer, falls back to the unresolved path and lets git read through the link.
// On Linux a `//host/share/...` link target is just a missing path, which is exactly the "share did not answer" case.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
// main/file-diff.ts exists only on the #26 head (feat/file-viewer-v3b), not on the review branch (based on #29): it is
// loaded by a computed path so that branch still type-checks; run this file on the #26 head (docs/reviews/pr-26-29.md)
const FILE_DIFF = '../../../../src/main/file-diff';
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the module's types are on the #26 head only
const { findRepo } = (await import(/* @vite-ignore */ FILE_DIFF)) as Record<string, any>;

const temporary: string[] = [];
afterEach(() => { for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-C', cwd, ...args], { encoding: 'utf8' }).trim();
function repo() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-review-links-'))); temporary.push(dir);
  git(dir, 'init', '-q', '-b', 'main'); fs.writeFileSync(path.join(dir, 'a.ts'), 'one\n'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'first');
  return dir;
}

it.skipIf(process.platform === 'win32')('a .git/objects that is a link to a network share is refused, not read through its unresolved path', () => {
  const dir = repo();
  fs.rmSync(path.join(dir, '.git', 'objects'), { recursive: true, force: true });
  fs.symlinkSync('//host/share/objects', path.join(dir, '.git', 'objects'));
  expect(findRepo(path.join(dir, 'a.ts'))).toBe('share');
});

it.skipIf(process.platform === 'win32')('a .git that is a link to a network share is refused, not followed', () => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-review-links-'))); temporary.push(dir);
  fs.symlinkSync('//host/share/repo.git', path.join(dir, '.git'));
  fs.writeFileSync(path.join(dir, 'a.ts'), 'a');
  expect(findRepo(path.join(dir, 'a.ts'))).toBe('share');
});
