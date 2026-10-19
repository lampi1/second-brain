// An HTML report shown as a page in the file viewer (issue #83: the AT fix reports, evidence/fix-<id>/report.html, with
// their screenshots embedded as base64 or as PNG files beside them). The file is a model's output, so it is untrusted:
// - parsed with DOMParser (an inert document: no script runs, nothing loads), its body cleaned by DOMPurify (its own
//   instance): no script, no form or input, no frame, object, embed, media, base, link or meta, no event handler, no
//   SVG <image>/<use>/<foreignObject>; links: http(s) open in the system browser (target=_blank, main decides), # anchors
//   scroll inside the report, any other href is dropped;
// - its CSS (<style> blocks and style attributes) scrubbed (report-images.ts scrubCss: no url(), no @import), so a style
//   can never fetch; it lives in a shadow root, so it never restyles the app, and the host contains layout and paint
//   (a position:fixed element stays inside the report's box): that containment is the host's inline style, and the
//   report's :host / :host-context rules are dropped (stripHostSelectors), so a report cannot lift it;
// - its images through ReportImages.tsx (data: rasters, local files read by main under the allowed folders, never a
//   remote URL), each one opening large on a click.
// The CSP (img-src 'self' data:, no remote script or connect) still applies on top. Used by FileViewer.tsx.
import {useLayoutEffect,useMemo,useState} from 'react';
import DOMPurify from 'dompurify';
import {scrubCss,stripHostSelectors} from '../lib/report-images';
import {localizeImagesIn,useReportImages} from './ReportImages';

let purify:ReturnType<typeof DOMPurify>|null=null;
function sanitizer(){
  if(purify)return purify;
  purify=DOMPurify(window);
  purify.addHook('uponSanitizeAttribute',(_node,data)=>{
    if(data.attrName==='style')data.attrValue=scrubCss(data.attrValue);
  });
  purify.addHook('afterSanitizeAttributes',node=>{
    for(const name of ['xlink:href','formaction','action','background','poster','ping','srcset'])node.removeAttribute(name);
    if(!node.hasAttribute('href'))return;
    if(node.tagName.toUpperCase()!=='A'){node.removeAttribute('href');return;}
    const href=node.getAttribute('href')??'';
    if(/^https?:\/\//i.test(href)){node.setAttribute('target','_blank');node.setAttribute('rel','noopener noreferrer');}
    else if(href.startsWith('#')&&href.length>1){node.setAttribute('data-anchor',href.slice(1));node.removeAttribute('href');node.setAttribute('role','link');node.setAttribute('tabindex','0');}
    else node.removeAttribute('href');
  });
  return purify;
}

const FORBID_TAGS=['script','style','form','input','button','textarea','select','option','iframe','frame','frameset','object','embed','applet','base','link','meta','area','map','audio','video','source','track','portal','image','use','foreignObject','feImage','animate','set','animateMotion','animateTransform','noscript','template','slot','dialog'];

/** The report as {css, body}: its styles scrubbed, its body sanitized with the images rewritten (see the header). The
 *  body stays a DOM fragment, cloned into the page as nodes (never serialized and parsed again). */
export function cleanReport(html:string,file:string):{css:string;body:DocumentFragment}{
  const doc=new DOMParser().parseFromString(html,'text/html');
  const css=stripHostSelectors([...doc.querySelectorAll('style')].map(s=>scrubCss(s.textContent??'')).join('\n'))
    // the document's own :root/html/body rules apply to the report's root box
      .replace(/(^|[\s,{}>+~])(?::root|html|body)(?=[\s,{.:#[>+~]|$)/gi,'$1.sb-report-root');
  const body=sanitizer().sanitize(doc.body?.innerHTML??'',{USE_PROFILES:{html:true,svg:true},FORBID_TAGS,FORBID_ATTR:['srcset','formaction','action','xlink:href','background','poster','ping','usemap'],ALLOW_DATA_ATTR:false,RETURN_DOM_FRAGMENT:true}) as unknown as DocumentFragment;
  localizeImagesIn(body,document,file);
  return {css,body};
}

/** The look a report gets when it sets none: a white page of readable text (reports are made to be printed). */
/** The host's containment, as its inline style: no report rule can reach it (its :host rules are dropped). */
const HOST_STYLE={display:'block',contain:'layout paint',overflow:'auto',maxHeight:'75vh'} as const;
const BASE=`:host{margin-top:10px;border:1px solid var(--bx-border,#d0d4dc);border-radius:10px;background:#fff;color:#1d2330;color-scheme:light}
.sb-report-root{padding:20px 24px;font:14px/1.55 "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;overflow-wrap:anywhere}
img{max-width:100%;height:auto}
img.sb-img{cursor:zoom-in;border-radius:4px}
img.sb-img:hover{outline:2px solid #3b82f6;outline-offset:2px}
img.sb-img-wait{min-width:120px;min-height:80px;background:#eceef2}
.sb-img-note{display:inline-block;margin:4px 0;padding:4px 8px;border:1px dashed #b4bac6;border-radius:6px;font-size:12px;color:#5a6272;background:#f6f7f9}
table{border-collapse:collapse;max-width:100%}
pre{white-space:pre-wrap}`;

export function ReportHtml({text,path}:{text:string;path:string}){
  const report=useMemo(()=>cleanReport(text,path),[text,path]);
  const [host,setHost]=useState<HTMLDivElement|null>(null);
  const [root,setRoot]=useState<ShadowRoot|null>(null);
  useLayoutEffect(()=>{
    if(!host)return;
    const shadow=host.shadowRoot??host.attachShadow({mode:'open'});
    const style=document.createElement('style');style.textContent=`${BASE}\n${report.css}`;
    const page=document.createElement('div');page.className='sb-report-root';page.append(report.body.cloneNode(true));
    shadow.replaceChildren(style,page);
    setRoot(shadow);
  },[host,report]);
  useLayoutEffect(()=>{
    if(!root)return;
    // # links scroll inside the report (an href would navigate the app window)
    const go=(e:Event)=>{
      const a=(e.target as Element|null)?.closest?.('[data-anchor]');if(!a)return;
      if(e instanceof KeyboardEvent&&e.key!=='Enter')return;
      e.preventDefault();const id=a.getAttribute('data-anchor')!;
      const target=root.getElementById(id)??root.querySelector(`[name="${CSS.escape(id)}"]`);target?.scrollIntoView({block:'start',behavior:'smooth'});
    };
    root.addEventListener('click',go);root.addEventListener('keydown',go);
    return()=>{root.removeEventListener('click',go);root.removeEventListener('keydown',go);};
  },[root]);
  const zoom=useReportImages(root,report);
  return <><div ref={setHost} className="bx-report" data-testid="viewer-report" role="document" style={HOST_STYLE}/>{zoom}</>;
}
