// The one read-only viewer for every file link (SPEC 22): markdown rendered, code and config highlighted (highlight.js,
// one lazy chunk per language), CSV/TSV and JSONL as tables, JSON pretty-printed, images, PDFs (pdf.js, canvas only),
// HTML reports as a sanitized page (ReportHtml.tsx) and Markdown with its images (embedded or local files read by main,
// never remote; ReportImages.tsx), each image opening large on a click (issue #83);
// a big text file comes one page at a time (main cuts it at line ends; a cited line opens its own page); "Compare" shows
// its diff against git HEAD, a commit/branch or another file (FileDiff.tsx). Main reads any
// local file, bounded (never a network share); nothing here edits, runs or hands the file to another app: "Show in
// folder" only selects it in Explorer, on the user's click.
// It is shown in the viewer overlay above the page (components/viewer/ViewerOverlay.tsx, which passes its own controls
// as `chrome`): a header with the file's name, folder, size and kind and its actions, Ctrl+F search in the text on
// screen (FindBar.tsx), a table of contents beside a Markdown document with three or more headings (Toc.tsx), wrapped or
// unwrapped code, and a click on a line number copies the internal link to that line (sb://file/…).
import {lazy,Suspense,useCallback,useEffect,useMemo,useRef,useState,type MouseEvent as ReactMouseEvent,type ReactNode} from 'react';
import DOMPurify from 'dompurify';
import {DataTable,type Col} from '../components/DataTable';
import {Markdown} from '../components/Markdown';
import {ReportHtml} from '../components/ReportHtml';
import {ReportReview} from '../components/ReportReview';
import {Empty} from '../components/States';
import {copyText,IconCopy,IconSearch,Seg,toast} from '../components/ui';
import {FindBar} from '../components/FindBar';
import {Toc} from '../components/Toc';
import {baseName} from '../lib/text';
import {extOf,fmtBytes,highlightLines,parseCsv,prettyJson,viewOf,type FileView} from '../lib/file-format';
import {fileLink} from '../lib/viewer-tools';
import {Compare} from './FileDiff';
import type {PDFDocumentProxy,PDFPageProxy} from '../lib/pdf';
import {pdfPagesToDraw,samePages} from '../lib/pdf-window';
import {t} from '../../i18n';
const ImageZoom=lazy(()=>import('../../components/ImageZoom').then(m=>({default:m.ImageZoom})));
import {FILE_PAGE_BYTES,lineCount,lineText,readFileViewArg,type FileReference,type FileViewResult} from '@shared/file-view';
type TextResult=Extract<FileViewResult,{kind:'text'}>;
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
function Code({ text, path, line, base=1, wrap=false, picked, onPick }: { text: string; path: string; line?: number; base?: number|null; wrap?: boolean; picked?: number; onPick?: (n:number)=>void }) {
  const ref = useRef<HTMLPreElement>(null);
  // rows follow main's line rule (lineCount): a lone \r stays inside its row, so a page's numbers match main's
  const flat = useMemo(()=>lineText(text),[text]);
  const lines = useMemo(()=>flat.split('\n'),[flat]);
  const at = line&&base?line-base+1:undefined;
  // a very long text without a cited line is one plain block, so it is not highlighted either
  const html = useHighlight(flat,path,lines.length<=WINDOW||!!at);
  const w = String(lines.length+(base??1)).length;
  useEffect(() => {const target=line?ref.current?.querySelector<HTMLElement>(`[data-l="${line}"]`):null;target?.scrollIntoView({block:'center',inline:'nearest'});}, [line, text, html]);
  const cls=`bx-code bx-scroll${wrap?' is-wrap':''}`;
  // a very long text stays one text block (one element per line would slow the page down)
  if (lines.length > WINDOW&&!at) return <pre ref={ref} className={cls} data-testid="bx-code" data-wrap={wrap?'true':undefined}>{text}</pre>;
  const first=lines.length>WINDOW?Math.max(0,Math.min(lines.length-WINDOW,(at??1)-WINDOW/2)):0,number=(i:number)=>base?i+base:null;
  const pick=(e:ReactMouseEvent<HTMLPreElement>)=>{const n=Number((e.target as HTMLElement).closest('.bx-ln')?.parentElement?.dataset.l);if(onPick&&n>0)onPick(n);};
  return (
    <pre ref={ref} className={`${cls} hljs`} style={{['--ln-w' as string]:`${w+2}ch`}} data-testid="bx-code" data-highlighted={html?'true':undefined} data-wrap={wrap?'true':undefined} onClick={pick}>
      {first>0&&<div className="bx-code-window" data-find-skip>{t('viewer.window',{first:first+(base??1),last:Math.min(lines.length,first+WINDOW)+(base??1)-1,total:lines.length+(base??1)-1})}</div>}
      {lines.slice(first,first+WINDOW).map((l, offset) => {const i=first+offset,h=html?.[i],n=number(i);
        return <div key={i} className={`bx-cl${n!==null&&n===line?' is-cited':''}${n!==null&&n===picked?' is-picked':''}`} data-l={n??undefined} style={n!==null&&n === line ? { background: 'var(--bx-amber-bg)' } : undefined}>
          {n!==null&&<span className={`bx-ln${onPick?' is-link':''}`} data-find-skip title={onPick?t('vw.lineLink',{n}):undefined}>{n}</span>}
          <span className="bx-lc">{h?<span dangerouslySetInnerHTML={{__html:h||' '}}/>:l || ' '}</span></div>;})}
    </pre>
  );
}

