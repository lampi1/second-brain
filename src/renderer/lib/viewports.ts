// Browser tiles ↔ WebContentsViews. A browser tab is drawn by main as a native view ABOVE the page, so the page tells
// main where each tab must be (`views:layout`): every BrowserTile registers its empty placeholder; this module
// measures them and reports the screen rects, and reports `null` for tabs not on screen or covered by an overlay
// (palette, dialogs, menus: anything registered with registerOverlay, or a modal that blocks everything).
// It reports on resize/scroll/transition, after any change (a short burst of frames covers animations) and on a
// slow safety poll, and only sends when something changed. Used by BrowserTile.tsx,
// the overlays (ui.tsx, Select.tsx, HelpTip.tsx, Overlays.tsx…) and App.tsx.
import type { Rect, ViewLayout } from '@shared/contract';

const views = new Map<string, HTMLElement>();
const overlays = new Set<HTMLElement>();
let known: string[] = [];
let blocked = false;
const suspensions = new Set<symbol>();
let lastSent = '';
let burstUntil = 0;
let raf = 0;
let lastRects: Rect[] = [];
let reporting = true;

/** Pause/resume reporting (ui:command 'layout' off/on): a test or a tool that drives views:layout itself. */
export function setReporting(on: boolean): void { reporting = on; if (on) { lastSent = ''; schedule(); } }

/** Where browser views are drawn right now (tooltips avoid them: views draw above the page). */
export const viewRects = (): Rect[] => lastRects;

const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => schedule()) : null;

export function registerView(tabId: string, el: HTMLElement): () => void {
  views.set(tabId, el);
  ro?.observe(el);
  schedule();
  return () => {
    if (views.get(tabId) === el) views.delete(tabId);
    ro?.unobserve(el);
    schedule();
  };
}

export function registerOverlay(el: HTMLElement): () => void {
  overlays.add(el);
  report(); // hide the views under it before it paints over them
  return () => { overlays.delete(el); schedule(); };
}

/** Every tab id main knows (so tabs without a tile get an explicit null). */
export function setKnownTabs(ids: string[]): void { known = ids; schedule(); }

/** A modal covers the whole window: every view hides. */
export function setBlocked(b: boolean): void {
  if (blocked === b) return;
  blocked = b;
  report();
  schedule();
}

/** Pointer drag/resize must hide native WebContentsViews before renderer drop targets receive pointer input.
 * Scoped holds compose with each other AND the existing modal blocker; releasing a drag never unmasks a modal. */
export function suspendViews(): () => void {
  const token = Symbol('workspace gesture');
  suspensions.add(token); report();
  let released = false;
  return () => {
    if (released) return;
    released = true; suspensions.delete(token); report(); schedule();
  };
}

const intersects = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Native views cannot inherit renderer clipping/visibility: intersect every scrolling/clipping ancestor explicitly. */
function clippedBounds(el:HTMLElement):{left:number;top:number;right:number;bottom:number}|null{
  const r=el.getBoundingClientRect();
  let left=Math.max(0,r.left),top=Math.max(0,r.top),right=Math.min(window.innerWidth,r.right),bottom=Math.min(window.innerHeight,r.bottom);
  for(let current:HTMLElement|null=el;current;current=current.parentElement){
    const style=getComputedStyle(current);
    if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||Number.parseFloat(style.opacity)===0)return null;
    if(current===el)continue;
    const rect=current.getBoundingClientRect(),x=rect.left+current.clientLeft,y=rect.top+current.clientTop;
    if(/^(hidden|clip|auto|scroll)$/.test(style.overflowX)){left=Math.max(left,x);right=Math.min(right,x+current.clientWidth);}
    if(/^(hidden|clip|auto|scroll)$/.test(style.overflowY)){top=Math.max(top,y);bottom=Math.min(bottom,y+current.clientHeight);}
  }
  return right>left&&bottom>top?{left,top,right,bottom}:null;
}

export function measure(): ViewLayout[] {
  const ids = new Set([...known, ...views.keys()]);
  if (!ids.size) return []; // no browser view: nothing to place (and no forced layout for the overlay rects)
  const overRects = [...overlays].filter(o => o.isConnected).map(o => o.getBoundingClientRect());
  const out: ViewLayout[] = [];
  for (const tabId of [...ids].sort()) {
    const el = views.get(tabId);
    let rect: Rect | null = null;
    if (el && !blocked && suspensions.size === 0 && el.isConnected && el.offsetParent !== null) {
      const r = clippedBounds(el);
      if(r){
        const w=r.right-r.left,h=r.bottom-r.top;
        const covered = overRects.some(o => intersects(o, r as DOMRect));
        if (w >= 24 && h >= 24 && !covered && el.dataset.hidden !== 'true') rect = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(w), height: Math.round(h) };
      }
    }
    out.push({ tabId, rect });
  }
  return out;
}

export function report(): void {
  if (!reporting) return;
  const layout = measure();
  lastRects = layout.flatMap(l => (l.rect ? [l.rect] : []));
  const key = JSON.stringify(layout);
  if (key === lastSent) return;
  lastSent = key;
  // window.sb read here, not at import: modules that only import this one (HelpTip, the brain pages) load in node tests
  void window.sb.invoke('views:layout', layout).catch(() => { lastSent = ''; });
}

/** Report on the next frames for a short while (covers CSS transitions of 120-180 ms). */
export function schedule(ms = 260): void {
  burstUntil = Math.max(burstUntil, performance.now() + ms);
  if (raf) return;
  const loop = () => {
    report();
    if (performance.now() < burstUntil) raf = requestAnimationFrame(loop);
    else raf = 0;
  };
  raf = requestAnimationFrame(loop);
}

let started = false;
export function startViewports(): void {
  if (started) return;
  started = true;
  window.addEventListener('resize', () => schedule());
  // a chat list scrolling (it follows its bottom on every streamed frame) never moves a browser view: measuring then
  // kept a layout-forcing loop running all the time while chats streamed
  document.addEventListener('scroll', e => { if (!(e.target instanceof Element && e.target.closest('.items'))) schedule(); }, true);
  document.addEventListener('transitionend', () => schedule(), true);
  setInterval(() => { if (!document.hidden) report(); }, 700); // safety net: anything that moved without an event
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
  window.addEventListener('beforeunload', () => { blocked = true; report(); });
}
