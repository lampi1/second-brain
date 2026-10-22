// Pure helpers of the file viewer's tools (FileViewer.tsx, FileDiff.tsx, FindBar.tsx): where a search query occurs in a
// text, the side-by-side rows of a comparison with the changed words of each paired line, and the internal link to a
// file's line (sb://file/…, opened by the viewer overlay from the palette, a paste or a chat). Pinned by
// test/unit/viewer-tools.test.ts.
import {diffWordsWithSpace,type StructuredPatch} from 'diff';
import {fileViewArg,type FileReference} from '@shared/file-view';

/** At most this many matches are counted and highlighted (a one-letter query in a 1 MB log). */
export const FIND_MAX=5000;
/** The start of each case-insensitive occurrence of `query` in `text` (non-overlapping), at most `max`. */
export function findOffsets(text:string,query:string,max=FIND_MAX):number[]{
  if(!query)return[];
  const hay=text.toLocaleLowerCase(),needle=query.toLocaleLowerCase(),out:number[]=[];
  // a lowercase that changes the length (rare scripts) would shift the offsets: search the text as it is then
  const same=hay.length===text.length&&needle.length===query.length;
  const h=same?hay:text,n=same?needle:query;
  for(let i=h.indexOf(n);i>=0&&out.length<max;i=h.indexOf(n,i+n.length))out.push(i);
  return out;
}

/** The internal link to a file, at a line when given (copied from a line number; opens in the viewer overlay). */
export const fileLink=(ref:FileReference,line?:number):string=>{
  const{column:_c,line:_l,...rest}=ref;
  return `sb://file/${fileViewArg(line?{...rest,line}:rest)}`;
};

export interface Part{text:string;changed:boolean}
export interface Cell{n:number;text:string;kind:'same'|'del'|'add';parts?:Part[]}
export type SplitRow={kind:'hunk';text:string}|{kind:'line';left?:Cell;right?:Cell};
/** Longer lines are compared whole (a minified line would make the word diff slow and unreadable). */
const WORD_DIFF_CHARS=600;

/** The changed words of a removed line and the added line paired with it; null when they share almost nothing. */
export function wordParts(before:string,after:string):{left:Part[];right:Part[]}|null{
  if(before.length>WORD_DIFF_CHARS||after.length>WORD_DIFF_CHARS)return null;
  const changes=diffWordsWithSpace(before,after),left:Part[]=[],right:Part[]=[];
  let kept=0;
  for(const c of changes){
    if(c.added)right.push({text:c.value,changed:true});
    else if(c.removed)left.push({text:c.value,changed:true});
    else{kept+=c.value.trim().length;left.push({text:c.value,changed:false});right.push({text:c.value,changed:false});}
  }
  // two unrelated lines side by side: marking every word would only add noise
  return kept*3<Math.max(before.trim().length,after.trim().length)?null:{left,right};
}

/** A patch's hunks as side-by-side rows: unchanged lines on both sides, each run of removed lines paired with the run of
 *  added lines after it (word-level parts on the pairs), the hunk headers between. */
export function splitRows(patch:StructuredPatch):SplitRow[]{
  const out:SplitRow[]=[];
  for(const h of patch.hunks){
    out.push({kind:'hunk',text:`@@ -${h.oldLines?h.oldStart:h.oldStart-1},${h.oldLines} +${h.newLines?h.newStart:h.newStart-1},${h.newLines} @@`});
    let old=h.oldStart,now=h.newStart,dels:Cell[]=[],adds:Cell[]=[];
    const flush=()=>{
      for(let i=0;i<Math.max(dels.length,adds.length);i++){
        const left=dels[i],right=adds[i];
        const parts=left&&right?wordParts(left.text,right.text):null;
        out.push({kind:'line',...(left?{left:parts?{...left,parts:parts.left}:left}:{}),...(right?{right:parts?{...right,parts:parts.right}:right}:{})});
      }
      dels=[];adds=[];
    };
    for(const line of h.lines){
      const sign=line[0],text=line.slice(1);
      if(sign==='-'){if(adds.length)flush();dels.push({n:old++,text,kind:'del'});}
      else if(sign==='+')adds.push({n:now++,text,kind:'add'});
      else if(sign===' '){flush();out.push({kind:'line',left:{n:old++,text,kind:'same'},right:{n:now++,text,kind:'same'}});}
    }
    flush();
  }
  return out;
}
