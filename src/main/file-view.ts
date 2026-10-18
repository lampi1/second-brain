// Full read-only viewer for an explicitly opened file link. Any local file (Brother, SPEC 22, 2026-10-17: "any file on
// the PC, no exceptions"), never a network share: a UNC path or a link to one would send the Windows login to that host.
// Bounded descriptors, nothing written, run or opened in another app. Used by index.ts (app:readFile); pinned by
// test/unit/file-view.test.ts.
import fs from'node:fs';import path from'node:path';
import{fileReference,type FileViewResult}from'../shared/file-view';
import{resolvePeek}from'./peek-file';import{linksToShare}from'./open-path';
import{magicMatches}from'./ask-image';import{rasterSize}from'./agents/raster';
export const FILE_VIEW_BYTES=1_000_000;
const IMAGE_BYTES=4_000_000;
const MIME:Record<string,string>={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'};
const key=(value:string)=>process.platform==='win32'?value.toLowerCase():value;
const share=(value:string)=>/^[\\/]{2}/.test(value);
/** The end of `buffer` without a UTF-8 sequence cut in half by the byte cap. */
function utf8End(buffer:Buffer):number{
 let i=buffer.length-1,back=0;while(i>0&&back<3&&(buffer[i]!&0xc0)===0x80){i--;back++;}
 const lead=buffer[i]!,need=lead>=0xf0?4:lead>=0xe0?3:lead>=0xc0?2:1;return buffer.length-i<need?i:buffer.length;
}
export function readFileView(raw:string,options:{cwd?:string}={}):FileViewResult{
 if(typeof raw!=='string'||raw.length>4096||raw.includes('\0'))return{kind:'refused',reason:'outside'};
 const requested=resolvePeek(fileReference(raw).path,options.cwd);if(!requested||linksToShare(requested))return{kind:'refused',reason:'outside'};
 let real:string;let initial:fs.Stats;
 try{real=fs.realpathSync.native(requested);initial=fs.statSync(real);}catch{return{kind:'missing',reason:'missing'};}
 if(share(real))return{kind:'refused',reason:'outside'};
 if(!initial.isFile())return{kind:'unsupported',reason:'unsupported'};
 const mime=MIME[path.extname(real).toLowerCase()],cap=mime?IMAGE_BYTES:FILE_VIEW_BYTES;let fd:number|undefined;
 try{
  fd=fs.openSync(real,'r');const opened=fs.fstatSync(fd);
  if(!opened.isFile()||opened.dev!==initial.dev||opened.ino!==initial.ino||key(fs.realpathSync.native(requested))!==key(real))return{kind:'refused',reason:'changed'};
  if(mime&&opened.size>cap)return{kind:'unsupported',reason:'image'};
  // cap+1 whatever fstat says: a procfs/sysfs file reports size 0 and has content, so only the read decides `more`
  const bytes=Buffer.alloc(cap+1);let count=0;
  while(count<bytes.length){const n=fs.readSync(fd,bytes,count,bytes.length-count,null);if(!n)break;count+=n;}
  const final=fs.fstatSync(fd);if(final.dev!==opened.dev||final.ino!==opened.ino||key(fs.realpathSync.native(requested))!==key(real))return{kind:'refused',reason:'changed'};
  const read=bytes.subarray(0,Math.min(count,cap)),more=count>cap||final.size>read.length;
  if(mime){const size=rasterSize(read,mime);if(more||!magicMatches(mime,read)||!size||size.width<1||size.height<1||size.width>4096||size.height>4096||size.width*size.height>8_000_000)return{kind:'unsupported',reason:'image'};return{kind:'image',path:real,size:count,dataUrl:`data:${mime};base64,${read.toString('base64')}`};}
  const utf16=read[0]===0xff&&read[1]===0xfe;if(!utf16&&read.includes(0))return{kind:'unsupported',reason:'binary'};
  const buffer=utf16?read.subarray(2,read.length-read.length%2):more?read.subarray(0,utf8End(read)):read;
  const text=(utf16?buffer.toString('utf16le'):buffer.toString('utf8')).replace(/^\uFEFF/,'');
  return{kind:'text',path:real,size:final.size,shown:read.length,text,more};
 }catch{return{kind:'missing',reason:'missing'};}finally{if(fd!==undefined)fs.closeSync(fd);}
}