function Jsonl({ text, name }: { text: string; name: string }) {
  const rows = useMemo(() => text.split(/\r?\n/).filter(Boolean).map(l => {
    try { const o = JSON.parse(l) as Record<string, unknown>; return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'object' && v !== null ? JSON.stringify(v) : v])); } catch { return { [t('viewer.jsonlLine')]: l }; }
  }), [text]);
  const keys = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const cols: Col<Record<string, unknown>>[] = keys.map((k, i) => ({ key: k, label: k, clip: true, hidden: i >= 8 }));
  return <DataTable name={name} label={name} rows={rows} cols={cols} />;
}

function Csv({ text, path, name }: { text: string; path: string; name: string }) {
  const {rows,cols}=useMemo(()=>{
    const [head=[],...body]=parseCsv(text,path);
    const width=body.reduce((max,r)=>Math.max(max,r.length),head.length);
    const cols:Col<Record<string,unknown>>[]=Array.from({length:width},(_,i)=>({key:`c${i}`,label:head[i]||`#${i+1}`,clip:true,hidden:i>=12}));
    return{cols,rows:body.map(r=>Object.fromEntries(cols.map((c,i)=>[c.key,r[i]??''])))};
  },[text,path]);
  return <DataTable name={name} label={name} rows={rows} cols={cols} testId="viewer-csv" />;
}

/**
 * One PDF page: it reports whether it is near the viewport (`onNear`, the observer stays connected) and is drawn while
 * `drawn` (pdfPagesToDraw); otherwise its canvas is emptied and the page's pdf.js resources freed, so memory stays
 * bounded on a long PDF. Its box keeps its size, so the scroll does not jump. The width moves in 40 px steps, so a resize
 * redraws it only now and then.
 */
function PdfPage({doc,n,width,root,drawn,onNear}:{doc:PDFDocumentProxy;n:number;width:number;root:HTMLElement|null;drawn:boolean;onNear:(n:number,near:boolean)=>void}){
  const ref=useRef<HTMLCanvasElement>(null),busy=useRef<Promise<void>>(Promise.resolve()),proxy=useRef<PDFPageProxy|null>(null);const[ratio,setRatio]=useState(1.414);
  useEffect(()=>{
    const canvas=ref.current;if(!canvas)return;
    const observer=new IntersectionObserver(entries=>{const last=entries[entries.length-1];if(last)onNear(n,last.isIntersecting);},{root,rootMargin:'800px 0px'});
    observer.observe(canvas);
    return()=>{observer.disconnect();onNear(n,false);};
  },[n,root,onNear]);
  useEffect(()=>{
    const canvas=ref.current;if(!canvas)return;let live=true,task:{cancel():void}|null=null;
    if(!drawn||!width){
      // released once a cancelled render lets go of the canvas: an empty bitmap and the page's resources freed
      void busy.current.then(()=>{if(!live)return;canvas.width=0;canvas.height=0;delete canvas.dataset.rendered;proxy.current?.cleanup();proxy.current=null;});
      return()=>{live=false;};
    }
    const draw=async()=>{
      // a cancelled render still holds the canvas until its promise settles
      const page=await doc.getPage(n);await busy.current;if(!live)return;proxy.current=page;
      const plain=page.getViewport({scale:1}),scale=width/plain.width,dpr=window.devicePixelRatio||1,view=page.getViewport({scale:scale*dpr});
      setRatio(plain.height/plain.width);canvas.width=Math.floor(view.width);canvas.height=Math.floor(view.height);
      const render=page.render({canvas,viewport:view});task=render;busy.current=render.promise.catch(()=>{});await busy.current;
      if(live)canvas.dataset.rendered='true';
    };
    void draw();
    return()=>{live=false;task?.cancel();};
  },[doc,n,width,drawn]);
  return <canvas ref={ref} className="bx-pdf-page" aria-label={t('viewer.pdfPage',{n})} style={{width,height:width*ratio}} data-testid="viewer-pdf-page"/>;
}

