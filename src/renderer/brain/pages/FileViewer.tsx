// The one read-only viewer for every file link (SPEC 22): markdown rendered, code and config highlighted (highlight.js,
// one lazy chunk per language), CSV/TSV and JSONL as tables, JSON pretty-printed, images, PDFs (pdf.js, canvas only);
// a big text file comes one page at a time (main cuts it at line ends; a cited line opens its own page); "Compare" shows
// its diff against git HEAD, a commit/branch or another file (FileDiff.tsx). Main reads any
// local file, bounded (never a network share); nothing here edits, runs or hands the file to another app: "Show in
// folder" only selects it in Explorer, on the user's click.
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import DOMPurify from 'dompurify';
import {DataTable,type Col} from '../components/DataTable';
import {Markdown} from '../components/Markdown';
import {Empty} from '../components/States';
import {copyText,IconCopy,IconExternal,Seg,toast} from '../components/ui';
import {baseName} from '../lib/text';
import {fmtBytes,highlightLines,parseCsv,prettyJson,viewOf,type FileView} from '../lib/file-format';
import {Compare} from './FileDiff';
import type {PDFDocumentProxy,PDFPageProxy} from '../lib/pdf';
import {pdfPagesToDraw,samePages} from '../lib/pdf-window';
import {t} from '../../i18n';
import { ContextPulse } from '../../components/ContextPulse';
import { filePulsePlace } from '../../lib/pulse-context';
import { useApp } from '../../store/store';
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
/** `base` = the file line number of the text's first line (none: main did not count that far, so no numbers). */
function Code({ text, path, line, base=1 }: { text: string; path: string; line?: number; base?: number|null }) {
  const ref = useRef<HTMLPreElement>(null);
  // rows follow main's line rule (lineCount): a lone \r stays inside its row, so a page's numbers match main's
  const flat = useMemo(()=>lineText(text),[text]);
  const lines = useMemo(()=>flat.split('\n'),[flat]);
  const at = line&&base?line-base+1:undefined;
  // a very long text without a cited line is one plain block, so it is not highlighted either
  const html = useHighlight(flat,path,lines.length<=WINDOW||!!at);
  const w = String(lines.length+(base??1)).length;
  useEffect(() => {const pre=ref.current,target=line?pre?.querySelector<HTMLElement>(`[data-l="${line}"]`):null;if(pre&&target)pre.scrollTop+=target.getBoundingClientRect().top-pre.getBoundingClientRect().top-pre.clientHeight/2;}, [line, text, html]);
  // a very long text stays one text block (one element per line would slow the page down)
  if (lines.length > WINDOW&&!at) return <pre ref={ref} className="bx-code bx-scroll" style={{ maxHeight: '70vh' }} data-testid="bx-code">{text}</pre>;
  const first=lines.length>WINDOW?Math.max(0,Math.min(lines.length-WINDOW,(at??1)-WINDOW/2)):0,number=(i:number)=>base?i+base:null;
  return (
    <pre ref={ref} className="bx-code bx-scroll hljs" style={{ maxHeight: '70vh' }} data-testid="bx-code" data-highlighted={html?'true':undefined}>
      {first>0&&<div>{t('viewer.window',{first:first+(base??1),last:Math.min(lines.length,first+WINDOW)+(base??1)-1,total:lines.length+(base??1)-1})}</div>}
      {lines.slice(first,first+WINDOW).map((l, offset) => {const i=first+offset,h=html?.[i],n=number(i);return <div key={i} data-l={n??undefined} style={n!==null&&n === line ? { background: 'var(--bx-amber-bg)' } : undefined}>{n!==null&&<span style={{ color: 'var(--bx-text-4)', userSelect: 'none', display: 'inline-block', width: `${w + 2}ch` }}>{n}</span>}{h?<span dangerouslySetInnerHTML={{__html:h||' '}}/>:l || ' '}</div>;})}
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
const formattedLabel=(view:FileView)=>view==='csv'||view==='jsonl'?t('viewer.table'):t('viewer.formatted');

/** `line` = the cited line, only while the page is the one opened around it. */
function TextBody({result,line,go}:{result:TextResult;line?:number;go:(page:Request)=>void}){
  const view=viewOf(result.path),name=baseName(result.path),base=result.firstLine??null;
  const pretty=useMemo(()=>view==='json'&&!result.more&&result.offset===0?prettyJson(result.text):null,[view,result.text,result.more,result.offset]);
  // a page further into the file is shown as its source: a table or a document cut from the middle would mislead
  const formattable=result.offset===0&&view!=='code'&&!(view==='json'&&!pretty);
  const [mode,setMode]=useState<Mode>(line?'source':'formatted');
  const shown=formattable?mode:'source';
  const missing=!!line&&(!base||line<base||line>=base+lineCount(result.text));
  return <>
    {formattable&&<div className="bx-row"><Seg label={t('viewer.mode')} value={mode} onChange={setMode} items={[{id:'formatted',label:formattedLabel(view)},{id:'source',label:t('viewer.source')}]}/></div>}
    {(result.more||result.offset>0)&&<Pager result={result} go={go}/>}
    {shown==='formatted'&&view==='markdown'&&/!\[|<img\b/i.test(result.text)&&<p className="small muted">{t('viewer.documentImages')}</p>}
    {missing&&<p role="status">{t('viewer.lineUnavailable')}</p>}
    {shown==='source'?<Code text={result.text} path={result.path} line={line} base={base}/>
      :view==='markdown'?<Markdown text={result.text} files={new Set()} root="" images={false} name={name} copyBlocks testId="viewer-markdown"/>
      :view==='jsonl'?<Jsonl text={result.text} name={name}/>
      :view==='csv'?<Csv text={result.text} path={result.path} name={name}/>
      :<Code text={pretty??result.text} path={result.path}/>}
  </>;
}

async function showInFolder(path:string){
  const res=await window.sb.invoke('app:showInFolder',{path}).catch(()=>null);
  if(!res)toast(t('viewer.folderError'));else if(res.how!=='folder')toast(res.reason);
}

/** What main is asked for: the page around the cited line at first, then the page the pager moved to. */
type Request={line?:number;offset?:number;align?:boolean;before?:number};
function CitedFile({reference}:{reference:FileReference}){
  const brainRoot = useApp(s => s.info?.brainRoot);
  const ref=JSON.stringify(reference);const[request,setRequest]=useState<{ref:string;page:Request}>({ref,page:{line:reference.line}});
  const page=request.ref===ref?request.page:{line:reference.line},key=JSON.stringify([ref,page]);
  const[state,setState]=useState<{key:string;result:FileViewResult|null}>({key:'',result:null});
  useEffect(()=>{let live=true;void import('../../sb').then(({sb})=>sb.invoke('app:readFile',{path:reference.path,chatId:reference.chatId,...page})).then(result=>{if(live)setState({key,result});}).catch(()=>{if(live)setState({key,result:{kind:'missing',reason:'missing'}});});return()=>{live=false;};},[key]);
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
  const pulsePlace = real ? filePulsePlace(real, brainRoot) : null;
  return <div className="bx-viewer" data-testid="cited-file-viewer">
    <div className="bx-viewer-head"><h2>{reference.path}{reference.line?`:${reference.line}${reference.column?`:${reference.column}`:''}`:''}</h2><span className="sp"/>
      <span className="small muted">{t('viewer.readOnly')}{result&&'size'in result?` · ${fmtBytes(result.size)}`:''}</span>
      <button type="button" className="bx-btn s" onClick={()=>void copyText(real??reference.path)}><IconCopy/>{t('viewer.copyPath')}</button>
      {result?.kind==='text'&&<button type="button" className="bx-btn s" aria-pressed={compare} onClick={()=>setComparing(compare?null:ref)} data-testid="viewer-compare">{t('viewer.compare')}</button>}
      {real&&<button type="button" className="bx-btn s" onClick={()=>void showInFolder(real)} data-testid="viewer-show-in-folder"><IconExternal/>{t('viewer.showInFolder')}</button>}</div>
    {compare&&<Compare key={ref} path={reference.path} chatId={reference.chatId}/>}
    {pageError&&<p role="alert" data-testid="viewer-page-error">{t(`viewer.${pageError}`)}</p>}
    <div className="file-context-layout"><div className="file-context-main">{!result?<p role="status">{t('viewer.loading')}</p>:reason?<Empty title={t(`viewer.${reason}`)}/>
      :result.kind==='image'?<img src={result.dataUrl} alt={baseName(result.path)} style={{maxWidth:'100%',maxHeight:'75vh',objectFit:'contain'}}/>
      :result.kind==='pdf'?<Pdf key={ref} data={result.data} name={baseName(result.path)}/>
      :result.kind==='text'?<TextBody key={ref} result={result} line={page.line} go={go}/>:null}</div>
      {pulsePlace && <ContextPulse key={pulsePlace} place={pulsePlace} />}</div>
  </div>;
}

export function FileViewer({arg}:{arg?:string}){const reference=readFileViewArg(arg);return reference?<CitedFile reference={reference}/>:<Empty title={t('viewer.chooseFile')}/>;}
