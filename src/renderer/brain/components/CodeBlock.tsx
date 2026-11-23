// Highlighted, read-only code with line numbers, shared by the file viewer (pages/FileViewer.tsx) and the skill library's
// file view (components/skills/SkillFileView.tsx): highlight.js per language on demand (lib/file-format.ts), sanitized by
// DOMPurify (spans and classes only), a window of lines for a very long text. Styles: brain.css .bx-code, viewer.css
// .vw-main .bx-code (callers wrap it in .vw-main).
import {useEffect,useMemo,useRef,useState,type MouseEvent as ReactMouseEvent} from 'react';
import DOMPurify from 'dompurify';
import {highlightLines} from '../lib/file-format';
import {indentGuides} from '../lib/indent-guides';
import {t} from '../../i18n';
import {lineText} from '@shared/file-view';
const WINDOW=4000;
/** Above this many characters the text is shown without highlighting (highlight.js would hold the page up). */
const HIGHLIGHT_CHARS=200_000;
let purify:ReturnType<typeof DOMPurify>|null=null;
const clean=(html:string)=>(purify??=DOMPurify(window)).sanitize(html,{ALLOWED_TAGS:['span'],ALLOWED_ATTR:['class']});
/** `text` has only \n line ends (DOMPurify's HTML parser would turn a lone \r into \n and shift the lines). */
function useHighlight(text:string,path:string,on:boolean):string[]|null{
  const [state,setState]=useState<{text:string;path:string;lines:string[]|null}>({text:'',path:'',lines:null});
  useEffect(()=>{
    if(!on||text.length>HIGHLIGHT_CHARS)return;
    let live=true;
    void highlightLines(text,path,clean).then(lines=>{if(live)setState({text,path,lines});}).catch(()=>{if(live)setState({text,path,lines:null});});
    return()=>{live=false;};
  },[on,text,path]);
  return on&&state.text===text&&state.path===path?state.lines:null;
}
/** `base` = the file line number of the text's first line (none: main did not count that far, so no numbers).
 *  `wrap` = long lines wrap under themselves (the numbers keep their column); `onPick` = a line number was clicked. */
export function Code({ text, path, line, base=1, wrap=false, picked, onPick }: { text: string; path: string; line?: number; base?: number|null; wrap?: boolean; picked?: number; onPick?: (n:number)=>void }) {
  const ref = useRef<HTMLPreElement>(null);
  // rows follow main's line rule (lineCount): a lone \r stays inside its row, so a page's numbers match main's
  const flat = useMemo(()=>lineText(text),[text]);
  const lines = useMemo(()=>flat.split('\n'),[flat]);
  const at = line&&base?line-base+1:undefined;
  // a very long text without a cited line is one plain block, so it is not highlighted either
  const html = useHighlight(flat,path,lines.length<=WINDOW||!!at);
  const w = String(lines.length+(base??1)).length;
  const guides = useMemo(()=>indentGuides(lines),[lines]);
  useEffect(() => {const target=line?ref.current?.querySelector<HTMLElement>(`[data-l="${line}"]`):null;target?.scrollIntoView({block:'center',inline:'nearest'});}, [line, text, html]);
  const cls=`bx-code bx-scroll${wrap?' is-wrap':''}`;
  // a very long text stays one text block (one element per line would slow the page down)
  if (lines.length > WINDOW&&!at) return <pre ref={ref} className={cls} data-testid="bx-code" data-wrap={wrap?'true':undefined}>{text}</pre>;
  const first=lines.length>WINDOW?Math.max(0,Math.min(lines.length-WINDOW,(at??1)-WINDOW/2)):0,number=(i:number)=>base?i+base:null;
  const pick=(e:ReactMouseEvent<HTMLPreElement>)=>{const n=Number((e.target as HTMLElement).closest('.bx-ln')?.parentElement?.dataset.l);if(onPick&&n>0)onPick(n);};
  return (
    <pre ref={ref} className={`${cls} hljs`} style={{['--ln-w' as string]:`${w+2}ch`,['--ig' as string]:`${guides.unit}ch`}} data-testid="bx-code" data-highlighted={html?'true':undefined} data-wrap={wrap?'true':undefined} onClick={pick}>
      {first>0&&<div className="bx-code-window" data-find-skip>{t('viewer.window',{first:first+(base??1),last:Math.min(lines.length,first+WINDOW)+(base??1)-1,total:lines.length+(base??1)-1})}</div>}
      {lines.slice(first,first+WINDOW).map((l, offset) => {const i=first+offset,h=html?.[i],n=number(i);
        return <div key={i} className={`bx-cl${n!==null&&n===line?' is-cited':''}${n!==null&&n===picked?' is-picked':''}`} data-l={n??undefined} style={n!==null&&n === line ? { background: 'var(--bx-amber-bg)' } : undefined}>
          {n!==null&&<span className={`bx-ln${onPick?' is-link':''}`} data-find-skip title={onPick?t('vw.lineLink',{n}):undefined}>{n}</span>}
          <span className="bx-lc">{guides.cols[i]?<span className="bx-ig" aria-hidden data-find-skip style={{width:`${guides.cols[i]}ch`}}/>:null}{h?<span dangerouslySetInnerHTML={{__html:h||' '}}/>:l || ' '}</span></div>;})}
    </pre>
  );
}
