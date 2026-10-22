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
import {beforeAfterPair,classifyImageSrc,embeddedRasterOk,imageComparison,isImageGalleryLead} from '../lib/report-images';
import {baseName} from '../lib/text';
import {t} from '../../i18n';
import type {ZoomImage} from '../../components/ImageZoom';
import '../../styles/report-gallery.css';
const ImageZoom=lazy(()=>import('../../components/ImageZoom').then(m=>({default:m.ImageZoom})));

const note=(doc:Document,text:string)=>{const span=doc.createElement('span');span.className='sb-img-note';span.setAttribute('role','note');span.setAttribute('data-testid','report-img-note');span.textContent=text;return span;};

/** Rewrite the <img> of `root` (any document or fragment, inert) for a report at `file`. */
export function localizeImagesIn(root:ParentNode,doc:Document,file:string):void{
  for(const img of [...root.querySelectorAll('img')]){
    const raw=img.getAttribute('src')??'';
    for(const name of ['srcset','src','loading','data-sb-src','data-sb-path','data-testid'])img.removeAttribute(name);
    const what=classifyImageSrc(raw,file);
    const alt=img.getAttribute('alt')?.trim()||(what.kind==='local'?baseName(what.path):'');
    if(what.kind==='data'&&embeddedRasterOk(what.src))img.setAttribute('src',what.src);
    else if(what.kind==='local'){img.setAttribute('data-sb-src',what.path);img.setAttribute('data-sb-path',what.path);img.classList.add('sb-img-wait');}
    else{img.replaceWith(note(doc,what.kind==='blocked'&&what.why==='remote'?t('viewer.imageRemote'):t('viewer.imageType')));continue;}
    img.setAttribute('tabindex','0');img.setAttribute('role','button');img.classList.add('sb-img');img.setAttribute('alt',alt);img.setAttribute('data-testid','report-img');img.setAttribute('title',t('viewer.imageZoom'));
  }
}

/** The same, on an HTML string (Markdown.tsx's sanitized output). */
export function localizeImages(html:string,file:string):string{
  if(!/<img\b/i.test(html))return html;
  const tpl=document.createElement('template');tpl.innerHTML=html;
  localizeImagesIn(tpl.content,document,file);
  galleryImages(tpl.content,document);
  return tpl.innerHTML;
}

/** Load the local images inside `root` and open any shown image large on a click. `version` changes when the HTML does. */
export function useReportImages(root:HTMLElement|ShadowRoot|null,version:unknown,reportFile?:string):ReactElement|null{
  const [zoom,setZoom]=useState<{images:ZoomImage[];index:number}|null>(null);
  useEffect(()=>{
    setZoom(null);
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
      // "Prima / Dopo" of a gallery: the pair in the viewer, side by side or with the slider
      const pair=e.type==='click'?(e.target as Element|null)?.closest?.('.sb-report-compare'):null;
      if(pair instanceof HTMLElement){
        e.preventDefault();e.stopPropagation();
        const side=(name:'before'|'after')=>{const img=pair.closest('.sb-report-gallery')?.querySelector<HTMLImageElement>(`img[data-sb-side="${name}"]`);
          return img?{caption:img.alt||t(name==='before'?'viewer.imageBefore':'viewer.imageAfter'),...(img.dataset.sbPath?{path:img.dataset.sbPath}:{}),...(img.src.startsWith('data:image/')?{src:img.src}:{})}:null;};
        const before=side('before'),after=side('after');
        if(before&&after)void import('../../actions').then(({openShots})=>openShots(before,after,reportFile?baseName(reportFile):undefined));
        return;
      }
      if(e instanceof KeyboardEvent&&e.key!=='Enter'&&e.key!==' ')return;
      const img=(e.target as Element|null)?.closest?.('img.sb-img');
      if(!(img instanceof HTMLImageElement)||!img.src.startsWith('data:image/'))return;
      e.preventDefault();e.stopPropagation();
      const shown=[...root.querySelectorAll<HTMLImageElement>('img.sb-img')].filter(x=>x.src.startsWith('data:image/'));
      setZoom({images:shown.map(x=>({src:x.src,caption:x.alt||t('viewer.report'),imagePath:x.dataset.sbPath,reportFile})),index:Math.max(0,shown.indexOf(img))});
    };
    root.addEventListener('click',click);root.addEventListener('keydown',click);
    return()=>{live=false;root.removeEventListener('click',click);root.removeEventListener('keydown',click);};
  },[root,version,reportFile]);
  const move=useCallback((index:number)=>setZoom(z=>z&&{...z,index}),[]),close=useCallback(()=>setZoom(null),[]);
  return zoom?<Suspense fallback={null}><ImageZoom images={zoom.images} index={zoom.index} onMove={move} onClose={close} testBase="report"/></Suspense>:null;
}

