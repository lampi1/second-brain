// The app shell: top bar, the left navigation (the Grindhouse, brain sections, the map), the needs-you lane (focus mode's
// peek), a brain page (the Grindhouse holds the agents' vertical strips; focus mode replaces it with one chat), the full-screen 3D map, the
// persistent Orchestrator column on the right (always, on every page, the 3D map included: the user,
// 2026-10-18, «io voglio sempre l'orchestratore a destra»; OrchestratorOverlay.tsx, ADR 0068), the notification center, toasts, the live
// region, tooltips, the questions window ("Domande in finestra") and dialogs. It owns the global keyboard map
// (lib/keys.ts → actions.ts, G-letter go-to sequences), theme and density, highlights the element a link points to, and
// tells the browser-view reporter when something covers everything. Mounted by main.tsx.
import { lazy, Suspense, useEffect, type CSSProperties } from 'react';
import{t}from'./i18n';
import { BRAIN_PAGES, BrainMap, BrainPage, GO_ALIASES } from './brain';
import { relayToasts } from './brain/components/ui';
import { goSequence, resolveShortcut } from './lib/keys';
import { schedule, setBlocked, setKnownTabs } from './lib/viewports';
import { liveSource } from './lib/liveSource';
import { sameList } from './store/state';
import { routinePlacements } from './lib/routine-chats';
import { useApp } from './store/store';
import { openModal, closeModal, pageLabel, setMap, setPrefs, toast, ui } from './store/ui';
import {
  back, brainBridge, closeViewer, escapeOne, toggleViewerFull, viewerStep, focusChat, focusTile, forward, go, goTarget, nextThing, openLink, stopAllAsk, stopFocused, closeFocused, toggleCenter, toggleFocusMode, toggleMaximize, toggleOrchestrator, askRenewOrchestrator, newRequest,
} from './actions';
import { TopBar } from './components/TopBar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { BrainSetupBanner } from './components/BrainSetupBanner';
import { HealthBanner } from './components/HealthBanner';
import { Sidebar } from './components/Sidebar';
import { NeedsLane, LiveRegion } from './components/NeedsLane';
import { OrchestratorOverlay, useDockReserve } from './components/OrchestratorOverlay';
import {UpdateCheckpointStatus} from './components/UpdateCheckpointStatus';

import { FocusView } from './components/FocusView';
import { NotificationCenter } from './components/NotificationCenter';
import { AutoCloser } from './components/AutoCloser';
import { CommandPalette } from './components/CommandPalette';
import { AgentCatalogPage } from './components/AgentCatalogPage';
import { FirstInterviewGate } from './components/FirstInterview';
import { OrchestratorRenewDialog } from './components/OrchestratorRenewDialog';
import { ConfirmDialog, ShortcutsDialog, Toasts } from './components/Overlays';
import { HandoffDialog } from './components/HandoffDialog';
import { CredentialsDialog } from './components/LoginsDialog';
import { StatoDialog } from './components/StatoDialog';
import { IconArrowLeft } from './components/Icons';
import { Keys, TooltipLayer } from './components/ui';
import { SettingsPage } from './components/SettingsPage';
import { QuestionsWindow } from './components/QuestionsWindow';
import { LaunchBanner } from './components/LaunchBanner';
import { MemoryPage } from './components/brain-model/MemoryPage';
import { hubRedirect } from './lib/memory-hub';
import { AndamentoPage } from './components/andamento/AndamentoPage';
import { MapPage } from './components/brain-model/MapPage';
import { LogPage } from './components/LogPage';
// the Guida (three languages of cards) loads when it opens, not with the first screen
import { BrowserPage } from './components/BrowserPage';
import { RecordingsPage } from './components/RecordingsPage';
import { ImparaPage } from './components/impara/ImparaPage';
import { shortcutTalk, shortcutVoice } from './lib/voice';
const GuidePage = lazy(() => import('./components/GuidePage').then(m => ({ default: m.GuidePage })));
// the file viewer overlay loads when a file is first opened
const ViewerOverlay = lazy(() => import('./components/viewer/ViewerOverlay').then(m => ({ default: m.ViewerOverlay })));

const editable = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};
let gPending: number | null = null;

