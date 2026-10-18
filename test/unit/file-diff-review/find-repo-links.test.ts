// Review proof for PR #26 (runs against the #26 head, 058f5f9): main/file-diff.ts findRepo promises to refuse a
// repository whose git folder or objects "could lead to a network share", but it follows links with statSync/realpath
// (which on Windows already connect to the share and send the login, unlike open-path.ts linksToShare, which lstat/readlinks
// first) and, when the share does not answer, falls back to the unresolved path and lets git read through the link.
// On Linux a `//host/share/...` link target is just a missing path, which is exactly the "share did not answer" case.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {findRepo} from '../../../src/main/file-diff';

const temporary: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-C', cwd, ...args], { encoding: 'utf8' }).trim();
function repo() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-review-links-'))); temporary.push(dir);
  git(dir, 'init', '-q', '-b', 'main'); fs.writeFileSync(path.join(dir, 'a.ts'), 'one\n'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'first');
  return dir;
}

it.skipIf(process.platform !== 'win32').each(['.git','objects','gitdir','common'])('rejects a Windows share link at %s before following it',where=>{
  const dir=repo(),dot=path.join(dir,'.git');
  let target=where==='objects'?path.join(dot,'objects'):dot;
  if(where==='gitdir'){
    target=path.join(dir,'git-target');fs.renameSync(dot,target);fs.writeFileSync(dot,'gitdir: git-target\n');
  }
  if(where==='common'){
    target=path.join(dir,'common-target');fs.writeFileSync(path.join(dot,'commondir'),'../common-target\n');
  }
  const lstat=fs.lstatSync,readlink=fs.readlinkSync,stat=fs.statSync,real=fs.realpathSync.native;
  vi.spyOn(fs,'lstatSync').mockImplementation(((p,...args)=>String(p)===target?{isSymbolicLink:()=>true}:lstat(p,...args)) as typeof fs.lstatSync);
  vi.spyOn(fs,'readlinkSync').mockImplementation(((p)=>String(p)===target?'\\\\host\\share\\repo':readlink(p)) as typeof fs.readlinkSync);
  const followed:string[]=[];
  vi.spyOn(fs,'statSync').mockImplementation(((p,...args)=>{if(String(p)===target){followed.push(String(p));throw new Error('share touched');}return stat(p,...args);}) as typeof fs.statSync);
  vi.spyOn(fs.realpathSync,'native').mockImplementation(((p)=>{if(String(p)===target){followed.push(String(p));throw new Error('share touched');}return real(p);}) as typeof fs.realpathSync.native);
  const result=findRepo(path.join(dir,'a.ts'));
  expect(followed).toEqual([]);expect(result).toBe('share');
});

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
