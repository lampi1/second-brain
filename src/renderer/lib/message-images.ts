// Which local images a chat message shows as thumbnails under its text (issue #83: "a local image path or link written
// by an agent is shown inline as a thumbnail, click → full size"). Read from the parsed markdown, never from code
// blocks or HTML: an image `![caption](path)`, a link to an image `[caption](path)`, an inline code span that is just an
// image path (`C:\…\shot.png`) and a bare absolute path in the prose (C:\…\shot.png, /home/…/shot.png, file:///…). A
// relative path (image, link or code span; never bare prose) counts only against the owning chat's workspace. PNG, JPG
// and WebP only, at most 8 per message. Pure: main still enforces realpath, allowed folders, magic bytes and size
// (app:askImage, main/ask-image.ts). Used by MessageImages.tsx; pinned by test/unit/message-images.test.ts.
import {marked,type Token} from 'marked';
import {LOCAL_START,plainPath} from './pathPatterns';
import {t} from '../i18n';
export interface MessageImage {path:string;caption:string}
const IMAGE=/\.(png|jpe?g|webp)$/i;
const BARE=new RegExp(String.raw`(?<![\w/\\:.])(?:file:\/\/\/?)?${LOCAL_START}[^\s<>"'\`|*?)\]]*?\.(?:png|jpe?g|webp)(?!\w|\.\w)`,'gi');
const MAX=8;
/** A cheap test before parsing: does the text name an image file at all? */
const MAYBE=/\.(png|jpe?g|webp)\b/i;
const ABSOLUTE=/^(?:file:\/\/\/?)?(?:[a-z]:[\\/]|\/)/i;
/** marked escapes &, <, >, " and ' inside code spans. */
const unescapeHtml=(s:string)=>s.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');

export function localMessageImages(text:string,cwd?:string):MessageImage[]{
  if(!MAYBE.test(text))return [];
  const out:MessageImage[]=[],seen=new Set<string>();
  const add=(raw:string,caption:string,relativeOk:boolean)=>{
    if(out.length>=MAX)return;
    const href=raw.trim();if(!href||href.length>4096)return;let path=plainPath(href);
    if(/^[\\/]{2}/.test(path)||/[\u0000-\u001f]/.test(path))return;
    const absolute=/^[a-z]:[\\/]/i.test(path)||path.startsWith('/');
    if(!absolute){
      if(!relativeOk||/^[a-z][\w+.-]*:/i.test(href)||!cwd||/^[\\/]{2}/.test(cwd)||!(/^[a-z]:[\\/]/i.test(cwd)||cwd.startsWith('/')))return;
      path=cwd.replace(/[\\/]+$/,'')+'/'+path.replace(/^\.[\\/]/,'');
    }
    // file: URLs are accepted only as local absolute paths, never server names or a renderer-relative URL.
    if(/^file:/i.test(href)&&!absolute)return;
    if(!IMAGE.test(path))return;
    const key=path.replace(/\\/g,'/').toLowerCase();if(seen.has(key))return;seen.add(key);
    out.push({path,caption:(caption.trim()||path.split(/[\\/]/).pop()||t('appText.images.local')).slice(0,200)});
  };
  /** The prose of one inline run (consecutive text and escape tokens, which marked may split a Windows path into). */
  const prose=(run:string)=>{for(const m of run.matchAll(BARE))add(m[0],'',false);};
  const scan=(children:readonly Token[])=>{
    let run='';
    for(const child of children){
      const leaf=(child.type==='text'&&!(child as {tokens?:Token[]}).tokens?.length)||child.type==='escape';
      if(leaf)run+=child.raw;else{prose(run);run='';}
    }
    prose(run);
  };
  marked.walkTokens(marked.lexer(text),token=>{
    if(token.type==='image'){add(token.href,token.text,true);return;}
    if(token.type==='link'){
      if(IMAGE.test(token.href.trim().replace(/[?#].*$/,'')))add(token.href,token.text.replace(/!\[[^\]]*\]\([^)]*\)/g,''),true);
      return;
    }
    if(token.type==='codespan'){
      // only a span that is the path and nothing else (a path with spaces only when absolute): never an example
      const c=unescapeHtml(token.text).trim().replace(/^(["'])(.*)\1$/,'$2');
      if(IMAGE.test(c)&&/^[^<>"'`|*?\n]+$/.test(c)&&(!/\s/.test(c)||ABSOLUTE.test(c)))add(c,'',true);
      return;
    }
    // a table's cells are not tokens of their own: their inline runs are read here
    if(token.type==='table'){for(const cell of [...token.header,...token.rows.flat()])scan(cell.tokens);return;}
    const children=(token as {tokens?:Token[]}).tokens;
    if(children?.length)scan(children);
  });
  return out;
}
