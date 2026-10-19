// The images of a report in the file viewer (issue #83), for its Markdown view and its HTML view (ReportHtml.tsx):
// - localizeImages turns a sanitized HTML string's <img> into what may be shown (report-images.ts rules): an embedded
//   raster keeps its data: URL; a local file loses its src (nothing loads by itself) and keeps the path in
//   data-sb-src, read by main later; anything else becomes a one-line note in place of the image. The string is parsed in
//   an inert <template>: nothing loads while it is rewritten.
// - useReportImages, once the HTML is on the page: each data-sb-src image is read through app:askImage (allowed folders,
//   magic bytes, size; the same loader as the questions' thumbnails, AskImages.tsx) and gets its data: URL, or a note
//   saying why not; a click on any shown image opens it large in the app's image viewer (ImageZoom.tsx, the questions'
//   look), with ← → across the report's images. Both modules load on demand: the brain pages never pull the app bridge.
// Used by Markdown.tsx (imageBase) and ReportHtml.tsx, inside FileViewer.tsx.
import {lazy,Suspense,useCallback,useEffect,useState,type ReactElement} from 'react';
import {classifyImageSrc,embeddedRasterOk} from '../lib/report-images';
import {baseName} from '../lib/text';
import {t} from '../../i18n';
const ImageZoom=lazy(()=>import('../../components/ImageZoom').then(m=>({default:m.ImageZoom})));

const note=(doc:Document,text:string)=>{const span=doc.createElement('span');span.className='sb-img-note';span.setAttribute('role','note');span.setAttribute('data-testid','report-img-note');span.textContent=text;return span;};

/** Rewrite the <img> of `root` (any document or fragment, inert) for a report at `file`. */
export function localizeImagesIn(root:ParentNode,doc:Document,file:string):void{
  for(const img of [...root.querySelectorAll('img')]){
    const raw=img.getAttribute('src')??'';
    for(const name of ['srcset','src','loading','data-sb-src','data-testid'])img.removeAttribute(name);
    const what=classifyImageSrc(raw,file);
    const alt=img.getAttribute('alt')?.trim()||(what.kind==='local'?baseName(what.path):'');
    if(what.kind==='data'&&embeddedRasterOk(what.src))img.setAttribute('src',what.src);
    else if(what.kind==='local'){img.setAttribute('data-sb-src',what.path);img.classList.add('sb-img-wait');}
    else{img.replaceWith(note(doc,what.kind==='blocked'&&what.why==='remote'?t('viewer.imageRemote'):t('viewer.imageType')));continue;}
    img.classList.add('sb-img');img.setAttribute('alt',alt);img.setAttribute('data-testid','report-img');img.setAttribute('title',t('viewer.imageZoom'));
  }
}

/** The same, on an HTML string (Markdown.tsx's sanitized output). */
export function localizeImages(html:string,file:string):string{
  if(!/<img\b/i.test(html))return html;
  const tpl=document.createElement('template');tpl.innerHTML=html;
  localizeImagesIn(tpl.content,document,file);
  return tpl.innerHTML;
}

/** Load the local images inside `root` and open any shown image large on a click. `version` changes when the HTML does. */
export function useReportImages(root:HTMLElement|ShadowRoot|null,version:unknown):ReactElement|null{
  const [zoom,setZoom]=useState<{images:{src:string;caption:string}[];index:number}|null>(null);
  useEffect(()=>{
    if(!root)return;let live=true;
    const pending=[...root.querySelectorAll<HTMLImageElement>('img[data-sb-src]')];
    if(pending.length)void import('../../components/AskImages').then(({loadLocalImage})=>{
      for(const img of pending){
        const path=img.dataset.sbSrc!;
        void loadLocalImage(path).then(r=>{
          if(!live||!img.isConnected)return;
          img.classList.remove('sb-img-wait');img.removeAttribute('data-sb-src');
          if(r.kind==='image')img.src=r.dataUrl;
          else img.replaceWith(note(img.ownerDocument,t('viewer.imageNotShown',{name:img.alt||baseName(path),reason:r.reason})));
        });
      }
    });
    const click=(e:Event)=>{
      const img=(e.target as Element|null)?.closest?.('img.sb-img');
      if(!(img instanceof HTMLImageElement)||!img.src.startsWith('data:image/'))return;
      e.preventDefault();e.stopPropagation();
      const shown=[...root.querySelectorAll<HTMLImageElement>('img.sb-img')].filter(x=>x.src.startsWith('data:image/'));
      setZoom({images:shown.map(x=>({src:x.src,caption:x.alt||t('viewer.report')})),index:Math.max(0,shown.indexOf(img))});
    };
    root.addEventListener('click',click);
    return()=>{live=false;root.removeEventListener('click',click);};
  },[root,version]);
  const move=useCallback((index:number)=>setZoom(z=>z&&{...z,index}),[]),close=useCallback(()=>setZoom(null),[]);
  return zoom?<Suspense fallback={null}><ImageZoom images={zoom.images} index={zoom.index} onMove={move} onClose={close} testBase="report"/></Suspense>:null;
}
