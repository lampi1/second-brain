// The app shell: top bar, the left navigation (chat grid, brain sections, the map), the needs-you lane (Mosaico), the
// workspace (fixed Regia column with a splitter + the current view: Mosaico, Corsie or focus mode) or a brain page
// (with the Regia docked on demand), the full-screen 3D map, the notification center, toasts, the live region,
// tooltips and dialogs. It owns the global keyboard map (lib/keys.ts → actions.ts, G-letter go-to sequences), theme
// and density, highlights the element a link points to, and tells the browser-view reporter when something covers
// everything. Mounted by main.tsx.
import { useEffect, type CSSProperties } from 'react';
import { BRAIN_PAGES, BrainMap, BrainPage } from './brain';
import { goSequence, resolveShortcut } from './lib/keys';
import { schedule, setBlocked, setKnownTabs } from './lib/viewports';
import { makeLink } from './lib/notify';
import { sameList } from './store/state';
import { useApp } from './store/store';
import { openModal, closeModal, pageLabel, setMap, setPrefs, toast, toggleView, ui } from './store/ui';
import {
  back, copyLink, escapeOne, focusTile, forward, go, goTarget, nextThing, openLink, stopAllAsk, stopFocused, toggleCenter, toggleFocusMode, toggleMaximize, toggleRegia,
} from './actions';
import { TopBar } from './components/TopBar';
import { BrainSetupBanner } from './components/BrainSetupBanner';
import { Sidebar } from './components/Sidebar';
import { NeedsLane, LiveRegion } from './components/NeedsLane';
import { RegiaTile } from './components/RegiaTile';
import { Mosaico } from './components/Mosaico';
import { Corsie } from './components/Corsie';
import { FocusView } from './components/FocusView';
import { NotificationCenter } from './components/NotificationCenter';
import { CommandPalette } from './components/CommandPalette';
import { NewChatDialog } from './components/NewChatDialog';
import { ConfirmDialog, ShortcutsDialog, Toasts } from './components/Overlays';
import { HarnessMark, IconArrowLeft, IconLink } from './components/Icons';
import { Keys, TooltipLayer } from './components/ui';

const editable = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};
let gPending: number | null = null;

function onKey(e: KeyboardEvent): void {
  if (e.defaultPrevented) return;
  const u = ui.get();
  // "G then a letter": go to a section (never while typing in a field, never under a dialog)
  if (!u.modal && !editable(e.target)) {
    const r = goSequence(gPending, e, Date.now(), BRAIN_PAGES);
    gPending = r.pendingAt;
    if (r.target) { e.preventDefault(); go({ page: r.target as (typeof BRAIN_PAGES)[number]['id'] }); return; }
    if (r.handled) { e.preventDefault(); return; }
  }
  const cmd = resolveShortcut(e);
  if (!cmd) return;
  if (u.modal) {
    if (cmd.type === 'palette' && u.modal === 'palette') { e.preventDefault(); closeModal(); }
    return; // an open dialog handles its own keys
  }
  switch (cmd.type) {
    case 'palette': openModal('palette'); break;
    case 'next': nextThing(); break;
    case 'newChat': openModal('newChat'); break;
    case 'stopFocused': stopFocused(); break;
    case 'stopAll': stopAllAsk(); break;
    case 'toggleView': toggleView(); break;
    case 'maximize': toggleMaximize(); break;
    case 'focusMode': toggleFocusMode(); break;
    case 'focusTile': focusTile(cmd.index); break;
    case 'shortcuts': openModal('shortcuts'); break;
    case 'back': back(); break;
    case 'forward': forward(); break;
    case 'center': toggleCenter(); break;
    case 'regia': toggleRegia(); break;
    case 'map': if (u.map) setMap(false); else go({ page: 'mappa' }); break;
    case 'escape': if (!escapeOne()) return; break;
  }
  e.preventDefault();
}