/** Image-only Markdown paragraphs become compact galleries without rearranging prose or HTML report layouts. */
export function galleryImages(root: ParentNode, doc: Document): void {
  for (const paragraph of [...root.querySelectorAll('p')]) {
    const nodes = [...paragraph.childNodes];
    const firstImage = nodes.findIndex(node => node instanceof Element && node.matches('img.sb-img'));
    const prefix = firstImage > 0 ? nodes.slice(0, firstImage) : [];
    const hasLead = prefix.length > 0 && prefix.every(node => node.nodeType === 3 || node instanceof Element && node.matches('strong,em')) && isImageGalleryLead(prefix.map(node => node.textContent ?? '').join(''));
    const bodyNodes = hasLead ? nodes.slice(firstImage) : nodes;
    if (!bodyNodes.every(node => node.nodeType === 3 ? !node.textContent?.trim() : node instanceof Element && (node.matches('img.sb-img,br') || node.matches('.sb-img-note')))) continue;
    const images = [...paragraph.querySelectorAll<HTMLImageElement>('img.sb-img')];
    if (!images.length) continue;
    const gallery = doc.createElement('div'); gallery.className = 'sb-report-gallery';
    if (hasLead) {
      const lead = doc.createElement('p'); lead.className = 'sb-report-gallery-lead'; lead.append(...prefix);
      paragraph.replaceWith(lead, gallery);
    } else paragraph.replaceWith(gallery);
    gallery.append(...paragraph.childNodes);
    for (const br of gallery.querySelectorAll('br')) br.remove();
  }
  // Consecutive image paragraphs share a grid; intervening text always keeps its position.
  for (const gallery of [...root.querySelectorAll('.sb-report-gallery')]) {
    let next = gallery.nextSibling;
    while (next) {
      if (next.nodeType === 3 && !next.textContent?.trim()) { next = next.nextSibling; continue; }
      if (!(next instanceof Element) || !next.classList.contains('sb-report-gallery')) break;
      const following = next.nextSibling; gallery.append(...next.childNodes); next.remove(); next = following;
    }
    const images = [...gallery.querySelectorAll<HTMLImageElement>('img.sb-img')];
    const comparisons = images.map(img => imageComparison(img.dataset.sbPath ?? img.alt));
    images.forEach((img, index) => {
      const card = doc.createElement('figure'); card.className = 'sb-report-image';
      const caption = doc.createElement('figcaption'); caption.textContent = img.alt;
      const comparison = comparisons[index];
      if (comparison && comparisons.filter(other => other?.key === comparison.key).length === 2 && comparisons.some(other => other?.key === comparison.key && other.side !== comparison.side)) {
        const label = doc.createElement('strong'); label.className = 'sb-report-image-side';
        label.textContent = t(comparison.side === 'before' ? 'viewer.imageBefore' : 'viewer.imageAfter');
        caption.prepend(label);
      }
      img.replaceWith(card); card.append(img,caption);
    });
    // a before and an after among them (file names or captions): one button opens the pair in the viewer's "Prima / Dopo"
    const pair = beforeAfterPair(images.map(img => ({ img, caption: img.alt, path: img.dataset.sbPath })));
    if (pair) {
      pair.before.img.setAttribute('data-sb-side', 'before'); pair.after.img.setAttribute('data-sb-side', 'after');
      const button = doc.createElement('button'); button.type = 'button'; button.className = 'sb-report-compare';
      button.setAttribute('data-testid', 'report-compare'); button.textContent = t('vw.compareShots');
      gallery.append(button);
    }
  }
}
