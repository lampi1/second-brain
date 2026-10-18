// Both sides of the file viewer's "Compare" (SPEC 22 V3): the file as it is now, and the same file at git HEAD or at a
// commit/branch, or another local file. Read-only git, and a repository is untrusted (any folder on the PC can be one):
// - only `rev-parse` and `cat-file` (allow-list below), no shell, git found by absolute path (not in the current folder);
// - the repository is found here, not by git, and refused when its git folder, objects or alternates could lead to a
//   network share (git would send the Windows login there) or its config has the word "include" anywhere (git accepts
//   a section header mid-line, so only the word itself is a safe test); git is then pointed at exactly that git folder
//   and work tree (an explicit work tree also keeps git from resolving the config's core.worktree, which may be a share);
// - the inherited GIT_* variables are dropped (they could point git elsewhere or run a helper); no lazy fetch and no
//   transport at all (a partial clone's missing object would otherwise run the repository's ssh command), core.fsmonitor
//   off, no replace objects, no optional locks: nothing runs, nothing is written.
// Each side at most DIFF_BYTES, text only; the renderer computes the diff. Used by index.ts (app:readFileDiff); pinned by
// test/unit/file-diff.test.ts.
import{execFile}from'node:child_process';import fs from'node:fs';import path from'node:path';
import{DIFF_BYTES,gitRefOk,type DiffAgainst,type FileDiffReason,type FileDiffResult}from'../shared/file-diff';
import{localFile}from'./file-view';
import{linksToShare}from'./open-path';
const GIT_COMMANDS=new Set(['rev-parse','cat-file']);
const refuse=(reason:FileDiffReason):FileDiffResult=>({kind:'refused',reason});
const share=(value:string)=>/^[\\/]{2}/.test(value);
/** git.exe from an absolute PATH folder (Windows would otherwise try the current folder first); null when there is none. */
function gitBinary():string|null{
 if(process.platform!=='win32')return'git';
 for(const dir of(process.env.PATH??process.env.Path??'').split(path.delimiter)){
  const file=path.join(dir,'git.exe');
  if(path.isAbsolute(dir)&&!share(dir)&&!linksToShare(file)&&fs.existsSync(file))return file;
 }
 return null;
}
function git(repo:{gitDir:string;top:string},args:string[],maxBuffer=64_000):Promise<Buffer>{
 const bin=gitBinary();
 if(!bin||!GIT_COMMANDS.has(args[0]??''))return Promise.reject(new Error('git not available'));
 const env:NodeJS.ProcessEnv=Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^GIT_/i.test(name)));
 const protocols=['ext','ssh','git','http','https','file'].flatMap(p=>['-c',`protocol.${p}.allow=never`]);
 const options=['-c','core.fsmonitor=false','-c','protocol.allow=never',...protocols,'--no-replace-objects',`--git-dir=${repo.gitDir}`,`--work-tree=${repo.top}`];
 return new Promise((resolve,reject)=>{
  execFile(bin,[...options,...args],{cwd:repo.top,windowsHide:true,timeout:20_000,maxBuffer,encoding:'buffer',env:{...env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0',GIT_NO_LAZY_FETCH:'1',GIT_ALLOW_PROTOCOL:''}},(err,stdout)=>{if(err)reject(err);else resolve(stdout);});
 });
}
const real=(file:string):string|null=>{try{return fs.realpathSync.native(file);}catch{return null;}};
const read=(file:string):string=>{try{return fs.readFileSync(file,'utf8');}catch{return'';}};
/** Check before stat, realpath or reading: those operations may already authenticate to a Windows share. */
function unsafe(file:string):boolean{
 if(share(file)||linksToShare(file))return true;
 try{return fs.lstatSync(file).isSymbolicLink()&&share(fs.readlinkSync(file));}catch{return false;}
}
const failedGit=(error:unknown,fallback:FileDiffReason):FileDiffReason=>
 typeof(error as NodeJS.ErrnoException)?.code==='number'?fallback:'git';
/**
 * The repository holding `file`: the nearest folder above it with a `.git` folder or `.git` file (a worktree or a
 * submodule); null when there is none, 'share' when following it could reach a network path.
 */
export function findRepo(file:string):{gitDir:string;top:string}|'share'|null{
 for(let dir=path.dirname(file);;){
  const dot=path.join(dir,'.git');if(unsafe(dot))return'share';
  let stats:fs.Stats|null=null;try{stats=fs.statSync(dot);}catch{/* not here */}
  if(stats){
   let gitDir:string|null=dot;
   if(stats.isFile()){const target=/^gitdir:\s*(.+?)\s*$/m.exec(read(dot))?.[1];if(!target||share(target))return'share';gitDir=path.resolve(dir,target);}
   if(unsafe(gitDir))return'share';gitDir=real(gitDir);if(!gitDir)return null;if(share(gitDir))return'share';
   const commonFile=path.join(gitDir,'commondir');if(unsafe(commonFile))return'share';
   const pointer=read(commonFile).trim();if(pointer&&share(pointer))return'share';
   const commonTarget=pointer?path.resolve(gitDir,pointer):gitDir;if(unsafe(commonTarget))return'share';
   const common=real(commonTarget);if(!common||share(common))return'share';
   const objectTarget=path.join(common,'objects');if(unsafe(objectTarget))return'share';
   const objects=real(objectTarget);if(!objects||share(objects))return'share';
   const configs=[path.join(common,'config'),path.join(gitDir,'config.worktree')];
   if([...configs,path.join(objects,'info','alternates')].some(unsafe))return'share';
   const config=configs.map(read).join('\n');
   if([gitDir,common,objects].some(share)||read(path.join(objects,'info','alternates')).trim()||/include/i.test(config))return'share';
   return{gitDir,top:dir};
  }
  const up=path.dirname(dir);if(up===dir)return null;dir=up;
 }
}
/** Text of a whole file or blob: UTF-8 (BOM dropped) or UTF-16 LE with its BOM; a NUL byte elsewhere means binary. */
function decode(bytes:Buffer):{text:string}|'big'|'binary'{
 if(bytes.length>DIFF_BYTES)return'big';
 if(bytes[0]===0xff&&bytes[1]===0xfe)return{text:bytes.subarray(2,bytes.length-bytes.length%2).toString('utf16le')};
 if(bytes.includes(0))return'binary';
 const text=bytes.toString('utf8');return{text:text.charCodeAt(0)===0xfeff?text.slice(1):text};
}
async function readText(file:string,size:number):Promise<{text:string}|'big'|'binary'|'missing'>{
 if(size>DIFF_BYTES)return'big';
 try{return decode(await fs.promises.readFile(file));}catch{return'missing';}
}
type Local=Exclude<ReturnType<typeof localFile>,{kind:unknown}>;
const resolved=(raw:string,cwd?:string):Local|FileDiffReason=>{
 const local=localFile(raw,cwd);if(!('kind'in local))return local;
 return local.reason==='outside'||local.reason==='missing'?local.reason:'unsupported';
};
/** The file at `ref` in its own repository: its text and a label with the short commit id. */
async function atRef(file:string,ref:string):Promise<{label:string;text:string}|FileDiffReason>{
 if(!gitRefOk(ref))return'ref';
 const repo=findRepo(file);if(!repo)return'repo';if(repo==='share')return'outside';
 const rel=path.relative(repo.top,file);if(!rel||rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))return'repo';
 let sha:string;
 try{sha=String(await git(repo,['rev-parse','--verify','--quiet',`${ref}^{commit}`])).trim();}catch(error){return failedGit(error,'ref');}
 if(!/^[0-9a-f]{40,64}$/.test(sha))return'ref';
 const spec=`${sha}:${rel.split(path.sep).join('/')}`;
 let size:number;
 try{size=Number(String(await git(repo,['cat-file','-s',spec])).trim());}catch(error){return failedGit(error,'untracked');}
 if(!Number.isSafeInteger(size)||size>DIFF_BYTES)return'big';
 let blob:Buffer;try{blob=await git(repo,['cat-file','blob',spec],DIFF_BYTES+1);}catch{return'git';}
 const text=decode(blob);return typeof text==='string'?text:{label:`${ref} · ${sha.slice(0,7)}`,text:text.text};
}
/** The file now (right) and what it is compared with (left). */
export async function readFileDiff(raw:string,against:DiffAgainst,cwd?:string):Promise<FileDiffResult>{
 const local=resolved(raw,cwd);if(typeof local==='string')return refuse(local);
 const now=await readText(local.real,local.stats.size);if(typeof now==='string')return refuse(now);
 let left:{label:string;text:string}|FileDiffReason;
 if(against.kind==='file'){
  const other=resolved(against.path,cwd);
  if(typeof other==='string')left=other;else{const text=await readText(other.real,other.stats.size);left=typeof text==='string'?text:{label:other.real,text:text.text};}
 }else left=await atRef(local.real,against.kind==='head'?'HEAD':against.ref);
 if(typeof left==='string')return refuse(left);
 return{kind:'diff',path:local.real,left,right:{label:local.real,text:now.text}};
}
