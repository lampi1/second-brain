// File-local review form: an explicit text selection or image-region request opens a comment, then an explicit send or reviewable
// Orchestrator draft. Sending uses the normal queue; it never edits the file. Used by FileViewer.
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {isReportSelection,REPORT_REVIEW_EVENT,reviewDraft,type ReportSelection,type ReportSnapshot} from '../lib/report-review';
import {t} from '../../i18n';
import '../../styles/report-review.css';

export function ReportReview({file,snapshot,children}:{file:string;snapshot?:ReportSnapshot;children:ReactNode}){
  const body=useRef<HTMLDivElement>(null),input=useRef<HTMLTextAreaElement>(null);
  const [pick,setPick]=useState<ReportSelection|null>(null),[selection,setSelection]=useState<ReportSelection|null>(null);
  const pending=useRef(false);
  const [captured,setCaptured]=useState<ReportSnapshot|undefined>(undefined);
  const latestSnapshot=useRef(snapshot);latestSnapshot.current=snapshot;
  const [comment,setComment]=useState(''),[error,setError]=useState(false),[busy,setBusy]=useState(false);
  const open=(value:ReportSelection)=>{setSelection(value);setCaptured(latestSnapshot.current);setPick(null);setComment('');setError(false);};
  useEffect(()=>{
    const changed=()=>{
      const bodyRoot=body.current;
      if(!bodyRoot){setPick(null);return;}
      // Chromium exposes a shadow-local selection. Inspect only the actual report hosts within this viewer;
      // document.getSelection alone can retarget a report range to its host and lose the quoted text.
      const shadows=[...bodyRoot.querySelectorAll<HTMLElement>('.bx-report')].flatMap(host=>host.shadowRoot?[host.shadowRoot]:[]);
      const selections=shadows.map(root=>({root,sel:(root as ShadowRoot & {getSelection?:()=>Selection|null}).getSelection?.()}));
      const candidates=[...selections,{root:bodyRoot,sel:window.getSelection()}];
      for(const {root,sel} of candidates){
        if(!sel||sel.isCollapsed||!sel.rangeCount)continue;
        const range=sel.getRangeAt(0);
        let ancestor:Node|null=range.commonAncestorContainer;
        while(ancestor&&!bodyRoot.contains(ancestor)){
          const tree=ancestor.getRootNode();
          ancestor=tree instanceof ShadowRoot?tree.host:null;
        }
        if(!ancestor||!root.contains(range.commonAncestorContainer))continue;
        const start=range.startContainer.nodeType===Node.ELEMENT_NODE?range.startContainer as Element:range.startContainer.parentElement;
        const end=range.endContainer.nodeType===Node.ELEMENT_NODE?range.endContainer as Element:range.endContainer.parentElement;
        const excluded='button,textarea,input,select,summary,[data-copy],.bx-row,.bx-mdcsv';
        if(start?.closest(excluded)||end?.closest(excluded)||[...root.querySelectorAll(excluded)].some(el=>range.intersectsNode(el)))continue;
        const quote=range.toString().trim();
        if(!quote||quote.length>6000)continue;
        const line=Number(start?.closest('[data-l]')?.getAttribute('data-l'));
        // An occurrence is only a rendered-text hint within one content block, never a claimed source offset.
        const scope=start?.closest('.sb-report-root,.bx-md,pre');
        let occurrence:number|undefined;
        if(scope&&scope.contains(range.endContainer)){
          const prefix=range.cloneRange();prefix.selectNodeContents(scope);prefix.setEnd(range.startContainer,range.startOffset);
          occurrence=prefix.toString().split(quote).length;
        }
        setPick({kind:'text',quote,...(line>0?{line}:{}),...(occurrence?{occurrence}:{})});
        return;
      }
      setPick(null);
    };
    const requested=(event:Event)=>{
      const detail=(event as CustomEvent<unknown>).detail;
      if(!detail||typeof detail!=='object')return;
      const d=detail as {file?:unknown;selection?:unknown};
      if(d.file===file&&isReportSelection(d.selection))open(d.selection);
    };
    document.addEventListener('selectionchange',changed);window.addEventListener(REPORT_REVIEW_EVENT,requested);
    return()=>{document.removeEventListener('selectionchange',changed);window.removeEventListener(REPORT_REVIEW_EVENT,requested);};
  },[file]);
  useEffect(()=>{setPick(null);},[snapshot?.offset,snapshot?.shown,snapshot?.mtimeMs]);
  useEffect(()=>{if(selection)input.current?.focus();},[selection]);
  const prepare=async(draft=false)=>{
    if(!selection||!comment.trim()||pending.current)return;
    pending.current=true;
    setBusy(true);setError(false);
    try{
      const {brainBridge,orchestratorId,focusChat}=await import('../../actions');
      const text=reviewDraft(file,selection,comment,captured),id=orchestratorId();
      let accepted=false;
      if(draft)accepted=brainBridge.draftToOrchestrator(text,()=>{});
      else if(id){const {send}=await import('../../store/store');accepted=send(id,text)!=='empty';if(accepted)focusChat(id);}
      if(accepted){setSelection(null);setComment('');setPick(null);window.getSelection()?.removeAllRanges();}
      else setError(true);
    }catch{setError(true);}finally{pending.current=false;setBusy(false);}
  };
  return <div className="report-review">
    <div ref={body} className="report-review-body">{children}</div>
    {pick&&!selection&&<div className="report-review-pick"><button type="button" className="bx-btn s" onMouseDown={e=>e.preventDefault()} onClick={()=>open(pick)}>{t('viewer.reviewSelection')}</button></div>}
    {selection&&<section className="report-review-form" aria-label={t('viewer.reviewTitle')} data-testid="report-review-form">
      <div className="report-review-heading"><strong>{t('viewer.reviewTitle')}</strong><button type="button" className="bx-btn s" disabled={busy} onClick={()=>setSelection(null)}>{t('common.cancel')}</button></div>
      <blockquote>{selection.kind==='text'?selection.quote:selection.caption}{selection.kind==='image'&&selection.region&&<small>{t('viewer.reviewRegion')}</small>}</blockquote>
      <label htmlFor="report-review-comment">{t('viewer.reviewComment')}</label>
      <textarea id="report-review-comment" ref={input} value={comment} onChange={e=>setComment(e.target.value)} maxLength={4000} rows={3} placeholder={t('viewer.reviewPlaceholder')} disabled={busy}/>
      <div className="report-review-actions"><p>{t('viewer.reviewDraftHint')}</p><button type="button" className="bx-btn" disabled={busy||!comment.trim()} onClick={()=>void prepare(true)}>{t('viewer.reviewPrepare')}</button><button type="button" className="bx-btn" disabled={busy||!comment.trim()} onClick={()=>void prepare()}>{t('viewer.reviewSend')}</button></div>
      {error&&<p role="alert">{t('viewer.reviewUnavailable')}</p>}
    </section>}
  </div>;
}