function onKey(e: KeyboardEvent): void {
  if (e.defaultPrevented) return;
  const u = ui.get();
  // "G then a letter": go to a section (never while typing in a field, never under a dialog)
  if (!u.modal && !u.viewer.open && !editable(e.target)) {
    const r = goSequence(gPending, e, Date.now(), [...BRAIN_PAGES, ...GO_ALIASES]);
    gPending = r.pendingAt;
    // an old id (G Q → 'qualita') is redirected by go() to its tab (ADR 0202)
    if (r.target) { e.preventDefault(); go({ page: r.target as (typeof BRAIN_PAGES)[number]['id'] }); return; }
    if (r.handled) { e.preventDefault(); return; }
  }
  const cmd = resolveShortcut(e);
  if (!cmd) return;
  if (u.modal) {
    if (cmd.type === 'palette' && u.modal === 'palette') { e.preventDefault(); closeModal(); }
    if (cmd.type === 'closeFocused' || cmd.type === 'voice') e.preventDefault(); // else Electron's default menu takes Ctrl+W (close) or Ctrl+M (minimize)
    return; // an open dialog handles its own keys
  }
  // the questions window in front: only the palette, Ctrl+J and Esc act; nothing hidden under it (Ctrl+W, Ctrl+1-9…)
  if (u.qwin.shown && cmd.type !== 'palette' && cmd.type !== 'next' && cmd.type !== 'escape' && cmd.type !== 'voice' && cmd.type !== 'talk') {
    if (cmd.type === 'closeFocused') e.preventDefault();
    return;
  }
  // the file viewer in front (the keys inside it are its own, ViewerOverlay.tsx): Alt+←/→ move between its files, F11
  // expands it, Esc and Ctrl+W close it; the palette and Ctrl+J still work; nothing acts on the page under it
  if (u.viewer.open && !u.qwin.shown) {
    switch (cmd.type) {
      case 'back': viewerStep(-1); break;
      case 'forward': viewerStep(1); break;
      case 'maximize': toggleViewerFull(); break;
      case 'escape': closeViewer(); break;
      case 'closeFocused': if (!e.repeat) closeViewer(); break;
      case 'palette': openModal('palette'); break;
      case 'next': nextThing(); break;
      case 'voice': if (!e.repeat) shortcutVoice(); break;
      case 'talk': if (!e.repeat) shortcutTalk(); break;
      default: return;
    }
    e.preventDefault();
    return;
  }
  switch (cmd.type) {
    case 'palette': openModal('palette'); break;
    case 'next': nextThing(); break;
    case 'newChat': newRequest(); break;
    case 'stopFocused': stopFocused(); break;
    case 'closeFocused': if (!e.repeat) closeFocused(); break; // a held Ctrl+W closes one chat, not a burst
    case 'stopAll': stopAllAsk(); break;
    case 'maximize': toggleMaximize(); break;
    case 'focusMode': toggleFocusMode(); break;
    case 'focusTile': focusTile(cmd.index); break;
    case 'shortcuts': openModal('shortcuts'); break;
    case 'back': back(); break;
    case 'forward': forward(); break;
    case 'center': toggleCenter(); break;
    case 'orchestrator': toggleOrchestrator(); break;
    case 'orchestratorRenew': askRenewOrchestrator(); break;
    case 'map': if (u.map) setMap(false); else go({ page: 'mappa' }); break;
    case 'settings': go({ page: 'impostazioni' }); break;
    case 'voice': if (!e.repeat) shortcutVoice(); break;
    case 'talk': if (!e.repeat) shortcutTalk(); break;
    case 'stato': openModal('stato'); break;
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
 *  app they are hidden (shell.css) and relayed here into the app's toasts. The Toaster hands them over itself: an
 *  observer of the whole body woke on every DOM insertion (every streamed markdown block) to find them. */
function useBrainToastRelay(): void {
  useEffect(() => {
    relayToasts(text => toast(text, 'info'));
    return () => relayToasts(null);
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

/** A brain page (built in src/renderer/brain) with a thin frame: back to the chats and its title (links are copied from the command palette); the Orchestrator
 *  widget sits in the bottom-right corner, over the page too. */
function PageFrame({ id }: { id: (typeof BRAIN_PAGES)[number]['id'] }) {
  const arg = ui.use(s => s.pageArg);
  const home = id === 'home'; // the Grindhouse is where every way back leads (Esc, Ctrl+1): no back button on it
  // a page that became a Memoria tab (ADR 0122) reached without go() (an old saved place): moved to its tab
  const hub = hubRedirect(id, arg);
  useEffect(() => { if (hub) go(hub, { push: false }); }, [hub?.arg]);
  return (
    <div className="page-frame" data-testid={`page-${id}`}>
      <div className="page-bar">
        {!home && <button type="button" className="btn btn-ghost btn-s" onClick={() => go({ page: 'home' })} data-testid="page-back" data-tip={`${t('home.back')}|Ctrl+1`}><IconArrowLeft size={13} /> {pageLabel('home')}</button>}
        <h2>{id === 'agenti' ? t('catalog.title') : pageLabel(id)}</h2>
        <span className="sp" />
        {!home && <span className="page-hint"><Keys combo="Esc" /> {pageLabel('home')}</span>}
      </div>
      {/* keyed by the page: every page change replays the entry (linear.css panel-enter), no hard cut */}
      <div className="page-body" key={id}>
        <ErrorBoundary where={id}>
        {hub ? null : id === 'log' ? <LogPage /> : id === 'guida' ? <Suspense fallback={null}><GuidePage arg={arg ?? undefined} /></Suspense> : id === 'browser' ? <BrowserPage /> : id === 'registrazioni' ? <RecordingsPage /> : id === 'impara' ? <ImparaPage /> : id === 'agenti' ? <AgentCatalogPage /> : id === 'impostazioni'
          ? <div className="bx bx-page bx-scroll" role="region" aria-label={t('cmp.app.settings')}><div className="bx-inner"><SettingsPage /></div></div>
          : id === 'memoria'
            ? <div className="bx bx-page bx-scroll" role="region" aria-label={pageLabel(id)}><div className="bx-inner mh-inner"><MemoryPage /></div></div>
            : id === 'andamento' ? <AndamentoPage /> : id === 'collegamenti' ? <MapPage />
              : <BrainPage id={id} arg={arg ?? undefined} onNavigate={goTarget} bridge={brainBridge} />}
        </ErrorBoundary>
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
  const density = ui.use(s => s.prefs.density);
  const theme = ui.use(s => s.prefs.theme);
  const appearance=ui.use(s=>s.prefs.appearance);
  const maximized = ui.use(s => s.maximized);
  const focusMode = ui.use(s => s.focusMode);
  const lanePeek = ui.use(s => s.lanePeek);
  const page = ui.use(s => s.page);
  const map = ui.use(s => s.map);
  const mapArg = ui.use(s => s.mapArg);
  const center = ui.use(s => s.center);
  const modal = ui.use(s => s.modal);
  const focused = ui.use(s => s.focused);
  const tabIds = useApp(s => s.tabs.map(t => t.id), sameList);
  const routineFocus = useApp(state => focusMode && routinePlacements(state.chats).has(focusMode) ? focusMode : null);
  useEffect(() => { if (routineFocus) focusChat(routineFocus); }, [routineFocus]);
  const focusChatExists = useApp(s => (focusMode ? !!s.chats[focusMode] : true));
  const dock = useDockReserve();

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme; else root.dataset.theme = theme;
    root.dataset.density = density;
    root.dataset.appearance=appearance.preset;
  }, [theme, density,appearance]);
  const qShown = ui.use(s => s.qwin.shown);
  const viewerOpen = ui.use(s => s.viewer.open);
  useEffect(() => { setBlocked(modal !== null || map || qShown); }, [modal, map, qShown]);
  useEffect(() => { setKnownTabs(tabIds); }, [tabIds]);
  useEffect(() => { schedule(420); }, [maximized, focusMode, page, density, lanePeek, center, dock.right, dock.bottom]);
  useEffect(() => { if (focused) setPrefs({ lastFocus: focused }); }, [focused]);
  useEffect(() => { if (!focusChatExists) ui.set(s => ({ ...s, focusMode: null })); }, [focusChatExists]);

  const inFocus = !!focusMode && !routineFocus && page === 'home';
  // the Grindhouse has no "Ti aspettano" strip any more (the user, 2026-10-12: "togli le domande che compaiono in alto ti
  // aspettano, adesso me le fa l’Orchestrator"): each request is in its tile, the Orchestrator or the global layer; focus mode keeps
  // its Ctrl+J peek
  const showLane = inFocus && lanePeek;
  return (
    // the Orchestrator column's room: the workspace, the map and the questions window leave it free (shell.css)
    <div className="app" data-testid="app" style={{ '--orchestrator-r': `${dock.right}px`, '--orchestrator-b': `${dock.bottom}px`,'--orchestrator-t':`${dock.top??0}px` } as CSSProperties}>
      <TopBar />
      <Toasts />
      <BrainSetupBanner />
      <HealthBanner />
      <LaunchBanner />
      <div className="shell">
        <Sidebar />
        <div className="main-col">
          {showLane && <NeedsLane peek={lanePeek} />}
          <main className="workspace no-orchestrator" data-testid="workspace">
            <div className="view-area">
              {inFocus ? <ErrorBoundary where="focus" key={`focus-${focusMode}`}><FocusView chatId={focusMode} /></ErrorBoundary> : <PageFrame id={page} />}
            </div>
          </main>
        </div>
      </div>
      {map && (
        <div className="map-layer" data-testid="map-layer">
          <ErrorBoundary where="map"><BrainMap onClose={() => setMap(false)} full={mapArg === 'tutto'} mode={mapArg === 'flat' ? 'flat' : undefined}
            focus={mapArg && mapArg !== 'tutto' && mapArg !== 'flat' ? mapArg : undefined}
            onNavigate={t => { setMap(false); goTarget(t); }}
            live={liveSource} onOpenChat={id => { setMap(false); focusChat(id); }} /></ErrorBoundary>
        </div>
      )}
      <OrchestratorOverlay />{/* always: every page and the 3D map sit beside it, never over it */}
      {center && <NotificationCenter />}
      <QuestionsWindow />
      <LiveRegion />
      <TooltipLayer />
      <AutoCloser />
      <FirstInterviewGate />
      <UpdateCheckpointStatus />
      {viewerOpen && <Suspense fallback={null}><ViewerOverlay /></Suspense>}
      {modal === 'palette' && <CommandPalette />}
      {modal === 'shortcuts' && <ShortcutsDialog />}
      {modal === 'confirm' && <ConfirmDialog />}
      {modal === 'orchestratorRenew' && <OrchestratorRenewDialog />}
      {modal === 'handoff' && <HandoffDialog />}
      {modal === 'credentials' && <CredentialsDialog />}
      {modal === 'stato' && <StatoDialog />}
    </div>
  );
}