function Pdf({data,name}:{data:Uint8Array;name:string}){
  const host=useRef<HTMLDivElement>(null);
  const[state,setState]=useState<{doc:PDFDocumentProxy}|'error'|null>(null),[width,setWidth]=useState(0);
  useEffect(()=>{
    let live=true,destroy:(()=>void)|null=null;
    void import('../lib/pdf').then(({openPdf})=>{const task=openPdf(data);destroy=()=>void task.destroy();if(!live)destroy();return task.promise;})
      .then(doc=>{if(live)setState({doc});}).catch(()=>{if(live)setState('error');});
    return()=>{live=false;destroy?.();};
  },[data]);
  useEffect(()=>{const el=host.current;if(!el)return;const fit=()=>setWidth(Math.min(1100,Math.floor((el.clientWidth-24)/40)*40));fit();const observer=new ResizeObserver(fit);observer.observe(el);return()=>observer.disconnect();},[]);
  const doc=state&&state!=='error'?state.doc:null,total=doc?.numPages??0;
  // the pages near the viewport (from each page's observer) decide which few pages keep a drawn canvas
  const near=useRef(new Set<number>()),[drawn,setDrawn]=useState<ReadonlySet<number>>(()=>new Set());
  const onNear=useCallback((n:number,on:boolean)=>{
    const pages=near.current;if(on===pages.has(n))return;if(on)pages.add(n);else pages.delete(n);
    setDrawn(prev=>{const next=pdfPagesToDraw(pages,total);return samePages(prev,next)?prev:next;});
  },[total]);
  return <div ref={host} className="bx-pdf bx-scroll" aria-label={name} data-testid="viewer-pdf" data-pages={doc?.numPages}>
    {state==='error'?<Empty title={t('viewer.pdf')}/>:!doc?<p role="status">{t('viewer.loading')}</p>
      :<>{Array.from({length:total},(_,i)=><PdfPage key={i} doc={doc} n={i+1} width={width} root={host.current} drawn={drawn.has(i+1)} onNear={onNear}/>)}</>}
  </div>;
}

/** A standalone raster uses the same explicit zoom/region review flow as an image inside a report. */
function ImageBody({result,wide=false}:{result:Extract<FileViewResult,{kind:'image'}>;wide?:boolean}){
  const [open,setOpen]=useState(false),close=useCallback(()=>setOpen(false),[]);
  const [fitWidth,setFitWidth]=useState(wide);
  const name=baseName(result.path);
  return <><div className="bx-row vw-tools"><button type="button" className="vw-toggle" aria-pressed={fitWidth} onClick={()=>setFitWidth(!fitWidth)} data-testid="viewer-image-width">{t('viewer.imageFitWidth')}</button></div>
  <button type="button" className={`viewer-image-open${fitWidth?' is-wide':''}`} onClick={()=>setOpen(true)} aria-label={t('viewer.imageZoom')}>
    <img src={result.dataUrl} alt={name}/>
  </button>{open&&<Suspense fallback={null}><ImageZoom images={[{src:result.dataUrl,caption:name,imagePath:result.path,reportFile:result.path}]} index={0} onMove={()=>{}} onClose={close} testBase="viewer"/></Suspense>}</>;
}