/** Ctrl+V of an internal link anywhere outside a text field navigates there (inside Ctrl+K too). */
function onPaste(e: ClipboardEvent): void {
  if (editable(e.target) || ui.get().modal) return;
  const text = e.clipboardData?.getData('text') ?? '';
  if (/^sb:\/\//.test(text.trim()) && openLink(text)) e.preventDefault();
}

/** One toast area: the brain pages and the map show their own small toasts (brain/components/ui.tsx Toaster); in the
 *  app they are hidden (shell.css) and relayed here into the app's toasts. */
function useBrainToastRelay(): void {
  useEffect(() => {
    const mo = new MutationObserver(records => {
      for (const r of records) for (const n of r.addedNodes) {
        const el = n instanceof HTMLElement ? (n.classList.contains('bx-toast') ? n : n.querySelector?.('.bx-toast')) : null;
        const text = el?.textContent?.trim();
        if (text) toast(text, 'info');
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);
}

/** Highlight the element a link pointed to, for 1.5 s, once it is on screen. */
function useHighlight(): void {
  const h = ui.use(s => s.highlight);
  useEffect(() => {
    if (!h) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let el: HTMLElement | null = null;
    let raf = 0;
    const find = () => {
      el = document.querySelector<HTMLElement>(`[data-sb-id="${CSS.escape(h.id)}"]`);
      if (!el) { if (++tries < 30) raf = requestAnimationFrame(find); return; }
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      el.classList.remove('sb-highlight');
      void el.offsetWidth; // restart the animation
      el.classList.add('sb-highlight');
      el.dataset.highlighted = 'true';
      timer = setTimeout(() => { el?.classList.remove('sb-highlight'); if (el) delete el.dataset.highlighted; }, 1500);
    };
    raf = requestAnimationFrame(find);
    return () => { cancelAnimationFrame(raf); if (timer) clearTimeout(timer); el?.classList.remove('sb-highlight'); if (el) delete el.dataset.highlighted; };
  }, [h]);
}

function RegiaSplitter() {
  const width = ui.use(s => s.prefs.regiaWidth);
  const clamp = (w: number) => Math.round(Math.min(560, Math.max(260, w)));
  return (
    <div className="splitter v regia-split" role="separator" aria-orientation="vertical" aria-label="Larghezza della Regia" tabIndex={0} data-testid="splitter-regia"
      onPointerDown={e => {
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        const left = el.parentElement?.getBoundingClientRect().left ?? 0;
        const move = (ev: PointerEvent) => setPrefs({ regiaWidth: clamp(ev.clientX - left - 8) });
        const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); schedule(); };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
      }}
      onDoubleClick={() => setPrefs({ regiaWidth: null })}
      onKeyDown={e => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const cur = width ?? (document.querySelector('.regia-col')?.getBoundingClientRect().width ?? 320);
        setPrefs({ regiaWidth: clamp(cur + (e.key === 'ArrowLeft' ? -24 : 24)) });
      }} />
  );
}

/** A brain page (built in src/renderer/brain) with a thin frame: back to the chats, its title, "Copia link", the Regia. */
function PageFrame({ id }: { id: (typeof BRAIN_PAGES)[number]['id'] }) {
  const dock = ui.use(s => s.regiaDock);
  const arg = ui.use(s => s.pageArg);
  return (
    <div className="page-frame" data-testid={`page-${id}`}>
      <div className="page-bar">
        <button type="button" className="btn btn-ghost btn-s" onClick={() => go({ page: 'workspace' })} data-testid="page-back" data-tip="Torna alle chat|Ctrl+1"><IconArrowLeft size={13} /> Chat</button>
        <h2>{pageLabel(id)}</h2>
        <span className="sp" />
        <button type="button" className="btn btn-ghost btn-s" onClick={() => void copyLink(makeLink(id, arg))} data-testid="page-copy-link"><IconLink size={13} /> Copia link</button>
        <button type="button" className={`btn btn-s ${dock ? 'btn-regia' : 'btn-ghost'}`} onClick={toggleRegia} data-testid="page-regia" data-tip="La Regia qui, senza lasciare la pagina|Ctrl+R">
          <HarnessMark harness="claude" regia size={16} /> Regia
        </button>
        <span className="page-hint"><Keys combo="Esc" /> chat</span>
      </div>
      <div className="page-body">
        <BrainPage id={id} arg={arg ?? undefined} onNavigate={goTarget} />
      </div>
    </div>
  );
}

export function App() {
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('paste', onPaste); };
  }, []);
  useHighlight();
  useBrainToastRelay();
  const view = ui.use(s => s.prefs.view);
  const density = ui.use(s => s.prefs.density);
  const theme = ui.use(s => s.prefs.theme);
  const regiaWidth = ui.use(s => s.prefs.regiaWidth);
  const maximized = ui.use(s => s.maximized);
  const focusMode = ui.use(s => s.focusMode);
  const lanePeek = ui.use(s => s.lanePeek);
  const page = ui.use(s => s.page);
  const map = ui.use(s => s.map);
  const mapArg = ui.use(s => s.mapArg);
  const center = ui.use(s => s.center);
  const dock = ui.use(s => s.regiaDock);
  const modal = ui.use(s => s.modal);
  const focused = ui.use(s => s.focused);
  const tabIds = useApp(s => s.tabs.map(t => t.id), sameList);
  const focusChatExists = useApp(s => (focusMode ? !!s.chats[focusMode] : true));

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme; else root.dataset.theme = theme;
    root.dataset.density = density;
  }, [theme, density]);
  useEffect(() => { setBlocked(modal !== null || map); }, [modal, map]);
  useEffect(() => { setKnownTabs(tabIds); }, [tabIds]);
  useEffect(() => { schedule(420); }, [view, maximized, focusMode, page, density, regiaWidth, lanePeek, center, dock]);
  useEffect(() => { if (focused) setPrefs({ lastFocus: focused }); }, [focused]);
  useEffect(() => { if (!focusChatExists) ui.set(s => ({ ...s, focusMode: null })); }, [focusChatExists]);

  const regiaMax = maximized === 'regia' && !page;
  const onPage = !!page;
  const regiaInColumn = !onPage && !focusMode;
  const regiaDocked = dock && (onPage || !!focusMode || map) && !regiaInColumn;
  const showLane = !onPage && ((view === 'mosaico' && !focusMode) || lanePeek);
  const style = (regiaWidth ? { '--regia-w': `${regiaWidth}px` } : {}) as CSSProperties;
  return (
    <div className="app" data-testid="app" data-view={view}>
      <TopBar />
      <BrainSetupBanner />
      <div className="shell">
        <Sidebar />
        <div className="main-col">
          {showLane && <NeedsLane peek={lanePeek} />}
          <main className={`workspace ${!regiaInColumn ? 'no-regia' : ''} ${regiaMax ? 'regia-max' : ''} ${regiaDocked ? 'docked' : ''}`} style={style} data-testid="workspace">
            {regiaInColumn && <div className="regia-col"><RegiaTile maximized={regiaMax} /></div>}
            {regiaInColumn && !regiaMax && <RegiaSplitter />}
            {!regiaMax && (
              <div className="view-area">
                {onPage ? <PageFrame id={page} /> : focusMode ? <FocusView chatId={focusMode} /> : view === 'mosaico' ? <Mosaico /> : <Corsie />}
              </div>
            )}
          </main>
        </div>
      </div>
      {map && (
        <div className="map-layer" data-testid="map-layer">
          <BrainMap onClose={() => setMap(false)} full={mapArg === 'tutto'} mode={mapArg === 'flat' ? 'flat' : undefined}
            focus={mapArg && mapArg !== 'tutto' && mapArg !== 'flat' ? mapArg : undefined}
            onNavigate={t => { setMap(false); goTarget(t); }} />
        </div>
      )}
      {regiaDocked && <div className="regia-dock" data-testid="regia-dock-panel"><RegiaTile docked /></div>}
      {center && <NotificationCenter />}
      <Toasts />
      <LiveRegion />
      <TooltipLayer />
      {modal === 'palette' && <CommandPalette />}
      {modal === 'newChat' && <NewChatDialog />}
      {modal === 'shortcuts' && <ShortcutsDialog />}
      {modal === 'confirm' && <ConfirmDialog />}
    </div>
  );
}
