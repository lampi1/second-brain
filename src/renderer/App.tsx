// The app shell: top bar, the left navigation (the Grindhouse, brain sections, the map), the needs-you lane (focus mode's
// peek), a brain page (the Grindhouse holds the agents' vertical strips; focus mode replaces it with one chat), the full-screen 3D map, the
// persistent Orchestrator column on the right (always, on every page, the Dashboard and the 3D map included: the user,
// 2026-10-18, «io voglio sempre l'orchestratore a destra»; RegiaOverlay.tsx, ADR 0068), the notification center, toasts, the live
// region, tooltips, the questions window ("Domande in finestra") and dialogs. It owns the global keyboard map
// (lib/keys.ts → actions.ts, G-letter go-to sequences), theme and density, highlights the element a link points to, and
// tells the browser-view reporter when something covers everything. Mounted by main.tsx.
import { useEffect, type CSSProperties } from 'react';
import{t}from'./i18n';
import { BRAIN_PAGES, BrainMap, BrainPage, GO_ALIASES } from './brain';
import { goSequence, resolveShortcut } from './lib/keys';
import { schedule, setBlocked, setKnownTabs } from './lib/viewports';
import { makeLink } from './lib/notify';
import { liveSource } from './lib/liveSource';
import { sameList } from './store/state';
import { useApp } from './store/store';
import { openModal, closeModal, pageLabel, setMap, setPrefs, toast, ui } from './store/ui';
import {
  back, brainBridge, copyLink, escapeOne, focusChat, focusTile, forward, go, goTarget, nextThing, openLink, stopAllAsk, stopFocused, closeFocused, toggleCenter, toggleFocusMode, toggleMaximize, toggleRegia, askRenewRegia,
} from './actions';
import { TopBar } from './components/TopBar';
import { BrainSetupBanner } from './components/BrainSetupBanner';
import { HealthBanner } from './components/HealthBanner';
import { Sidebar } from './components/Sidebar';
import { NeedsLane, LiveRegion } from './components/NeedsLane';
import { RegiaOverlay, useDockReserve } from './components/RegiaOverlay';
import {UpdateCheckpointStatus} from './components/UpdateCheckpointStatus';