/** Where a page sits in a file that does not fit one page, with first/previous/next/last (none for a UTF-16 file). */
function Pager({result,go}:{result:TextResult;go:(page:Request)=>void}){
  const end=result.offset+result.shown,lines=lineCount(result.text),fixed=result.paged===false;
  return <div className="bx-row" role="status" data-testid="viewer-pager">
    <span className="small muted">{t('viewer.page',{from:fmtBytes(result.offset),to:fmtBytes(end),total:fmtBytes(result.size)})}{result.firstLine?` · ${t('viewer.lines',{first:result.firstLine,last:result.firstLine+Math.max(0,lines-1)})}`:''}</span><span className="sp"/>
    <button type="button" className="bx-btn s" disabled={fixed||result.offset===0} onClick={()=>go({})}>{t('viewer.pageFirst')}</button>
    <button type="button" className="bx-btn s" disabled={fixed||result.offset===0} onClick={()=>go({before:result.offset})} data-testid="viewer-page-previous">{t('viewer.pagePrevious')}</button>
    <button type="button" className="bx-btn s" disabled={fixed||!result.more} onClick={()=>go({offset:end})} data-testid="viewer-page-next">{t('viewer.pageNext')}</button>
    <button type="button" className="bx-btn s" disabled={fixed||!result.more} onClick={()=>go(result.size-FILE_PAGE_BYTES>end?{offset:result.size-FILE_PAGE_BYTES,align:true}:{offset:end})} data-testid="viewer-page-last">{t('viewer.pageLast')}</button>
  </div>;
}

type Mode='formatted'|'source';
/** The views a kind offers besides its source (markdown rendered, a table, pretty JSON); `code` has only the source. */
const formattedLabel=(view:FileView)=>view==='csv'||view==='jsonl'?t('viewer.table'):view==='html'?t('viewer.report'):t('viewer.formatted');
const WRAP_KEY='sb.viewer.wrap';
const readWrap=()=>{try{return localStorage.getItem(WRAP_KEY)==='1';}catch{return false;}};

/** `line` = the cited line, only while the page is the one opened around it. */
function TextBody({result,line,go,picked,onPick}:{result:TextResult;line?:number;go:(page:Request)=>void;picked?:number;onPick?:(n:number)=>void}){
  const view=viewOf(result.path),name=baseName(result.path),base=result.firstLine??null;
  const pretty=useMemo(()=>view==='json'&&!result.more&&result.offset===0?prettyJson(result.text):null,[view,result.text,result.more,result.offset]);
  // a page further into the file is shown as its source: a table or a document cut from the middle would mislead
  const formattable=result.offset===0&&view!=='code'&&!(view==='json'&&!pretty)&&!(view==='html'&&result.more);
  const [mode,setMode]=useState<Mode>(line?'source':'formatted');
  const [wrap,setWrapState]=useState(readWrap);
  const setWrap=(on:boolean)=>{setWrapState(on);try{localStorage.setItem(WRAP_KEY,on?'1':'0');}catch{/* storage off: this session only */}};
  const shown=formattable?mode:'source';
  const code=shown==='source'||view==='json';
  const missing=!!line&&(!base||line<base||line>=base+lineCount(result.text));
  return <>
    {(formattable||code)&&<div className="bx-row vw-tools">
      {formattable&&<Seg label={t('viewer.mode')} value={mode} onChange={setMode} items={[{id:'formatted',label:formattedLabel(view)},{id:'source',label:t('viewer.source')}]}/>}
      <span className="sp"/>
      {code&&<button type="button" className="vw-toggle" aria-pressed={wrap} onClick={()=>setWrap(!wrap)} data-testid="viewer-wrap">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h13a3 3 0 0 1 0 6h-4M4 18h5M14 15.5 11.5 18l2.5 2.5"/></svg>
        {t('vw.wrap')}</button>}
    </div>}
    {(result.more||result.offset>0)&&<Pager result={result} go={go}/>}
    {missing&&<p role="status">{t('viewer.lineUnavailable')}</p>}
    {shown==='source'?<Code text={result.text} path={result.path} line={line} base={base} wrap={wrap} picked={picked} onPick={onPick}/>
      :view==='markdown'?<Markdown text={result.text} files={new Set()} root="" imageBase={result.path} name={name} copyBlocks testId="viewer-markdown"/>
      :view==='html'?<ReportHtml text={result.text} path={result.path}/>
      :view==='jsonl'?<Jsonl text={result.text} name={name}/>
      :view==='csv'?<Csv text={result.text} path={result.path} name={name}/>
      :<Code text={pretty??result.text} path={result.path} wrap={wrap}/>}
  </>;
}

async function showInFolder(path:string){
  const res=await window.sb.invoke('app:showInFolder',{path}).catch(()=>null);
  if(!res)toast(t('viewer.folderError'));else if(res.how!=='folder')toast(res.reason);
}

/** The colour family of a file's badge in the header. */
function badgeTone(path:string,kind:FileViewResult['kind']|undefined):string{
  if(kind==='image')return'image';if(kind==='pdf')return'pdf';
  const v=viewOf(path);return v==='code'?'code':v;
}
/** A 24-unit stroke icon (the header's actions). */
const Ico=({d,size=15}:{d:string;size?:number})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d}/></svg>;
const LINK_ICON='M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1';
const FOLDER_ICON='M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z';
const COMPARE_ICON='M8 4v16M16 4v16M4 8l4-4 4 4M12 16l4 4 4-4';

