// Full read-only viewer for an explicitly opened citation. Main-owned roots, bounded descriptors, no OS execution.
import fs from'node:fs';import path from'node:path';
import{fileReference,type FileViewResult}from'../shared/file-view';
import{resolvePeek,PEEK_TEXT}from'./peek-file';import{linksToShare,localPath}from'./open-path';
import{isInside,magicMatches}from'./ask-image';import{rasterSize}from'./agents/raster';
export const FILE_VIEW_BYTES=1_000_000;
const IMAGE_BYTES=4_000_000;
const MIME:Record<string,string>={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'};
const PUBLIC_HIDDEN=new Set(['.github','.githooks']);
const privatePath=(value:string)=>value.split(/[\\/]/).some(part=>part.startsWith('.')&&!PUBLIC_HIDDEN.has(part.toLowerCase())||/(?:^|[._-])(?:secrets?|credentials?|passwords?|tokens?|private[-_]?key)(?:[._-]|$)/i.test(part));
const key=(value:string)=>process.platform==='win32'?value.toLowerCase():value;
export function readFileView(raw:string,options:{roots:readonly string[];cwd?:string}):FileViewResult{
 if(typeof raw!=='string'||raw.length>4096||raw.includes('\0'))return{kind:'refused',reason:'outside'};
 const requested=resolvePeek(fileReference(raw).path,options.cwd);if(!requested)return{kind:'refused',reason:'outside'};
 const roots=options.roots.flatMap(root=>{const p=localPath(root);if(!p||p===path.parse(p).root||linksToShare(p))return[];try{const real=fs.realpathSync.native(p);return /^[\\/]{2}/.test(real)?[]:[{path:p,real}];}catch{return[];}});
 if(!roots.some(root=>isInside(requested,root.path)))return{kind:'refused',reason:'outside'};
 if(privatePath(requested))return{kind:'refused',reason:'private'};
 if(linksToShare(requested))return{kind:'refused',reason:'outside'};
 let real:string;let initial:fs.Stats;
 try{real=fs.realpathSync.native(requested);initial=fs.statSync(real);}catch{return{kind:'missing',reason:'missing'};}
 if(/^[\\/]{2}/.test(real)||!roots.some(root=>isInside(real,root.real)))return{kind:'refused',reason:'outside'};
 if(privatePath(real))return{kind:'refused',reason:'private'};
 const ext=path.extname(real).toLowerCase(),requestedExt=path.extname(requested).toLowerCase(),mime=MIME[ext];
 if(!initial.isFile()||(!PEEK_TEXT.has(ext)&&ext!=='.jsonl'&&!mime)||(!PEEK_TEXT.has(requestedExt)&&requestedExt!=='.jsonl'&&!MIME[requestedExt]))return{kind:'unsupported',reason:'unsupported'};
 const cap=mime?IMAGE_BYTES:FILE_VIEW_BYTES;let fd:number|undefined;
 try{
  fd=fs.openSync(real,'r');const opened=fs.fstatSync(fd);
  if(opened.nlink>1)return{kind:'refused',reason:'outside'};
  if(!opened.isFile()||opened.dev!==initial.dev||opened.ino!==initial.ino||key(fs.realpathSync.native(requested))!==key(real))return{kind:'refused',reason:'changed'};
  if(mime&&opened.size>cap)return{kind:'unsupported',reason:'image'};
  const bytes=Buffer.alloc(Math.min(cap+1,opened.size+1));let count=0;
  while(count<bytes.length){const n=fs.readSync(fd,bytes,count,bytes.length-count,null);if(!n)break;count+=n;}
  const final=fs.fstatSync(fd);if(final.dev!==opened.dev||final.ino!==opened.ino||key(fs.realpathSync.native(requested))!==key(real))return{kind:'refused',reason:'changed'};
  const buffer=bytes.subarray(0,Math.min(count,cap)),more=count>cap||final.size>buffer.length;
  if(mime){const size=rasterSize(buffer,mime);if(more||!magicMatches(mime,buffer)||!size||size.width<1||size.height<1||size.width>4096||size.height>4096||size.width*size.height>8_000_000)return{kind:'unsupported',reason:'image'};return{kind:'image',path:real,size:count,dataUrl:`data:${mime};base64,${buffer.toString('base64')}`};}
  const utf16=buffer[0]===0xff&&buffer[1]===0xfe;if(!utf16&&buffer.includes(0))return{kind:'unsupported',reason:'binary'};
  const text=(utf16?buffer.subarray(2,buffer.length-buffer.length%2).toString('utf16le'):buffer.toString('utf8')).replace(/^\uFEFF/,'');
  return{kind:'text',path:real,size:final.size,text,more};
 }catch{return{kind:'missing',reason:'missing'};}finally{if(fd!==undefined)fs.closeSync(fd);}
}