import { FocusView } from './components/FocusView';
import { NotificationCenter } from './components/NotificationCenter';
import { AutoCloser } from './components/AutoCloser';
import { CommandPalette } from './components/CommandPalette';
import { AgentStartDialog as NewChatDialog } from './components/AgentStartDialog';
import { AgentPackHost } from './components/AgentPackHost';
import { AgentCatalogPage } from './components/AgentCatalogPage';
import { FirstInterviewGate } from './components/FirstInterview';
import { RegiaRenewDialog } from './components/RegiaRenewDialog';
import { ConfirmDialog, ShortcutsDialog, Toasts } from './components/Overlays';
import { HandoffDialog } from './components/HandoffDialog';
import { CredentialsDialog } from './components/LoginsDialog';
import { StatoDialog } from './components/StatoDialog';
import { IconArrowLeft, IconLink } from './components/Icons';
import { Keys, TooltipLayer } from './components/ui';
import { SettingsPage } from './components/SettingsPage';
import { SkillsPage } from './components/SkillsPage';
import { QuestionsWindow } from './components/QuestionsWindow';
import { LaunchBanner } from './components/LaunchBanner';
import { Dashboard } from './dashboard/Dashboard';
import { RulesPage } from './components/brain-model/RulesPage';
import { MemoryPage } from './components/brain-model/MemoryPage';
import { ClassifiersPage } from './components/brain-model/ClassifiersPage';
import { MapPage } from './components/brain-model/MapPage';
import { GuidePage } from './components/GuidePage';

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
    const r = goSequence(gPending, e, Date.now(), [...BRAIN_PAGES, ...GO_ALIASES]);
    gPending = r.pendingAt;
    if (r.target) { e.preventDefault(); go({ page: r.target as (typeof BRAIN_PAGES)[number]['id'] }); return; }
    if (r.handled) { e.preventDefault(); return; }
  }
  const cmd = resolveShortcut(e);
  if (!cmd) return;
  if (u.modal) {
    if (cmd.type === 'palette' && u.modal === 'palette') { e.preventDefault(); closeModal(); }
    if (cmd.type === 'closeFocused') e.preventDefault(); // else Electron's default menu takes Ctrl+W and closes the window
    return; // an open dialog handles its own keys
  }
  // the questions window in front: only the palette, Ctrl+J and Esc act; nothing hidden under it (Ctrl+W, Ctrl+1-9…)
  if (u.qwin.shown && cmd.type !== 'palette' && cmd.type !== 'next' && cmd.type !== 'escape') {
    if (cmd.type === 'closeFocused') e.preventDefault();
    return;
  }
  switch (cmd.type) {
    case 'palette': openModal('palette'); break;
    case 'next': nextThing(); break;
    case 'newChat': openModal('newChat'); break;
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
    case 'regia': toggleRegia(); break;
    case 'regiaRenew': askRenewRegia(); break;
    case 'map': if (u.map) setMap(false); else go({ page: 'mappa' }); break;
    case 'settings': go({ page: 'impostazioni' }); break;
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

/** A brain page (built in src/renderer/brain) with a thin frame: back to the chats, its title, "Copia link" (the Regia
 *  widget sits in the bottom-right corner, over the page too). */
function PageFrame({ id }: { id: (typeof BRAIN_PAGES)[number]['id'] }) {
  const arg = ui.use(s => s.pageArg);
  const home = id === 'home'; // the Grindhouse is where every way back leads (Esc, Ctrl+1): no back button on it
  return (
    <div className="page-frame" data-testid={`page-${id}`}>
      <div className="page-bar">
        {!home && <button type="button" className="btn btn-ghost btn-s" onClick={() => go({ page: 'home' })} data-testid="page-back" data-tip={`${t('home.back')}|Ctrl+1`}><IconArrowLeft size={13} /> {pageLabel('home')}</button>}
        <h2>{id === 'agenti' ? t('catalog.title') : pageLabel(id)}</h2>
        <span className="sp" />
        <button type="button" className="btn btn-ghost btn-s" onClick={() => void copyLink(makeLink(id, arg))} data-testid="page-copy-link"><IconLink size={13} /> {t('chat.menu.copyLink')}</button>
        {!home && <span className="page-hint"><Keys combo="Esc" /> {pageLabel('home')}</span>}
      </div>
      {/* keyed by the page: every page change replays the entry (linear.css panel-enter), no hard cut */}
      <div className="page-body" key={id}>
        {id === 'dashboard' ? <Dashboard /> : id === 'guida' ? <GuidePage /> : id === 'agenti' ? <AgentCatalogPage /> : id === 'impostazioni'
          ? <div className="bx bx-page bx-scroll" role="region" aria-label={t('cmp.app.settings')}><div className="bx-inner"><SettingsPage /></div></div>
          : id === 'skill'
            ? <div className="bx bx-page bx-scroll" role="region" aria-label={t('cmp.app.skills')}><div className="bx-inner"><SkillsPage /></div></div>
            : id === 'regole' || id === 'memoria'
              ? <div className="bx bx-page bx-scroll" role="region" aria-label={pageLabel(id)}><div className="bx-inner">{id === 'regole' ? <RulesPage /> : <MemoryPage />}</div></div>
              : id === 'classificatori' ? <ClassifiersPage /> : id === 'collegamenti' ? <MapPage />
              : <BrainPage id={id} arg={arg ?? undefined} onNavigate={goTarget} bridge={brainBridge} />}
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
  const focusChatExists = useApp(s => (focusMode ? !!s.chats[focusMode] : true));
  const dock = useDockReserve();

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme; else root.dataset.theme = theme;
    root.dataset.density = density;
    root.dataset.appearance=appearance.preset;
  }, [theme, density,appearance]);
  const qShown = ui.use(s => s.qwin.shown);
  useEffect(() => { setBlocked(modal !== null || map || qShown); }, [modal, map, qShown]);
  useEffect(() => { setKnownTabs(tabIds); }, [tabIds]);
  useEffect(() => { schedule(420); }, [maximized, focusMode, page, density, lanePeek, center, dock.right, dock.bottom]);
  useEffect(() => { if (focused) setPrefs({ lastFocus: focused }); }, [focused]);
  useEffect(() => { if (!focusChatExists) ui.set(s => ({ ...s, focusMode: null })); }, [focusChatExists]);

  const inFocus = !!focusMode && page === 'home';
  // the Grindhouse has no "Ti aspettano" strip any more (the user, 2026-10-12: "togli le domande che compaiono in alto ti
  // aspettano, adesso me le fa la regia"): each request is in its tile, the Regia or the global layer; focus mode keeps
  // its Ctrl+J peek
  const showLane = inFocus && lanePeek;
  return (
    // the Orchestrator column's room: the workspace, the map and the questions window leave it free (shell.css)
    <div className="app" data-testid="app" style={{ '--regia-r': `${dock.right}px`, '--regia-b': `${dock.bottom}px`,'--regia-t':`${dock.top??0}px` } as CSSProperties}>
      <TopBar />
      <Toasts />
      <AgentPackHost />
      <BrainSetupBanner />
      <HealthBanner />
      <LaunchBanner />
      <div className="shell">
        <Sidebar />
        <div className="main-col">
          {showLane && <NeedsLane peek={lanePeek} />}
          <main className="workspace no-regia" data-testid="workspace">
            <div className="view-area">
              {inFocus ? <FocusView chatId={focusMode} /> : <PageFrame id={page} />}
            </div>
          </main>
        </div>
      </div>
      {map && (
        <div className="map-layer" data-testid="map-layer">
          <BrainMap onClose={() => setMap(false)} full={mapArg === 'tutto'} mode={mapArg === 'flat' ? 'flat' : undefined}
            focus={mapArg && mapArg !== 'tutto' && mapArg !== 'flat' ? mapArg : undefined}
            onNavigate={t => { setMap(false); goTarget(t); }}
            live={liveSource} onOpenChat={id => { setMap(false); focusChat(id); }} />
        </div>
      )}
      <RegiaOverlay />{/* always: the Dashboard and the 3D map sit beside it, never over it */}
      {center && <NotificationCenter />}
      <QuestionsWindow />
      <LiveRegion />
      <TooltipLayer />
      <AutoCloser />
      <FirstInterviewGate />
      <UpdateCheckpointStatus />
      {modal === 'palette' && <CommandPalette />}
      {modal === 'newChat' && <NewChatDialog />}
      {modal === 'shortcuts' && <ShortcutsDialog />}
      {modal === 'confirm' && <ConfirmDialog />}
      {modal === 'regiaRenew' && <RegiaRenewDialog />}
      {modal === 'handoff' && <HandoffDialog />}
      {modal === 'credentials' && <CredentialsDialog />}
      {modal === 'stato' && <StatoDialog />}
    </div>
  );
}
