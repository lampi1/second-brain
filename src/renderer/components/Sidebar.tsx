// The left rail: chat-focused sidebar (Grindhouse header + live delegation tree with role mini-icons in SidebarTree.tsx)
// paired with a discreet Hamburger (☰) popover menu holding the other views grouped into Lavoro (Grindhouse, Piani),
// Svago (Impara, Scacchi) and Sistema (Agenti, Memoria, Andamento, Impostazioni): lib/nav-menu.ts, ADR 0366. Lavoro also
// lists «Attività pianificate» (ADR 0374, it took Task's place). Registrazioni, Collegamenti and Log are out of the menu,
// still reachable from the palette and the Orchestrator; the proposals of the memory light the dot on ☰.
// Used by App.tsx.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BRAIN_PAGES, type BrainPageId } from '../brain';
import { badges, WARN_SECTIONS } from '../lib/notify';
import { useApp } from '../store/store';
import { clampSidebarWidth, DEFAULT_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, setPrefs, ui } from '../store/ui';
import { schedule, suspendViews } from '../lib/viewports';
import { go, showOverview } from '../actions';
import {
  IconBell, IconBook, IconBrain, IconChess, IconChart, IconGrid, IconHistory, IconLayers, IconList, IconMap, IconMenu, IconMic, IconSettings, IconSparkle, IconTerminal, IconTicket,
} from './Icons';
import { t } from '../i18n';
import { menuAlert, MENU_GROUPS, menuLabelKey } from '../lib/nav-menu';
import { SidebarTree } from './SidebarTree';
import { useProposalCount } from '../lib/proposals';
import { workingCount } from '../lib/working-count';

const ICON: Record<BrainPageId, ReactNode> = {
  home: <IconGrid />,
  agenti: <IconLayers />,
  andamento: <IconChart />, script: <IconTerminal />, log: <IconList />, file: <IconBrain />, attivita: <IconBell />, skill: <IconSparkle />, impostazioni: <IconSettings />,
  registrazioni: <IconMic />, impara: <IconBook />, scacchi: <IconChess />,
  memoria: <IconHistory />, piani: <IconTicket />, collegamenti: <IconMap />,
};

function Badge({ n, warn }: { n: number; warn?: boolean }) {
  if (!n) return null;
  return <span className={`nav-badge ${warn ? 'warn' : ''}`} aria-label={t('dialogs.sidebar.new', { count: n })}>{warn ? '!' : n > 99 ? '99+' : n}</span>;
}

