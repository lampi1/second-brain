// Only Markdown image tokens outside code can request local previews; main still enforces realpath/allowlist/bytes.
import {marked} from 'marked';
import {plainPath} from './pathPatterns';
export interface MessageImage {path:string;caption:string}
export function localMessageImages(text:string,cwd?:string):MessageImage[]{
  if(!text.includes('!['))return [];
  const out:MessageImage[]=[],seen=new Set<string>();
  marked.walkTokens(marked.lexer(text),token=>{
    if(token.type!=='image'||out.length>=8)return;
    const href=token.href.trim();if(href.length>4096)return;let path=plainPath(href);
    if(/^[\\/]{2}/.test(path)||/[\u0000-\u001f]/.test(path))return;
    const absolute=/^[a-z]:[\\/]/i.test(path)||path.startsWith('/');
    if(!absolute){
      if(/^[a-z][\w+.-]*:/i.test(href)||!cwd||/^[\\/]{2}/.test(cwd)||!(/^[a-z]:[\\/]/i.test(cwd)||cwd.startsWith('/')))return;
      path=cwd.replace(/[\\/]+$/,'')+'/'+path;
    }
    // file: URLs are accepted only as local absolute paths, never server names or a renderer-relative URL.
    if(/^file:/i.test(href)&&!absolute)return;
    if(!/\.(png|jpe?g|webp)$/i.test(path))return;
    const key=path.replace(/\\/g,'/').toLowerCase();if(seen.has(key))return;seen.add(key);
    out.push({path,caption:(token.text.trim()||path.split(/[\\/]/).pop()||'Immagine locale').slice(0,200)});
  });
  return out;
}
