// Read-only cited-file view. No directory tree or brain-wide search; main authorizes every bounded read.
import {useEffect,useMemo,useRef,useState} from 'react';
import {DataTable,type Col} from '../components/DataTable';
import {Markdown} from '../components/Markdown';
import {Empty} from '../components/States';
import {copyText,IconCopy} from '../components/ui';
import {baseName} from '../lib/text';
import {t} from '../../i18n';
import {readFileViewArg,type FileReference,type FileViewResult} from '@shared/file-view';
function Code({ text, line }: { text: string; line?: number }) {
  const ref = useRef<HTMLPreElement>(null);
  const lines = text.split(/\r?\n/);
  const w = String(lines.length).length;
  useEffect(() => {const pre=ref.current,target=line?pre?.querySelector<HTMLElement>(`[data-l="${line}"]`):null;if(pre&&target)pre.scrollTop+=target.getBoundingClientRect().top-pre.getBoundingClientRect().top-pre.clientHeight/2;}, [line, text]);
  // a very long file stays one text block (one element per line would slow the page down)
  if (lines.length > 4000&&!line) return <pre ref={ref} className="bx-code bx-scroll" style={{ maxHeight: '70vh' }} data-testid="bx-code">{text}</pre>;
  const first=lines.length>4000?Math.max(0,Math.min(lines.length-4000,(line??1)-2000)):0;
  return (
    <pre ref={ref} className="bx-code bx-scroll" style={{ maxHeight: '70vh' }} data-testid="bx-code">
      {first>0&&<div>{t('viewer.window',{first:first+1,last:Math.min(lines.length,first+4000),total:lines.length})}</div>}
      {lines.slice(first,first+4000).map((l, offset) => {const i=first+offset;return <div key={i} data-l={i + 1} style={i + 1 === line ? { background: 'var(--bx-amber-bg)' } : undefined}><span style={{ color: 'var(--bx-text-4)', userSelect: 'none', display: 'inline-block', width: `${w + 2}ch` }}>{i + 1}</span>{l || ' '}</div>;})}
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

function CitedFile({reference}:{reference:FileReference}){
  const key=JSON.stringify(reference);const[state,setState]=useState<{key:string;result:FileViewResult|null}>({key:'',result:null});
  useEffect(()=>{let live=true;void import('../../sb').then(({sb})=>sb.invoke('app:readFile',{path:reference.path,chatId:reference.chatId})).then(result=>{if(live)setState({key,result});}).catch(()=>{if(live)setState({key,result:{kind:'missing',reason:'missing'}});});return()=>{live=false;};},[key,reference.path,reference.chatId]);
  const result=state.key===key?state.result:null;
  const reason=result&&'reason'in result?result.reason:null;
  return <div className="bx-viewer" data-testid="cited-file-viewer">
    <div className="bx-viewer-head"><h2>{reference.path}{reference.line?`:${reference.line}${reference.column?`:${reference.column}`:''}`:''}</h2><span className="sp"/>
      <button type="button" className="bx-btn s" onClick={()=>void copyText(result&&'path'in result?result.path:reference.path)}><IconCopy/>{t('viewer.copyPath')}</button></div>
    {!result?<p role="status">{t('viewer.loading')}</p>:reason?<Empty title={t(`viewer.${reason}`)}/>:result.kind==='image'?<img src={result.dataUrl} alt={baseName(result.path)} style={{maxWidth:'100%',maxHeight:'75vh',objectFit:'contain'}}/>:result.kind==='text'?<>
      {result.more&&<p role="status">{t('viewer.truncated')}</p>}
      {!reference.line&&/\.md$/i.test(result.path)&&/!\[|<img\b/i.test(result.text)&&<p className="small muted">{t('viewer.documentImages')}</p>}
      {reference.line&&reference.line>result.text.split(/\r?\n/).length&&<p role="status">{t('viewer.lineUnavailable')}</p>}
      {!reference.line&&/\.md$/i.test(result.path)?<Markdown text={result.text} files={new Set()} root="" images={false} name={baseName(result.path)}/>:!reference.line&&/\.jsonl$/i.test(result.path)?<Jsonl text={result.text} name={baseName(result.path)}/>:<Code text={result.text} line={reference.line}/>}
    </>:null}
  </div>;
}

export function FileViewer({arg}:{arg?:string}){const reference=readFileViewArg(arg);return reference?<CitedFile reference={reference}/>:<Empty title={t('viewer.chooseFile')}/>;}
