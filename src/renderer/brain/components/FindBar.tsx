// Ctrl+F inside the file viewer (the owner, 2026-10-22: there was no search anywhere in the app): the text on screen in
// the viewer's body (code, markdown, a table, a comparison) is searched as one string, case-insensitive; the matches are
// painted with the CSS Custom Highlight API (no element is added to the page React owns) and the current one is
// brought into view. Enter / Shift+Enter (or F3 / Shift+F3) move, Esc closes; a body that changes (another page of the
// file, the source view) is searched again. Line numbers and anything marked data-find-skip are not searched.
// Used by FileViewer.tsx.
import {useEffect,useRef,useState} from 'react';
import {findOffsets} from '../lib/viewer-tools';
import {t} from '../../i18n';

interface HighlightRegistry{set(name:string,h:unknown):void;delete(name:string):void}
const registry=():HighlightRegistry|null=>(globalThis.CSS as unknown as {highlights?:HighlightRegistry}|undefined)?.highlights??null;
const HighlightCtor=():(new(...r:Range[])=>unknown)|null=>(globalThis as unknown as {Highlight?:new(...r:Range[])=>unknown}).Highlight??null;

/** The text nodes of `root` that are searched, with where each starts in their joined text. */
function textOf(root:HTMLElement):{text:string;nodes:Text[];starts:number[]}{
  const nodes:Text[]=[],starts:number[]=[];let text='';
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:n=>{
    const el=n.parentElement;
    return !el||el.closest('[data-find-skip],script,style,.vw-find')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT;
  }});
  for(let n=walker.nextNode();n;n=walker.nextNode()){nodes.push(n as Text);starts.push(text.length);text+=(n as Text).data;}
  return{text,nodes,starts};
}
/** The node and offset of a position in the joined text (binary search over the starts). */
function locate(starts:number[],nodes:Text[],at:number):[Text,number]{
  let lo=0,hi=starts.length-1;
  while(lo<hi){const mid=(lo+hi+1)>>1;if(starts[mid]!<=at)lo=mid;else hi=mid-1;}
  return[nodes[lo]!,at-starts[lo]!];
}

export function FindBar({root,onClose,focusKey}:{root:HTMLElement|null;onClose:()=>void;focusKey:number}){
  const input=useRef<HTMLInputElement>(null);
  const[query,setQuery]=useState('');
  const[ranges,setRanges]=useState<Range[]>([]);
  const[cur,setCur]=useState(0);
  const[version,setVersion]=useState(0);
  useEffect(()=>{input.current?.focus();input.current?.select();},[focusKey]);
  // the body changes (a page loads, the view switches): search again, once it settles
  useEffect(()=>{
    if(!root)return;let timer:ReturnType<typeof setTimeout>|undefined;
    const mo=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(()=>setVersion(v=>v+1),120);});
    mo.observe(root,{childList:true,subtree:true,characterData:true});
    return()=>{clearTimeout(timer);mo.disconnect();};
  },[root]);
  useEffect(()=>{
    if(!root||!query){setRanges([]);return;}
    const{text,nodes,starts}=textOf(root);
    const found=findOffsets(text,query).map(at=>{
      const r=document.createRange(),[sn,so]=locate(starts,nodes,at),[en,eo]=locate(starts,nodes,at+query.length-1);
      r.setStart(sn,so);r.setEnd(en,eo+1);return r;
    });
    setRanges(found);setCur(c=>Math.min(c,Math.max(0,found.length-1)));
  },[root,query,version]);
  // paint every match, the current one stronger, and bring it into view
  useEffect(()=>{
    const reg=registry(),H=HighlightCtor();
    const current=ranges[cur];
    if(reg&&H){
      reg.set('vw-find',new H(...ranges));
      // the current match paints over the others whatever order the registry keeps
      if(current){const h=new H(current) as {priority?:number};h.priority=1;reg.set('vw-find-current',h);}else reg.delete('vw-find-current');
    }
    const el=current?.startContainer.parentElement;
    if(el){
      const box=current.getBoundingClientRect(),view=el.closest('.vw-body,.bx-page')?.getBoundingClientRect();
      if(!view||box.top<view.top+40||box.bottom>view.bottom-24)el.scrollIntoView({block:'center',inline:'nearest'});
    }
  },[ranges,cur]);
  useEffect(()=>()=>{const reg=registry();reg?.delete('vw-find');reg?.delete('vw-find-current');},[]);
  const move=(d:1|-1)=>{if(ranges.length)setCur(c=>(c+d+ranges.length)%ranges.length);};
  const total=ranges.length;
  return <div className="vw-find" role="search" data-testid="viewer-find">
    <svg className="vw-find-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>
    <input ref={input} type="search" value={query} spellCheck={false} placeholder={t('vw.findPlaceholder')} aria-label={t('vw.findPlaceholder')} data-testid="viewer-find-input"
      onChange={e=>{setQuery(e.target.value);setCur(0);}}
      onKeyDown={e=>{
        if(e.key==='Enter'||e.key==='F3'){e.preventDefault();e.stopPropagation();move(e.shiftKey?-1:1);}
        else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onClose();}
      }}/>
    <span className="vw-find-count" role="status" aria-live="polite" data-testid="viewer-find-count" data-count={total} data-current={total?cur+1:0}>
      {!query?'':total?t('vw.findCount',{n:cur+1,total}):t('vw.findNone')}</span>
    <button type="button" className="vw-icon-btn" onClick={()=>move(-1)} disabled={!total} aria-label={t('vw.findPrevious')} data-tip={`${t('vw.findPrevious')}|⇧ ↵`} data-testid="viewer-find-prev">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 14.5 6-6 6 6"/></svg></button>
    <button type="button" className="vw-icon-btn" onClick={()=>move(1)} disabled={!total} aria-label={t('vw.findNext')} data-tip={`${t('vw.findNext')}|↵`} data-testid="viewer-find-next">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9.5 6 6 6-6"/></svg></button>
    <button type="button" className="vw-icon-btn" onClick={onClose} aria-label={t('vw.findClose')} data-testid="viewer-find-close">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg></button>
  </div>;
}
