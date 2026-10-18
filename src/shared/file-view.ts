// Read-only local file references: preserve citation coordinates without exposing file URLs or executable actions.
// A text result is one page: `shown` bytes from byte `offset` (at most FILE_PAGE_BYTES, cut at a line end; `more` = the
// file goes on after it); `firstLine` = the line number of its first line, absent when main did not count that far;
// `paged: false` = only the top can be shown (a UTF-16 file).
export interface FileReference { path:string; line?:number; column?:number; chatId?:string }
export const FILE_PAGE_BYTES=1_000_000;
export type FileReadReason='outside'|'unsupported'|'missing'|'changed'|'binary'|'image'|'pdf';
export type FileViewResult=
 |{kind:'text';path:string;size:number;offset:number;shown:number;text:string;more:boolean;firstLine?:number;paged?:false}
 |{kind:'pdf';path:string;size:number;data:Uint8Array}
 |{kind:'image';path:string;size:number;dataUrl:string}
 |{kind:'refused'|'missing'|'unsupported';reason:FileReadReason};
/**
 * The one line rule of main (file-view.ts counts "\n" bytes for `firstLine` and cited lines) and the viewer (its rows
 * and the pager's line range), as agents' tools cite lines: a line ends at "\n" (or "\r\n") only; a lone "\r", a
 * progress redraw in a captured log, stays inside its line.
 */
export const lineCount=(text:string):number=>text.split('\n').length-(text.endsWith('\n')?1:0);
/** `text` with "\n" line ends only, each lone "\r" shown as a space inside its line (rows = lines by lineCount). */
export const lineText=(text:string):string=>text.replace(/\r\n/g,'\n').replace(/\r/g,' ');
const coordinate=(raw:string|undefined):number|undefined=>{const n=Number(raw);return Number.isSafeInteger(n)&&n>0&&n<=10_000_000?n:undefined;};
export function fileReference(raw:string,chatId?:string):FileReference{
 const text=raw.trim().replace(/^<|>$/g,'');const at=text.match(/(?::(\d+)(?::(\d+))?|#L(\d+)(?:C(\d+))?)$/i);
 return{path:at?text.slice(0,at.index):text,line:coordinate(at?.[1]??at?.[3]),column:coordinate(at?.[2]??at?.[4]),...(chatId?{chatId}:{})};
}
const PREFIX='@file:';
export const fileViewArg=(ref:FileReference):string=>PREFIX+encodeURIComponent(JSON.stringify(ref));
/** Old explorer links carry a plain brain-relative file path; preserve them without restoring directory browsing. */
export const normalizeFileArg=(arg:string):string=>readFileViewArg(arg)?arg:fileViewArg(fileReference(arg));
export function readFileViewArg(arg:string|undefined):FileReference|null{
 if(!arg?.startsWith(PREFIX)||arg.length>12000)return null;
 try{const value=JSON.parse(decodeURIComponent(arg.slice(PREFIX.length)))as FileReference;
  if(!value||typeof value.path!=='string'||!value.path||value.path.length>4096||value.chatId!==undefined&&(typeof value.chatId!=='string'||value.chatId.length>200))return null;
  return{path:value.path,line:coordinate(String(value.line)),column:coordinate(String(value.column)),...(value.chatId?{chatId:value.chatId}:{})};
 }catch{return null;}
}
