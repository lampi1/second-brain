// Review proof for PR #26 (runs against the #26 head, 058f5f9): the "no transport" guard of main/file-diff.ts is
// `-c protocol.allow=never`, but git's per-protocol setting `protocol.<name>.allow` wins over `protocol.allow` even
// when it comes from the (untrusted) repository's own config. The only other guard is GIT_NO_LAZY_FETCH, which git
// honours only since 2.44 (backported to 2.39.4/2.40.2/2.41.1/2.42.2/2.43.4, May 2024). On an older git, simulated here
// by a `git` wrapper first on PATH that drops that variable, a partial clone missing the blob lazy-fetches it over ssh
// and runs the repository's core.sshCommand: opening "Compare" on a file in a planted folder runs that folder's command.
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

it.skipIf(process.platform === 'win32')('a repository config with protocol.ssh.allow=always does not get its core.sshCommand run by Compare (git without GIT_NO_LAZY_FETCH)', async () => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-review-transport-'))); temporary.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'a.ts'), 'one\n'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'first');
  fs.writeFileSync(path.join(dir, 'a.ts'), 'two\n');
  const blob = git(dir, 'rev-parse', 'HEAD:a.ts');
  fs.rmSync(path.join(dir, '.git', 'objects', blob.slice(0, 2), blob.slice(2)));
  const mark = path.join(dir, 'PWNED');
  for (const [k, v] of [
    ['core.repositoryformatversion', '1'], ['extensions.partialClone', 'origin'], ['remote.origin.url', 'ssh://example.com/r'],
    ['remote.origin.promisor', 'true'], ['protocol.ssh.allow', 'always'], ['core.sshCommand', `touch "${mark}"; false`],
  ] as const) git(dir, 'config', k, v);
  // a git that predates GIT_NO_LAZY_FETCH: the real git, minus that variable
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-review-oldgit-')); temporary.push(bin);
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\nunset GIT_NO_LAZY_FETCH\nexec "${realGit}" "$@"\n`, { mode: 0o755 });
  process.env.PATH = `${bin}${path.delimiter}${savedPath}`;
  await readFileDiff(path.join(dir, 'a.ts'), { kind: 'head' });
  expect(fs.existsSync(mark), 'the repository-chosen core.sshCommand ran').toBe(false);
});
