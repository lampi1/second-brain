// The file viewer's "Compare" (SPEC 22 V3): the file now against git HEAD, a commit or branch, or another local file.
// Main reads both sides (main/file-diff.ts, read-only git); jsdiff computes the hunks in a worker (lib/diff-worker.ts)
// with a time limit, so a huge change never holds the page up. Two layouts, the choice remembered on this PC: side by
// side (old left, new right, the changed words of each paired line marked; viewer-tools.ts splitRows) or unified (one
// column, - and + lines). Nothing is written. Used by FileViewer.tsx.
import {Fragment,useEffect,useState,type FormEvent} from 'react';
import type {StructuredPatch} from 'diff';
import DiffWorker from '../lib/diff-worker?worker';
import type {DiffJob} from '../lib/diff-worker';
import {Empty} from '../components/States';
import {Seg} from '../components/ui';
import {splitRows,type Cell,type SplitRow} from '../lib/viewer-tools';
import {t} from '../../i18n';
import type {DiffAgainst,FileDiffReason,FileDiffResult} from '@shared/file-diff';
type Diff=Extract<FileDiffResult,{kind:'diff'}>;
const DIFF_MS=3000;
/** Rows drawn at most (one element each); a longer comparison says it is cut. */
const DIFF_ROWS=20_000;
const reason=(r:FileDiffReason)=>({outside:t('viewer.outside'),missing:t('viewer.missing'),unsupported:t('viewer.unsupported'),binary:t('viewer.diffBinary'),big:t('viewer.diffBig'),repo:t('viewer.diffRepo'),untracked:t('viewer.diffUntracked'),ref:t('viewer.diffRef'),git:t('viewer.diffGit')} satisfies Record<FileDiffReason,string>)[r];

type Row={kind:'hunk'|'add'|'del'|'same'|'note';text:string;old?:number;now?:number};
function rows(patch:StructuredPatch):{rows:Row[];added:number;removed:number}{
  const all:Row[]=[];let added=0,removed=0;
  for(const h of patch.hunks){
    // as git writes it: an empty side starts at line 0
    all.push({kind:'hunk',text:`@@ -${h.oldLines?h.oldStart:h.oldStart-1},${h.oldLines} +${h.newLines?h.newStart:h.newStart-1},${h.newLines} @@`});
    let old=h.oldStart,now=h.newStart;
    for(const line of h.lines){
      const sign=line[0],text=line.slice(1);
      if(sign==='+'){added++;all.push({kind:'add',text,now:now++});}
      else if(sign==='-'){removed++;all.push({kind:'del',text,old:old++});}
      else if(sign===' ')all.push({kind:'same',text,old:old++,now:now++});
      else all.push({kind:'note',text:line});
    }
  }
  return{rows:all,added,removed};
}

type Layout='split'|'unified';
const LAYOUT_KEY='sb.viewer.diffLayout';
const readLayout=():Layout=>{try{return localStorage.getItem(LAYOUT_KEY)==='unified'?'unified':'split';}catch{return 'split';}};

function SplitCell({cell}:{cell?:Cell}){
  if(!cell)return <><span className="bx-diff-n bx-split-n bx-split-void" data-find-skip/><span className="bx-split-text bx-split-void"/></>;
  return <><span className={`bx-diff-n bx-split-n bx-split-${cell.kind}`} data-find-skip>{cell.n}</span>
    <span className={`bx-split-text bx-split-${cell.kind}`} data-kind={cell.kind==='same'?undefined:cell.kind}>{cell.parts?cell.parts.map((p,i)=>p.changed?<mark key={i} className="bx-word">{p.text}</mark>:<Fragment key={i}>{p.text}</Fragment>):cell.text||' '}</span></>;
}
function SplitView({rows,w}:{rows:SplitRow[];w:number}){
  return <div className="bx-split bx-code" style={{['--bx-diff-w' as string]:`${w}ch`}} data-testid="viewer-diff-split">
    {rows.slice(0,DIFF_ROWS).map((r,i)=>r.kind==='hunk'?<div key={i} className="bx-split-hunk">{r.text}</div>
      :<div key={i} className="bx-split-row"><SplitCell cell={r.left}/><SplitCell cell={r.right}/></div>)}
    {rows.length>DIFF_ROWS&&<div className="bx-diff-note">{t('viewer.diffCut',{n:DIFF_ROWS})}</div>}
  </div>;
}

