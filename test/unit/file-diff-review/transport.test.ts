// Review proof for PR #26 (runs against the #26 head, 058f5f9): the "no transport" guard of main/file-diff.ts is
// `-c protocol.allow=never`, but git's per-protocol setting `protocol.<name>.allow` wins over `protocol.allow` even
// when it comes from the (untrusted) repository's own config. The only other guard is GIT_NO_LAZY_FETCH, which git
// honours only since 2.44 (backported to 2.39.4/2.40.2/2.41.1/2.42.2/2.43.4, May 2024). On an older git, simulated here
// by dropping that variable at the spawn boundary, a partial clone missing the blob lazy-fetches it over ssh
// and runs the repository's core.sshCommand: opening "Compare" on a file in a planted folder runs that folder's command.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type {ExecFileOptions} from 'node:child_process';
import type * as ChildProcess from 'node:child_process';
// Strip the new-git guard at the process boundary, on Windows too, while running real git.
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof ChildProcess>();
  return {...actual, execFile: (file:string,args:string[],options:ExecFileOptions,callback:(error:Error|null,stdout:Buffer,stderr:Buffer)=>void) =>
    actual.execFile(file,args,{...options,encoding:'buffer',env:{...options.env,GIT_NO_LAZY_FETCH:undefined}},callback)};
});
import {readFileDiff} from '../../../src/main/file-diff';

const temporary: string[] = [];
afterEach(() => { for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-C', cwd, ...args], { encoding: 'utf8' }).trim();

it('a repository config with protocol.ssh.allow=always does not get its core.sshCommand run by Compare (git without GIT_NO_LAZY_FETCH)', async () => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-review-transport-'))); temporary.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'a.ts'), 'one\n'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'first');
  fs.writeFileSync(path.join(dir, 'a.ts'), 'two\n');
  const blob = git(dir, 'rev-parse', 'HEAD:a.ts');
  fs.rmSync(path.join(dir, '.git', 'objects', blob.slice(0, 2), blob.slice(2)));
  const mark = path.join(dir, 'PWNED').replace(/\\/g,'/');
  for (const [k, v] of [
    ['core.repositoryformatversion', '1'], ['extensions.partialClone', 'origin'], ['remote.origin.url', 'ssh://example.com/r'],
    ['remote.origin.promisor', 'true'], ['protocol.ssh.allow', 'always'], ['core.sshCommand', `touch "${mark}"; false`],
  ] as const) git(dir, 'config', k, v);
  await readFileDiff(path.join(dir, 'a.ts'), { kind: 'head' });
  expect(fs.existsSync(mark), 'the repository-chosen core.sshCommand ran').toBe(false);
});
