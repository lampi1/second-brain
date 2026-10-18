// The one read-only viewer for every file link (SPEC 22): markdown rendered, code and config highlighted (highlight.js,
// one lazy chunk per language), CSV/TSV and JSONL as tables, JSON pretty-printed, images. Main reads any local file,
// bounded (never a network share); nothing here edits, runs or hands the file to another app: "Show in folder" only
// selects it in Explorer, on the user's click.
import {useEffect,useMemo,useRef,useState} from 'react';
import DOMPurify from 'dompurify';
import {DataTable,type Col} from '../components/DataTable';
import {Markdown} from '../components/Markdown';
import {Empty} from '../components/States';
import {copyText,IconCopy,IconExternal,Seg,toast} from '../components/ui';
import {baseName} from '../lib/text';
import {fmtBytes,highlightLines,parseCsv,prettyJson,textLines,viewOf,type FileView} from '../lib/file-format';
import {t} from '../../i18n';
import {readFileViewArg,type FileReference,type FileViewResult} from '@shared/file-view';
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
function Code({ text, path, line }: { text: string; path: string; line?: number }) {
  const ref = useRef<HTMLPreElement>(null);
  const flat = useMemo(()=>text.replace(/\r\n?/g,'\n'),[text]);
  const lines = useMemo(()=>flat.split('\n'),[flat]);
  // a very long file without a cited line is one plain block, so it is not highlighted either
  const html = useHighlight(flat,path,lines.length<=WINDOW||!!line);
  const w = String(lines.length).length;
  useEffect(() => {const pre=ref.current,target=line?pre?.querySelector<HTMLElement>(`[data-l="${line}"]`):null;if(pre&&target)pre.scrollTop+=target.getBoundingClientRect().top-pre.getBoundingClientRect().top-pre.clientHeight/2;}, [line, text, html]);
  // a very long file stays one text block (one element per line would slow the page down)
  if (lines.length > WINDOW&&!line) return <pre ref={ref} className="bx-code bx-scroll" style={{ maxHeight: '70vh' }} data-testid="bx-code">{text}</pre>;
  const first=lines.length>WINDOW?Math.max(0,Math.min(lines.length-WINDOW,(line??1)-WINDOW/2)):0;
  return (
    <pre ref={ref} className="bx-code bx-scroll hljs" style={{ maxHeight: '70vh' }} data-testid="bx-code" data-highlighted={html?'true':undefined}>
      {first>0&&<div>{t('viewer.window',{first:first+1,last:Math.min(lines.length,first+WINDOW),total:lines.length})}</div>}
      {lines.slice(first,first+WINDOW).map((l, offset) => {const i=first+offset,h=html?.[i];return <div key={i} data-l={i + 1} style={i + 1 === line ? { background: 'var(--bx-amber-bg)' } : undefined}><span style={{ color: 'var(--bx-text-4)', userSelect: 'none', display: 'inline-block', width: `${w + 2}ch` }}>{i + 1}</span>{h?<span dangerouslySetInnerHTML={{__html:h||' '}}/>:l || ' '}</div>;})}
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

type Mode='formatted'|'source';
/** The views a kind offers besides its source (markdown rendered, a table, pretty JSON); `code` has only the source. */
const formattedLabel=(view:FileView)=>view==='csv'||view==='jsonl'?t('viewer.table'):t('viewer.formatted');

function TextBody({result,reference}:{result:Extract<FileViewResult,{kind:'text'}>;reference:FileReference}){
  const view=viewOf(result.path),name=baseName(result.path);
  const pretty=useMemo(()=>view==='json'?prettyJson(result.text):null,[view,result.text]);
  const formattable=view!=='code'&&!(view==='json'&&!pretty);
  const [mode,setMode]=useState<Mode>(reference.line?'source':'formatted');
  const shown=formattable?mode:'source';
  return <>
    {formattable&&<div className="bx-row"><Seg label={t('viewer.mode')} value={mode} onChange={setMode} items={[{id:'formatted',label:formattedLabel(view)},{id:'source',label:t('viewer.source')}]}/></div>}
    {result.more&&<p role="status" data-testid="viewer-truncated">{t('viewer.truncated',{shown:fmtBytes(result.shown),total:fmtBytes(result.size)})}</p>}
    {shown==='formatted'&&view==='markdown'&&/!\[|<img\b/i.test(result.text)&&<p className="small muted">{t('viewer.documentImages')}</p>}
    {reference.line&&reference.line>textLines(result.text).length&&<p role="status">{t('viewer.lineUnavailable')}</p>}
    {shown==='source'?<Code text={result.text} path={result.path} line={reference.line}/>
      :view==='markdown'?<Markdown text={result.text} files={new Set()} root="" images={false} name={name}/>
      :view==='jsonl'?<Jsonl text={result.text} name={name}/>
      :view==='csv'?<Csv text={result.text} path={result.path} name={name}/>
      :<Code text={pretty??result.text} path={result.path}/>}
  </>;
}

async function showInFolder(path:string){
  const res=await window.sb.invoke('app:showInFolder',{path}).catch(()=>null);
  if(!res)toast(t('viewer.folderError'));else if(res.how!=='folder')toast(res.reason);
}

function CitedFile({reference}:{reference:FileReference}){
  const key=JSON.stringify(reference);const[state,setState]=useState<{key:string;result:FileViewResult|null}>({key:'',result:null});
  useEffect(()=>{let live=true;void import('../../sb').then(({sb})=>sb.invoke('app:readFile',{path:reference.path,chatId:reference.chatId})).then(result=>{if(live)setState({key,result});}).catch(()=>{if(live)setState({key,result:{kind:'missing',reason:'missing'}});});return()=>{live=false;};},[key,reference.path,reference.chatId]);
  const result=state.key===key?state.result:null;
  const reason=result&&'reason'in result?result.reason:null;
  const real=result&&'path'in result?result.path:null;
  return <div className="bx-viewer" data-testid="cited-file-viewer">
    <div className="bx-viewer-head"><h2>{reference.path}{reference.line?`:${reference.line}${reference.column?`:${reference.column}`:''}`:''}</h2><span className="sp"/>
      <span className="small muted">{t('viewer.readOnly')}{result?.kind==='text'||result?.kind==='image'?` · ${fmtBytes(result.size)}`:''}</span>
      <button type="button" className="bx-btn s" onClick={()=>void copyText(real??reference.path)}><IconCopy/>{t('viewer.copyPath')}</button>
      {real&&<button type="button" className="bx-btn s" onClick={()=>void showInFolder(real)} data-testid="viewer-show-in-folder"><IconExternal/>{t('viewer.showInFolder')}</button>}</div>
    {!result?<p role="status">{t('viewer.loading')}</p>:reason?<Empty title={t(`viewer.${reason}`)}/>:result.kind==='image'?<img src={result.dataUrl} alt={baseName(result.path)} style={{maxWidth:'100%',maxHeight:'75vh',objectFit:'contain'}}/>:result.kind==='text'?<TextBody key={key} result={result} reference={reference}/>:null}
  </div>;
}

export function FileViewer({arg}:{arg?:string}){const reference=readFileViewArg(arg);return reference?<CitedFile reference={reference}/>:<Empty title={t('viewer.chooseFile')}/>;}
