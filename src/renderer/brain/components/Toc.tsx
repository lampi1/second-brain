// The table of contents of a Markdown file in the viewer (the owner, 2026-10-22: a long document had no outline): a
// side rail listing its headings (h1–h3) once there are at least three, a click scrolls to one, and the section being
// read is marked as the body scrolls. It reads the rendered headings from the page (Markdown.tsx renders the HTML), so
// it follows whatever the document holds. Used by FileViewer.tsx.
import {useEffect,useRef,useState} from 'react';
import {t} from '../../i18n';

/** Fewer headings than this: no rail (a short note needs no outline). */
export const TOC_MIN=3;
interface Entry{el:HTMLElement;level:number;text:string}

const scrollerOf=(el:HTMLElement):HTMLElement|null=>{
  for(let p=el.parentElement;p;p=p.parentElement){const o=getComputedStyle(p).overflowY;if(o==='auto'||o==='scroll')return p;}
  return null;
};

export function Toc({root}:{root:HTMLElement|null}){
  const[entries,setEntries]=useState<Entry[]>([]);
  const[active,setActive]=useState(0);
  // a heading clicked stays the current one while the body glides to it (a last short section never reaches the top)
  const picked=useRef<{i:number;at:number}|null>(null);
  useEffect(()=>{
    if(!root)return;
    const read=()=>{
      const md=root.querySelector('[data-testid="viewer-markdown"]');
      const found=md?[...md.querySelectorAll<HTMLElement>('h1,h2,h3')].map(el=>({el,level:Number(el.tagName[1]),text:el.textContent?.trim()??''})).filter(e=>e.text):[];
      setEntries(prev=>prev.length===found.length&&prev.every((p,i)=>p.el===found[i]!.el&&p.text===found[i]!.text)?prev:found);
    };
    read();
    const mo=new MutationObserver(read);mo.observe(root,{childList:true,subtree:true});
    return()=>mo.disconnect();
  },[root]);
  // the current section: the last heading above the top of the reading area
  useEffect(()=>{
    const first=entries[0]?.el;const scroller=first?scrollerOf(first):null;
    if(!scroller||entries.length<TOC_MIN)return;
    let raf=0;
    const update=()=>{raf=0;
      if(picked.current&&performance.now()-picked.current.at<900){setActive(picked.current.i);return;}
      picked.current=null;
      const top=scroller.getBoundingClientRect().top+72;let i=0;entries.forEach((e,k)=>{if(e.el.getBoundingClientRect().top<=top)i=k;});
      // at the very bottom the last heading is the one being read, however short its section
      if(scroller.scrollTop+scroller.clientHeight>=scroller.scrollHeight-2)i=entries.length-1;
      setActive(i);};
    const on=()=>{if(!raf)raf=requestAnimationFrame(update);};
    update();scroller.addEventListener('scroll',on,{passive:true});
    return()=>{scroller.removeEventListener('scroll',on);if(raf)cancelAnimationFrame(raf);};
  },[entries]);
  if(entries.length<TOC_MIN)return null;
  const top=Math.min(...entries.map(e=>e.level));
  return <nav className="vw-toc" aria-label={t('vw.toc')} data-testid="viewer-toc">
    <div className="vw-toc-title">{t('vw.toc')}</div>
    <ol>{entries.map((e,i)=><li key={i} style={{['--toc-depth' as string]:e.level-top}}>
      <button type="button" aria-current={i===active?'location':undefined} data-testid="viewer-toc-item" title={e.text}
        onClick={()=>{picked.current={i,at:performance.now()};e.el.scrollIntoView({block:'start',behavior:'smooth'});setActive(i);}}>{e.text}</button></li>)}</ol>
  </nav>;
}