/** The controls the viewer overlay puts in the header: before the file badge (back/forward) and after the actions
 *  (expand, close). Without them (the old page) the header has the file's own actions only. */
export interface ViewerChrome{start?:ReactNode;end?:ReactNode}

/** What main is asked for: the page around the cited line at first, then the page the pager moved to. */
type Request={line?:number;offset?:number;align?:boolean;before?:number};
export function CitedFile({reference,chrome}:{reference:FileReference;chrome?:ViewerChrome}){
  const ref=JSON.stringify(reference);const[request,setRequest]=useState<{ref:string;page:Request}>({ref,page:{line:reference.line}});
  const page=request.ref===ref?request.page:{line:reference.line},key=JSON.stringify([ref,page]);
  const[state,setState]=useState<{key:string;result:FileViewResult|null}>({key:'',result:null});
  useEffect(()=>{let live=true;void import('../../sb').then(({sb})=>reference.routine?sb.invoke('routines:image',{ref:reference.routine,path:reference.path}):sb.invoke('app:readFile',{path:reference.path,chatId:reference.chatId,...page})).then(result=>{if(live)setState({key,result});}).catch(()=>{if(live)setState({key,result:{kind:'missing',reason:'missing'}});});return()=>{live=false;};},[key]);
  // the page shown so far stays on screen while the next one loads
  const[last,setLast]=useState<{ref:string;result:FileViewResult}|null>(null);
  const fresh=state.key===key?state.result:null;
  // a page that fails (the file changed or went away) keeps the page shown so far and its pager, with the error above:
  // the user can always page back or on, never left on an empty view
  const kept=last?.ref===ref&&last.result.kind==='text'?last.result:null;
  const pageError=fresh&&'reason'in fresh&&kept?fresh.reason:null;
  useEffect(()=>{if(fresh)setLast(prev=>'reason'in fresh&&prev?.ref===ref&&prev.result.kind==='text'?prev:{ref,result:fresh});},[fresh,ref]);
  const result=pageError?kept:fresh??(last?.ref===ref?last.result:null);
  const go=(page:Request)=>setRequest({ref,page});
  // another file starts at its cited line, not where the pager was
  useEffect(()=>{setRequest({ref,page:{line:reference.line}});},[ref,reference.line]);
  const reason=result&&'reason'in result?result.reason:null;
  // the comparison is asked for per file: another file opens without it
  const[comparing,setComparing]=useState<string|null>(null),compare=comparing===ref&&result?.kind==='text';
  const real=result&&'path'in result?result.path:null;
  const shownPath=real??reference.path,name=baseName(shownPath)||shownPath,folder=shownPath.slice(0,Math.max(0,shownPath.length-name.length)).replace(/[\\/]$/,'');
  const ext=(extOf(shownPath)||'txt').slice(0,4).toUpperCase(),kind=result?.kind;
  // Ctrl+F (or F3) searches the text on screen; nothing to search in a PDF or an image
  const searchable=kind==='text';
  const[find,setFind]=useState<{key:number}|null>(null);
  const host=useRef<HTMLDivElement>(null),[main,setMain]=useState<HTMLDivElement|null>(null);
  useEffect(()=>{
    if(!searchable){setFind(null);return;}
    const k=(e:KeyboardEvent)=>{
      if(e.defaultPrevented||e.altKey||!((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.code==='KeyF'||e.key==='F3'&&!e.ctrlKey))return;
      // another dialog in front (a large image, the palette): its keys are its own
      const me=host.current;if(!me||[...document.querySelectorAll('[aria-modal="true"]')].some(d=>!d.contains(me)))return;
      e.preventDefault();setFind(f=>({key:(f?.key??0)+1}));
    };
    window.addEventListener('keydown',k);return()=>window.removeEventListener('keydown',k);
  },[searchable]);
  const[picked,setPicked]=useState<number|undefined>(undefined);
  const copyLine=useCallback((n:number)=>{setPicked(n);void copyText(fileLink(reference,n)).then(ok=>toast(ok?t('vw.lineLinkCopied',{n}):t('vw.copyFailed')));},[reference]);
  const copyPath=()=>void copyText(shownPath).then(ok=>toast(ok?t('vw.pathCopied'):t('vw.copyFailed')));
  const copyFileLink=()=>void copyText(fileLink(reference,picked??reference.line)).then(ok=>toast(ok?t('vw.linkCopied'):t('vw.copyFailed')));
  const lineNote=reference.line?`:${reference.line}${reference.column?`:${reference.column}`:''}`:'';
  return <div ref={host} className="bx-viewer vw-file" tabIndex={-1} data-testid="cited-file-viewer" data-kind={kind}>
    <header className="vw-head">
      {chrome?.start}
      <span className={`vw-badge vw-badge-${badgeTone(shownPath,kind)}`} aria-hidden="true">{ext}</span>
      <div className="vw-title">
        <h2 className="vw-name" title={shownPath} data-testid="viewer-name">{name}{lineNote&&<span className="vw-line">{lineNote}</span>}</h2>
        <div className="vw-meta">
          {folder&&<span className="vw-path" title={shownPath}><bdi>{folder}</bdi></span>}
          {result&&'size'in result&&<span className="vw-chip">{fmtBytes(result.size)}</span>}
          {(kind==='text'||kind==='image'||kind==='pdf')&&<span className="vw-chip">{t(`vw.kind.${kind==='text'?viewOf(shownPath):kind}`)}</span>}
          <span className="vw-chip vw-chip-ro">{t('viewer.readOnly')}</span>
        </div>
      </div>
      <div className="vw-actions">
        {searchable&&<button type="button" className="vw-icon-btn" aria-pressed={!!find} onClick={()=>setFind(f=>f?null:{key:1})} aria-label={t('vw.find')} data-tip={`${t('vw.find')}|Ctrl+F`} data-testid="viewer-find-open"><IconSearch/></button>}
        <button type="button" className="vw-icon-btn" onClick={copyPath} aria-label={t('viewer.copyPath')} data-tip={t('viewer.copyPath')} data-testid="viewer-copy-path"><IconCopy/></button>
        <button type="button" className="vw-icon-btn" onClick={copyFileLink} aria-label={t('vw.copyLink')} data-tip={t('vw.copyLink')} data-testid="viewer-copy-link"><Ico d={LINK_ICON}/></button>
        {real&&<button type="button" className="vw-icon-btn" onClick={()=>void showInFolder(real)} aria-label={t('viewer.showInFolder')} data-tip={t('viewer.showInFolder')} data-testid="viewer-show-in-folder"><Ico d={FOLDER_ICON}/></button>}
        {result?.kind==='text'&&<button type="button" className="vw-btn" aria-pressed={compare} onClick={()=>setComparing(compare?null:ref)} data-testid="viewer-compare"><Ico d={COMPARE_ICON} size={14}/>{t('viewer.compare')}</button>}
        {chrome?.end}
      </div>
    </header>
    <div className="vw-stage">
      {find&&searchable&&<FindBar root={main} focusKey={find.key} onClose={()=>{setFind(null);host.current?.focus();}}/>}
      <div className="vw-body bx-scroll" data-testid="viewer-body">
        <div className="vw-grid">
          <Toc root={main}/>
          <div ref={setMain} className="vw-main file-context-main">
            {compare&&<Compare key={ref} path={reference.path} chatId={reference.chatId}/>}
            {pageError&&<p role="alert" data-testid="viewer-page-error">{t(`viewer.${pageError}`)}</p>}
            <ReportReview key={real??ref} file={real??reference.path} snapshot={result&&'size'in result?{size:result.size,...('mtimeMs'in result&&typeof result.mtimeMs==='number'?{mtimeMs:result.mtimeMs}:{}),...(result.kind==='text'?{offset:result.offset,shown:result.shown}:{})}:undefined}>{!result?<p role="status" className="vw-loading">{t('viewer.loading')}</p>:reason?<Empty title={t(`viewer.${reason}`)}/>
              :result.kind==='image'?<ImageBody key={result.path} result={result} wide={!!reference.routine}/>
              :result.kind==='pdf'?<Pdf key={ref} data={result.data} name={baseName(result.path)}/>
              :result.kind==='text'?<TextBody key={ref} result={result} line={page.line} go={go} picked={picked} onPick={copyLine}/>:null}</ReportReview>
          </div>
        </div>
      </div>
    </div>
  </div>;
}

export function FileViewer({arg}:{arg?:string}){const reference=readFileViewArg(arg);return reference?<CitedFile reference={reference}/>:<Empty title={t('viewer.chooseFile')}/>;}