export function DiffView({diff}:{diff:Diff}){
  const[layout,setLayoutState]=useState<Layout>(readLayout);
  const setLayout=(l:Layout)=>{setLayoutState(l);try{localStorage.setItem(LAYOUT_KEY,l);}catch{/* storage off: this session only */}};
  const[state,setState]=useState<{diff:Diff;patch:StructuredPatch|'slow'}|null>(null);
  useEffect(()=>{
    const worker=new DiffWorker();
    worker.onmessage=({data}:MessageEvent<StructuredPatch|null>)=>{setState({diff,patch:data??'slow'});worker.terminate();};
    worker.onerror=()=>{setState({diff,patch:'slow'});worker.terminate();};
    worker.postMessage({left:diff.left,right:diff.right,timeout:DIFF_MS} satisfies DiffJob);
    return()=>worker.terminate();
  },[diff]);
  const patch=state?.diff===diff?state.patch:null;
  if(!patch)return <p role="status">{t('viewer.diffWorking')}</p>;
  if(patch==='slow')return <Empty title={t('viewer.diffSlow')}/>;
  const{rows:all,added,removed}=rows(patch);
  const split=layout==='split'?splitRows(patch):null;
  let top=1;for(const r of all)top=Math.max(top,r.old??0,r.now??0);
  const w=String(top).length+1;
  const num=(n?:number)=><span className="bx-diff-n" data-find-skip>{n??''}</span>;
  return <div className="bx-diff" data-testid="viewer-diff" data-added={added} data-removed={removed} data-layout={layout}>
    <div className="bx-row small muted"><span className="bx-diff-label">{diff.left.label}</span><span aria-hidden>→</span><span className="bx-diff-label">{diff.right.label}</span><span className="sp"/>
      <span className="bx-diff-add-n">{`+${added}`}</span><span className="bx-diff-del-n">{`−${removed}`}</span>
      <Seg label={t('vw.diffLayout')} value={layout} onChange={setLayout} items={[{id:'split',label:t('vw.diffSplit')},{id:'unified',label:t('vw.diffUnified')}]}/></div>
    {!all.length?<p role="status" data-testid="viewer-diff-same">{t('viewer.diffSame')}</p>
      :split?<SplitView rows={split} w={w}/>
      :<pre className="bx-code bx-scroll bx-diff-rows" style={{['--bx-diff-w' as string]:`${w}ch`}} data-testid="viewer-diff-rows">
        {all.slice(0,DIFF_ROWS).map((r,i)=><Fragment key={i}>{r.kind==='hunk'||r.kind==='note'
          ?<div className={`bx-diff-${r.kind}`}>{r.text}</div>
          :<div className={`bx-diff-${r.kind}`} data-kind={r.kind}>{num(r.old)}{num(r.now)}<span className="bx-diff-sign" aria-hidden>{r.kind==='add'?'+':r.kind==='del'?'−':' '}</span>{r.text||' '}</div>}</Fragment>)}
        {all.length>DIFF_ROWS&&<div className="bx-diff-note">{t('viewer.diffCut',{n:DIFF_ROWS})}</div>}
      </pre>}
  </div>;
}

/** The comparison bar and its result: HEAD at once, a commit/branch or another file after it is typed. */
export function Compare({path,chatId}:{path:string;chatId?:string}){
  const[kind,setKind]=useState<DiffAgainst['kind']>('head'),[value,setValue]=useState('');
  const[asked,setAsked]=useState<DiffAgainst|null>({kind:'head'});
  const[state,setState]=useState<{asked:DiffAgainst;result:FileDiffResult}|null>(null);
  useEffect(()=>{
    if(!asked)return;let live=true;
    window.sb.invoke('app:readFileDiff',{path,chatId,against:asked}).then(result=>{if(live)setState({asked,result});}).catch(()=>{if(live)setState({asked,result:{kind:'refused',reason:'git'}});});
    return()=>{live=false;};
  },[asked,path,chatId]);
  const choose=(next:DiffAgainst['kind'])=>{setKind(next);setAsked(next==='head'?{kind:'head'}:null);setValue('');};
  const submit=(e:FormEvent)=>{e.preventDefault();const v=value.trim();if(!v)return;setAsked(kind==='ref'?{kind,ref:v}:{kind:'file',path:v});};
  const result=state&&state.asked===asked?state.result:null;
  return <section className="bx-diff-panel" aria-label={t('viewer.compare')} data-testid="viewer-compare-panel">
    <form className="bx-row" onSubmit={submit}>
      <Seg label={t('viewer.compare')} value={kind} onChange={choose} items={[{id:'head',label:t('viewer.compareHead')},{id:'ref',label:t('viewer.compareRef')},{id:'file',label:t('viewer.compareFile')}]}/>
      {kind!=='head'&&<><input className="bx-input" type="text" spellCheck={false} value={value} onChange={e=>setValue(e.target.value)} aria-label={kind==='ref'?t('viewer.compareRef'):t('viewer.compareFile')}
        placeholder={kind==='ref'?t('viewer.refPlaceholder'):t('viewer.filePlaceholder')} data-testid="viewer-compare-input"/>
        <button type="submit" className="bx-btn s" disabled={!value.trim()} data-testid="viewer-compare-run">{t('viewer.compareRun')}</button></>}
    </form>
    {!asked?null:!result?<p role="status">{t('viewer.diffWorking')}</p>:result.kind==='refused'?<Empty title={reason(result.reason)}/>:<DiffView diff={result}/>}
  </section>;
}