export function Sidebar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [winW, setWinW] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1280));
  const menuWrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; w: number; release: () => void } | null>(null);
  const savedWidth = ui.use(s => s.prefs.sidebarWidth);
  const width = clampSidebarWidth(savedWidth ?? DEFAULT_SIDEBAR_WIDTH, winW);
  const maxW = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.floor(winW * 0.42)));
  const page = ui.use(s => s.page);
  const read = ui.use(s => s.read);
  const feed = useApp(s => s.feed);
  const waiting = useApp(s => s.pending.length);
  const working = useApp(s => workingCount(s.chats));
  const b = badges(feed, read);
  const proposals = useProposalCount();

  useEffect(() => {
    const onResize = () => setWinW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => () => { drag.current?.release(); drag.current = null; }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (menuWrap.current && !menuWrap.current.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setMenuOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  const resize = (next: number) => {
    setPrefs({ sidebarWidth: clampSidebarWidth(next, window.innerWidth) });
    schedule();
  };
  const endDrag = () => {
    if (!drag.current) return;
    drag.current.release();
    drag.current = null;
    setResizing(false);
    schedule();
  };

  const waitingBadge = <span className="nav-badge amber" data-testid="nav-badge-waiting" aria-label={t('dialogs.sidebar.waiting', { count: waiting })}>{waiting}</span>;
  const workingBadge = <span className="nav-badge" data-testid="nav-badge-working" aria-label={t('dialogs.sidebar.working', { count: working })}>{working > 99 ? '99+' : working}</span>;
  const homeBadge = working || waiting ? <>{working ? workingBadge : null}{waiting ? waitingBadge : null}</> : null;

  const labelOf = (id: BrainPageId, fallback: string) => { const k = menuLabelKey(id); return k ? t(k) : fallback; };

  const menuItem = (id: BrainPageId) => {
    const p = BRAIN_PAGES.find(x => x.id === id);
    if (!p) return null;
    const on = page === p.id;
    const label = labelOf(p.id, p.label);
    const badge = p.id === 'memoria' && proposals
      ? <span className="nav-badge amber nav-badge-pulse" data-testid="nav-badge-proposals" aria-label={t('mh.badge', { n: proposals })}>{proposals > 99 ? '99+' : proposals}</span>
      : p.id === 'home' ? null : <span data-testid={`nav-badge-${p.id}`}><Badge n={b[p.id] ?? 0} warn={WARN_SECTIONS.has(p.id)} /></span>;
    return (
      <button key={p.id} type="button" className={`nav-item ${on ? 'on' : ''}`} role="menuitem"
        onClick={() => { setMenuOpen(false); if (p.id === 'home') showOverview(); else go({ page: p.id }); }}
        aria-current={on ? 'page' : undefined} data-testid={p.id === 'home' ? 'nav-menu-home' : `nav-${p.id}`}
        data-tip={p.key ? `${label}|${p.key}` : undefined} aria-label={label}>
        <span className="nav-icon">{ICON[p.id] ?? <IconBrain />}</span>
        <span className="nav-label">{label}</span>
        {badge}
      </button>
    );
  };

  const homePage = BRAIN_PAGES.find(x => x.id === 'home')!;
  const homeOn = page === 'home';

  return (
    <nav className={`sidebar${resizing ? ' is-resizing' : ''}`} style={{ width }} aria-label={t('dialogs.sidebar.label')} data-testid="sidebar">
      <div className="sidebar-head" ref={menuWrap}>
        <button type="button" className={`nav-menu-btn ${menuOpen ? 'on' : ''}`}
          aria-expanded={menuOpen} aria-haspopup="menu" aria-label={t('dialogs.sidebar.menuLabel')}
          data-tip={t('dialogs.sidebar.menuTip')} data-testid="nav-menu-btn"
          onClick={() => setMenuOpen(o => !o)}>
          <IconMenu size={16} />
          {menuAlert(proposals) && <span className="nav-menu-dot" aria-hidden="true" data-testid="nav-menu-dot" />}
        </button>
        <button type="button" className={`nav-item nav-home-btn ${homeOn ? 'on' : ''}`}
          onClick={() => { setMenuOpen(false); showOverview(); }}
          aria-current={homeOn ? 'page' : undefined} data-testid="nav-home"
          data-tip={homePage.key ? `${homePage.label}|${homePage.key}` : undefined} aria-label={homePage.label}>
          <span className="nav-icon"><IconGrid size={15} /></span>
          <span className="nav-label">{homePage.label}</span>
          {homeBadge}
        </button>
        {menuOpen && (
          <div className="nav-menu-pop" role="menu" aria-label={t('dialogs.sidebar.menuLabel')} data-testid="nav-menu">
            {MENU_GROUPS.map((g, i) => <div key={g.id} role="none">
              {i > 0 && <div className="nav-sep" />}
              <div className="nav-title" data-testid={`nav-group-${g.id}`}>{t(`dialogs.sidebar.${g.id}`)}</div>
              {g.pages.map(menuItem)}
            </div>)}
          </div>
        )}
      </div>
      <div className="nav-group nav-scroll">
        <SidebarTree />
      </div>
      <div className="sidebar-resize" role="separator" tabIndex={0} aria-label={t('dialogs.sidebar.width')} aria-orientation="vertical"
        aria-valuemin={MIN_SIDEBAR_WIDTH} aria-valuemax={maxW} aria-valuenow={width} data-testid="sidebar-resize"
        onPointerDown={event => {
          if (event.button !== 0) return;
          drag.current?.release();
          drag.current = { x: event.clientX, w: width, release: suspendViews() };
          setResizing(true);
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
        }}
        onPointerMove={event => { if (drag.current) resize(drag.current.w + event.clientX - drag.current.x); }}
        onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); endDrag(); }}
        onLostPointerCapture={endDrag} onPointerCancel={endDrag}
        onDoubleClick={() => { setPrefs({ sidebarWidth: null }); schedule(); }}
        onKeyDown={event => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); resize(width + (event.key === 'ArrowRight' ? 20 : -20)); }
          else if (event.key === 'Home') { event.preventDefault(); setPrefs({ sidebarWidth: null }); schedule(); }
        }} />
    </nav>
  );
}
