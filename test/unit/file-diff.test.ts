// The viewer's "Compare" reads the file and its other side read-only: git HEAD, a commit or branch, or another file.
import{execFileSync}from'node:child_process';import fs from'node:fs';import os from'node:os';import path from'node:path';
import{afterEach,expect,it}from'vitest';
import{readFileDiff}from'../../src/main/file-diff';
import{DIFF_BYTES,gitRefOk}from'../../src/shared/file-diff';
const temporary:string[]=[];
afterEach(()=>{for(const dir of temporary.splice(0))fs.rmSync(dir,{recursive:true,force:true});});
const git=(cwd:string,...args:string[])=>execFileSync('git',['-c','user.name=t','-c','user.email=t@example.com','-c','commit.gpgsign=false','-C',cwd,...args],{encoding:'utf8'}).trim();
function repo(){
 const dir=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'sb-diff-')));temporary.push(dir);
 git(dir,'init','-q','-b','main');fs.mkdirSync(path.join(dir,'src'));
 fs.writeFileSync(path.join(dir,'src','a.ts'),'one\ntwo\n');git(dir,'add','.');git(dir,'commit','-qm','first');
 fs.writeFileSync(path.join(dir,'src','a.ts'),'one\ntwo\nthree\n');git(dir,'commit','-qam','second');
 fs.writeFileSync(path.join(dir,'src','a.ts'),'one\n2\nthree\n');
 return dir;
}
it('reads the file against HEAD, a commit, a branch, with the short commit id in the label',async()=>{
 const dir=repo(),file=path.join(dir,'src','a.ts'),head=git(dir,'rev-parse','HEAD');
 expect(await readFileDiff(file,{kind:'head'})).toEqual({kind:'diff',path:file,left:{label:`HEAD · ${head.slice(0,7)}`,text:'one\ntwo\nthree\n'},right:{label:file,text:'one\n2\nthree\n'}});
 expect(await readFileDiff(file,{kind:'ref',ref:'HEAD~1'})).toMatchObject({left:{text:'one\ntwo\n'}});
 git(dir,'branch','old','HEAD~1');expect(await readFileDiff('src/a.ts',{kind:'ref',ref:'old'},dir)).toMatchObject({left:{label:expect.stringMatching(/^old · /),text:'one\ntwo\n'}});
});
it('says why when there is nothing to compare with',async()=>{
 const dir=repo(),file=path.join(dir,'src','a.ts');
 expect(await readFileDiff(file,{kind:'ref',ref:'nope'})).toEqual({kind:'refused',reason:'ref'});
 fs.writeFileSync(path.join(dir,'new.txt'),'x');expect(await readFileDiff(path.join(dir,'new.txt'),{kind:'head'})).toEqual({kind:'refused',reason:'untracked'});
 const outside=fs.mkdtempSync(path.join(os.tmpdir(),'sb-diff-plain-'));temporary.push(outside);fs.writeFileSync(path.join(outside,'b.txt'),'b');
 expect(await readFileDiff(path.join(outside,'b.txt'),{kind:'head'})).toEqual({kind:'refused',reason:'repo'});
 expect(await readFileDiff('\\\\host\\share\\a.ts',{kind:'head'})).toEqual({kind:'refused',reason:'outside'});
 fs.writeFileSync(path.join(dir,'bin.dat'),Buffer.from([1,0,2]));expect(await readFileDiff(path.join(dir,'bin.dat'),{kind:'file',path:file})).toEqual({kind:'refused',reason:'binary'});
 const fd=fs.openSync(path.join(dir,'huge.log'),'w');fs.ftruncateSync(fd,DIFF_BYTES+1);fs.closeSync(fd);
 expect(await readFileDiff(path.join(dir,'huge.log'),{kind:'head'})).toEqual({kind:'refused',reason:'big'});
});
it('compares two local files, in or out of a repository',async()=>{
 const dir=repo(),file=path.join(dir,'src','a.ts'),other=path.join(dir,'other.ts');fs.writeFileSync(other,String.fromCharCode(0xfeff)+'one\n');
 expect(await readFileDiff(file,{kind:'file',path:'other.ts'},dir)).toMatchObject({kind:'diff',left:{label:other,text:'one\n'},right:{text:'one\n2\nthree\n'}});
 expect(await readFileDiff(file,{kind:'file',path:path.join(dir,'missing.ts')})).toEqual({kind:'refused',reason:'missing'});
});
it('treats a repository as untrusted: no lazy fetch, no network path through git folders, alternates or includes',async()=>{
 // a partial clone missing the blob: fetching it would run the repository's ssh command
 const dir=repo(),file=path.join(dir,'src','a.ts'),blob=git(dir,'rev-parse','HEAD:src/a.ts'),mark=path.join(dir,'PWNED').replace(/\\/g,'/');
 fs.rmSync(path.join(dir,'.git','objects',blob.slice(0,2),blob.slice(2)));
 for(const[k,v]of[['core.repositoryformatversion','1'],['extensions.partialClone','origin'],['remote.origin.url','ssh://example.com/r'],['remote.origin.promisor','true'],['core.sshCommand',`touch "${mark}"; false`]]as const)git(dir,'config',k,v);
 expect(await readFileDiff(file,{kind:'head'})).toEqual({kind:'refused',reason:'untracked'});expect(fs.existsSync(mark)).toBe(false);
 // anything that would make git read from a network share is refused before git runs
 const alt=repo();fs.writeFileSync(path.join(alt,'.git','objects','info','alternates'),'//host/share/objects\n');
 expect(await readFileDiff(path.join(alt,'src','a.ts'),{kind:'head'})).toEqual({kind:'refused',reason:'outside'});
 const inc=repo();fs.appendFileSync(path.join(inc,'.git','config'),'[include]\n\tpath = //host/share/x\n');
 expect(await readFileDiff(path.join(inc,'src','a.ts'),{kind:'head'})).toEqual({kind:'refused',reason:'outside'});
 const hidden=repo();fs.appendFileSync(path.join(hidden,'.git','config'),'[core][Include]path=//host/share/x\n');
 expect(await readFileDiff(path.join(hidden,'src','a.ts'),{kind:'head'})).toEqual({kind:'refused',reason:'outside'});
 // a core.worktree on a share is never resolved (git is given the work tree), so it answers at once
 const far=repo();git(far,'config','core.worktree','//192.0.2.1/x/wt');const started=Date.now();
 expect(await readFileDiff(path.join(far,'src','a.ts'),{kind:'head'})).toMatchObject({kind:'diff'});expect(Date.now()-started).toBeLessThan(5000);
 const linked=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'sb-diff-link-')));temporary.push(linked);fs.writeFileSync(path.join(linked,'.git'),'gitdir: //host/share/repo.git\n');fs.writeFileSync(path.join(linked,'a.ts'),'a');
 expect(await readFileDiff(path.join(linked,'a.ts'),{kind:'head'})).toEqual({kind:'refused',reason:'outside'});
 // a worktree's .git file pointing at a local git folder works
 const main=repo(),tree=path.join(fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'sb-diff-wt-'))),'w');temporary.push(path.dirname(tree));git(main,'worktree','add','-q',tree,'HEAD~1');
 expect(await readFileDiff(path.join(tree,'src','a.ts'),{kind:'head'})).toMatchObject({kind:'diff',left:{text:'one\ntwo\n'}});
});
it('takes a ref only as one revision: never an option, a range or a path',async()=>{
 for(const ok of['HEAD','HEAD~2','main','origin/main','v1.2.0','a1b2c3d','HEAD@{1}','feat/x-y_z'])expect(gitRefOk(ok)).toBe(true);
 for(const bad of['','-p','--output=x','a..b','a...b','HEAD:secret','a b','a;b','$(x)','~1'])expect(gitRefOk(bad)).toBe(false);
 const dir=repo();expect(await readFileDiff(path.join(dir,'src','a.ts'),{kind:'ref',ref:'--output=pwned'})).toEqual({kind:'refused',reason:'ref'});
 expect(fs.existsSync(path.join(dir,'src','pwned'))||fs.existsSync(path.join(dir,'pwned'))).toBe(false);
});
