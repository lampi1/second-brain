// Full read-only viewer for an explicitly opened file link. Any local file (Brother, SPEC 22, 2026-10-17: "any file on
// the PC, no exceptions"), never a network share: a UNC path or a link to one would send the Windows login to that host.
// Text comes one page at a time (at most FILE_PAGE_BYTES, see readFileView's options); a PDF comes whole up to PDF_BYTES
// as bytes for the renderer's pdf.js (canvas only). Async reads, so a long line count never holds the app up. Bounded,
// nothing written, run or opened in another app. Used by index.ts (app:readFile); pinned by test/unit/file-view.test.ts.
import fs from'node:fs';import type{FileHandle}from'node:fs/promises';import path from'node:path';
import{fileReference,FILE_PAGE_BYTES,type FileViewResult}from'../shared/file-view';
import{resolvePeek}from'./peek-file';import{linksToShare}from'./open-path';
import{magicMatches}from'./ask-image';import{rasterSize}from'./agents/raster';
export const FILE_VIEW_BYTES=FILE_PAGE_BYTES;
/** How far line numbers are counted (a page further on shows no numbers; a cited line further on is not found). */
export const FILE_SCAN_BYTES=64_000_000;
export const PDF_BYTES=32_000_000;
const IMAGE_BYTES=4_000_000;
/** Lines shown above a cited line when its page does not start at the top of the file (fewer when they are long). */
const LINE_CONTEXT=100;
const MIME:Record<string,string>={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'};
const key=(value:string)=>process.platform==='win32'?value.toLowerCase():value;
const share=(value:string)=>/^[\\/]{2}/.test(value);
const NL=0x0a,CHUNK=1_000_000;
const continuation=(byte:number|undefined)=>byte!==undefined&&(byte&0xc0)===0x80;
const newlines=(bytes:Buffer)=>{let n=0;for(let i=bytes.indexOf(NL);i>=0;i=bytes.indexOf(NL,i+1))n++;return n;};
/** The end of `buffer` without a UTF-8 sequence cut in half by the byte cap. */
function utf8End(buffer:Buffer):number{
 let i=buffer.length-1,back=0;while(i>0&&back<3&&continuation(buffer[i])){i--;back++;}
 const lead=buffer[i]!,need=lead>=0xf0?4:lead>=0xe0?3:lead>=0xc0?2:1;return buffer.length-i<need?i:buffer.length;
}
async function readAt(fd:FileHandle,position:number,length:number):Promise<Buffer>{
 const bytes=Buffer.alloc(Math.max(0,length));let count=0;
 while(count<bytes.length){const{bytesRead}=await fd.read(bytes,count,bytes.length-count,position+count);if(!bytesRead)break;count+=bytesRead;}
 return bytes.subarray(0,count);
}
/** Line ends before `end` (the line number of the byte at `end` is this + 1); null past the scan limit. */
async function linesBefore(fd:FileHandle,end:number):Promise<number|null>{
 if(end>FILE_SCAN_BYTES)return null;let lines=0;
 for(let at=0;at<end;at+=CHUNK){const part=await readAt(fd,at,Math.min(CHUNK,end-at));if(!part.length)break;lines+=newlines(part);}
 return lines;
}
/** Where lines `first` and `line` start (1-based, first <= line) in one pass; null when the file or the scan ends first. */
async function lineStarts(fd:FileHandle,first:number,line:number):Promise<[number,number]|null>{
 if(line<=1)return[0,0];let seen=0,from=0;
 for(let at=0;at<FILE_SCAN_BYTES;at+=CHUNK){
  const part=await readAt(fd,at,CHUNK);if(!part.length)return null;
  for(let i=part.indexOf(NL);i>=0;i=part.indexOf(NL,i+1)){seen++;if(seen===first-1)from=at+i+1;if(seen===line-1)return[from,at+i+1];}
 }
 return null;
}
/** The first whole character at or after `offset`. */
async function charAt(fd:FileHandle,offset:number):Promise<number>{
 const bytes=await readAt(fd,offset,4);let i=0;while(i<bytes.length&&continuation(bytes[i]))i++;return offset+i;
}
/** The first line start at or after `offset` and before `limit`; without one, the first whole character at `offset`. */
async function lineAfter(fd:FileHandle,offset:number,limit:number):Promise<number>{
 if(offset<=0)return 0;
 const before=await readAt(fd,offset-1,limit-offset+1),nl=before.indexOf(NL);
 return nl>=0&&offset+nl<limit?offset+nl:charAt(fd,offset);
}
/**
 * One page of text, from (the first that applies):
 * - `line`: the page around that cited line (up to LINE_CONTEXT lines above it, from the top in the first half page);
 * - `before`: the page that ends exactly there (the one before a page that starts there);
 * - `offset`: the page that starts there (a page's end: exact) or, with `align`, at the next line start (a jump);
 * - nothing: the top.
 * A page that does not reach the end of the file stops at its last line end, or at its last whole character when one
 * line fills it, so following `offset + shown` from the top joins every byte once.
 */
export async function readFileView(raw:string,options:{cwd?:string;offset?:number;align?:boolean;before?:number;line?:number}={}):Promise<FileViewResult>{
 if(typeof raw!=='string'||raw.length>4096||raw.includes('\0'))return{kind:'refused',reason:'outside'};
 const requested=resolvePeek(fileReference(raw).path,options.cwd);if(!requested||linksToShare(requested))return{kind:'refused',reason:'outside'};
 let real:string;let initial:fs.Stats;
 try{real=fs.realpathSync.native(requested);initial=fs.statSync(real);}catch{return{kind:'missing',reason:'missing'};}
 if(share(real))return{kind:'refused',reason:'outside'};
 if(!initial.isFile())return{kind:'unsupported',reason:'unsupported'};
 const ext=path.extname(real).toLowerCase(),mime=MIME[ext],pdf=ext==='.pdf';let fd:FileHandle|undefined;
 const same=(stats:fs.Stats,than:fs.Stats)=>stats.isFile()&&stats.dev===than.dev&&stats.ino===than.ino&&key(fs.realpathSync.native(requested))===key(real);
 try{
  fd=await fs.promises.open(real,'r');const opened=await fd.stat();
  if(!same(opened,initial))return{kind:'refused',reason:'changed'};
  if(mime||pdf){
   const cap=pdf?PDF_BYTES:IMAGE_BYTES;if(opened.size>cap)return{kind:'unsupported',reason:pdf?'pdf':'image'};
   const all=await readAt(fd,0,cap+1),final=await fd.stat();if(!same(final,opened))return{kind:'refused',reason:'changed'};
   if(all.length>cap||final.size!==all.length)return{kind:'refused',reason:'changed'};
   if(pdf){if(!all.subarray(0,1024).includes('%PDF-'))return{kind:'unsupported',reason:'pdf'};return{kind:'pdf',path:real,size:all.length,data:new Uint8Array(all)};}
   const size=rasterSize(all,mime!);if(!magicMatches(mime!,all)||!size||size.width<1||size.height<1||size.width>4096||size.height>4096||size.width*size.height>8_000_000)return{kind:'unsupported',reason:'image'};
   return{kind:'image',path:real,size:all.length,dataUrl:`data:${mime};base64,${all.toString('base64')}`};
  }
  // binary or not is decided once, from the head of the file (as V1 did), so every page of a text file stays readable:
  // a NUL further on (a log padded by a crash) is shown as a replacement character, never as a "binary" page
  const head=await readAt(fd,0,CHUNK),utf16=head[0]===0xff&&head[1]===0xfe;
  if(!utf16&&head.includes(0))return{kind:'unsupported',reason:'binary'};
  // a UTF-16 file is shown from the top only (its pages would need two-byte alignment and their own line counting)
  const whole=(n:number|undefined)=>n!==undefined&&Number.isSafeInteger(n)&&n>0?Math.min(n,opened.size):0;
  const line=!utf16&&Number.isSafeInteger(options.line)&&options.line!>0?options.line!:0,before=utf16?0:whole(options.before),offset=utf16?0:whole(options.offset);
  let start=0,end:number|null=null,firstLine:number|null=1,cited=0;
  if(line>1){
   const at=await lineStarts(fd,Math.max(1,line-LINE_CONTEXT),line);
   if(at)cited=at[1];
   if(at&&at[1]>=FILE_PAGE_BYTES/2){
    start=Math.max(at[0],await lineAfter(fd,at[1]-FILE_PAGE_BYTES/2,at[1]+1));
    firstLine=line-newlines(await readAt(fd,start,at[1]-start));
   }
  }else if(before){
   start=before<=FILE_PAGE_BYTES?0:await lineAfter(fd,before-FILE_PAGE_BYTES,before);end=before;
   firstLine=await linesBefore(fd,start);if(firstLine!==null)firstLine++;
  }else if(offset){
   start=options.align?await lineAfter(fd,offset,offset+FILE_PAGE_BYTES):offset;
   firstLine=await linesBefore(fd,start);if(firstLine!==null)firstLine++;
  }
  const page=await readAt(fd,start,end===null?FILE_PAGE_BYTES+1:end-start);
  const final=await fd.stat();if(!same(final,opened))return{kind:'refused',reason:'changed'};
  const read=page.subarray(0,Math.min(page.length,FILE_PAGE_BYTES)),more=page.length>FILE_PAGE_BYTES||final.size>start+read.length;
  // a page that does not reach the end of the file stops at its last line end (or at the last whole character);
  // a page asked to end at `before` already ends at a page boundary; a cited line too long to end on the page is cut
  // at its last whole character instead, so the page still shows it
  const nl=more&&end===null&&!utf16?read.lastIndexOf(NL):-1;
  const bytes=utf16?read.subarray(2,read.length-read.length%2):more&&end===null?read.subarray(0,nl>=Math.max(0,cited-start)?nl+1:utf8End(read)):read;
  const decoded=(utf16?bytes.toString('utf16le'):bytes.toString('utf8')).replace(/\0/g,'�'),text=start===0&&decoded.charCodeAt(0)===0xfeff?decoded.slice(1):decoded;
  return{kind:'text',path:real,size:final.size,offset:start,shown:utf16?read.length:bytes.length,text,more,...(firstLine!==null?{firstLine}:{}),...(utf16?{paged:false as const}:{})};
 }catch{return{kind:'missing',reason:'missing'};}finally{await fd?.close();}
}
