// Browser tiles ↔ WebContentsViews. A browser tab is drawn by main as a native view ABOVE the page, so the page tells
// main where each tab must be (`views:layout`): every BrowserTile registers its empty placeholder; this module
// measures them and reports the screen rects, and reports `null` for tabs not on screen or covered by an overlay
// (palette, dialogs, menus: anything registered with registerOverlay, or a modal that blocks everything).
// It reports on resize/scroll/transition, after any change (a short burst of frames covers animations) and on a
// slow safety poll, and only sends when something changed. Used by BrowserTile.tsx, Popover.tsx and App.tsx.
import type { Rect, ViewLayout } from '@shared/contract';

const views = new Map<string, HTMLElement>();
const overlays = new Set<HTMLElement>();
let known: string[] = [];
let blocked = false;
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

const intersects = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

export function measure(): ViewLayout[] {
  const ids = new Set([...known, ...views.keys()]);
  if (!ids.size) return []; // no browser view: nothing to place (and no forced layout for the overlay rects)
  const W = window.innerWidth;
  const H = window.innerHeight;
  const overRects = [...overlays].filter(o => o.isConnected).map(o => o.getBoundingClientRect());
  const out: ViewLayout[] = [];
  for (const tabId of [...ids].sort()) {
    const el = views.get(tabId);
    let rect: Rect | null = null;
    if (el && !blocked && el.isConnected && el.offsetParent !== null) {
      const r = el.getBoundingClientRect();
      const x = Math.max(0, r.left);
      const y = Math.max(0, r.top);
      const w = Math.min(W, r.right) - x;
      const h = Math.min(H, r.bottom) - y;
      const covered = overRects.some(o => intersects(o, r));
      if (w >= 24 && h >= 24 && !covered && el.dataset.hidden !== 'true') rect = { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) };
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
