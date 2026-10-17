// Read-only local file references: preserve citation coordinates without exposing file URLs or executable actions.
export interface FileReference { path:string; line?:number; column?:number; chatId?:string }
export type FileReadReason='outside'|'private'|'unsupported'|'missing'|'changed'|'binary'|'image';
export type FileViewResult=
 |{kind:'text';path:string;size:number;text:string;more:boolean}
 |{kind:'image';path:string;size:number;dataUrl:string}
 |{kind:'refused'|'missing'|'unsupported';reason:FileReadReason};
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
