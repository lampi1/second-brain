// The left rail: chat-focused sidebar (Grindhouse header + live delegation tree with role mini-icons in SidebarTree.tsx)
// paired with a discreet Hamburger (☰) popover menu holding all secondary views grouped into Lavoro, Svago (Giornale &
// Fonti, Scacchi) and Sistema. Used by App.tsx.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BRAIN_PAGES, type BrainPageId } from '../brain';
import { badges, WARN_SECTIONS } from '../lib/notify';
import { useApp } from '../store/store';
import { useTasks } from '../store/tasks';
import { ui } from '../store/ui';
import { go, showOverview } from '../actions';
import {
  IconBook, IconBrain, IconChess, IconChart, IconGrid, IconHistory, IconLayers, IconList, IconMap, IconMenu, IconMic, IconSettings, IconSparkle, IconTerminal, IconTicket,
} from './Icons';
import { t } from '../i18n';
import { workProfile } from '../../shared/work-profiles';
import { SidebarTree } from './SidebarTree';
import { useProposalCount } from '../lib/proposals';
import { HUB_PAGES } from '../lib/memory-hub';
import { workingCount } from '../lib/working-count';

const ICON: Record<BrainPageId, ReactNode> = {
  home: <IconGrid />,
  agenti: <IconLayers />,
  andamento: <IconChart />, script: <IconTerminal />, log: <IconList />, file: <IconBrain />, task: <IconTicket />, skill: <IconSparkle />, impostazioni: <IconSettings />,
  registrazioni: <IconMic />, impara: <IconBook />, scacchi: <IconChess />,
  memoria: <IconHistory />, piani: <IconTicket />, collegamenti: <IconMap />,
};

const WORK_PAGES: BrainPageId[] = ['piani', 'task', 'registrazioni'];
const LEISURE_PAGES: BrainPageId[] = ['impara', 'scacchi'];
const SYSTEM_PAGES: BrainPageId[] = ['agenti', 'memoria', 'collegamenti', 'andamento', 'log', 'impostazioni'];
const IN_MEMORIA = Object.keys(HUB_PAGES);

function Badge({ n, warn }: { n: number; warn?: boolean }) {
  if (!n) return null;
  return <span className={`nav-badge ${warn ? 'warn' : ''}`} aria-label={t('dialogs.sidebar.new', { count: n })}>{warn ? '!' : n > 99 ? '99+' : n}</span>;
}

export function Sidebar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuWrap = useRef<HTMLDivElement>(null);
  const saved = ui.use(s => s.prefs.workProfile);
  const composition = workProfile(saved, BRAIN_PAGES.map(page => page.id));
  const show = (id: BrainPageId) => !composition || composition.pageIds.includes(id);
  const extraPages = composition
    ? composition.pageIds.filter((id): id is BrainPageId =>
        BRAIN_PAGES.some(page => page.id === id) &&
        !['home', ...WORK_PAGES, ...LEISURE_PAGES, ...SYSTEM_PAGES, ...IN_MEMORIA].includes(id))
    : [];
  const page = ui.use(s => s.page);
  const map = ui.use(s => s.map);
  const read = ui.use(s => s.read);
  const feed = useApp(s => s.feed);
  const waiting = useApp(s => s.pending.length);
  const working = useApp(s => workingCount(s.chats));
  const tasksUnread = useTasks(s => s?.unread ?? 0);
  const tasksOn = useTasks(s => s !== null && s.error?.kind !== 'script');
  const b = badges(feed, read);
  const proposals = useProposalCount();
  const menuAlerts = proposals + (tasksOn ? tasksUnread : 0);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (menuWrap.current && !menuWrap.current.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setMenuOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  const waitingBadge = <span className="nav-badge amber" data-testid="nav-badge-waiting" aria-label={t('dialogs.sidebar.waiting', { count: waiting })}>{waiting}</span>;
  const workingBadge = <span className="nav-badge" data-testid="nav-badge-working" aria-label={t('dialogs.sidebar.working', { count: working })}>{working > 99 ? '99+' : working}</span>;
  const homeBadge = working || waiting ? <>{working ? workingBadge : null}{waiting ? waitingBadge : null}</> : null;

  const labelOf = (id: BrainPageId, fallback: string) =>
    id === 'agenti' ? t('catalog.title') : id === 'impara' ? 'Giornale & Fonti' : fallback;

  const menuItem = (id: BrainPageId) => {
    const p = BRAIN_PAGES.find(x => x.id === id);
    if (!p) return null;
    if (id === 'task' && (!tasksOn || !show('task'))) return null;
    const on = page === p.id && !map;
    const label = labelOf(p.id, p.label);
    const badge = p.id === 'memoria' && proposals
      ? <span className="nav-badge amber nav-badge-pulse" data-testid="nav-badge-proposals" aria-label={t('mh.badge', { n: proposals })}>{proposals > 99 ? '99+' : proposals}</span>
      : <span data-testid={`nav-badge-${p.id}`}><Badge n={p.id === 'task' ? tasksUnread : b[p.id] ?? 0} warn={WARN_SECTIONS.has(p.id)} /></span>;
    return (
      <button key={p.id} type="button" className={`nav-item ${on ? 'on' : ''}`} role="menuitem"
        onClick={() => { setMenuOpen(false); if (p.id === 'home') showOverview(); else go({ page: p.id }); }}
        aria-current={on ? 'page' : undefined} data-testid={`nav-${p.id}`}
        data-tip={p.key ? `${label}|${p.key}` : undefined} aria-label={label}>
        <span className="nav-icon">{ICON[p.id] ?? <IconBrain />}</span>
        <span className="nav-label">{label}</span>
        {badge}
      </button>
    );
  };

  const homePage = BRAIN_PAGES.find(x => x.id === 'home')!;
  const homeOn = page === 'home' && !map;

  return (
    <nav className="sidebar" aria-label={t('dialogs.sidebar.label')} data-testid="sidebar">
      <div className="sidebar-head" ref={menuWrap}>
        <button type="button" className={`nav-menu-btn ${menuOpen ? 'on' : ''}`}
          aria-expanded={menuOpen} aria-haspopup="menu" aria-label="Menu navigazione"
          data-tip="Menu pagine" data-testid="nav-menu-btn"
          onClick={() => setMenuOpen(o => !o)}>
          <IconMenu size={16} />
          {menuAlerts > 0 && <span className="nav-menu-dot" aria-hidden="true" />}
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
          <div className="nav-menu-pop" role="menu" aria-label="Menu sezioni" data-testid="nav-menu">
            <div className="nav-title" data-testid="nav-group-work">{t('dialogs.sidebar.work')}</div>
            {menuItem('home')}
            {WORK_PAGES.map(menuItem)}
            <div className="nav-sep" />
            <div className="nav-title" data-testid="nav-group-leisure">Svago</div>
            {LEISURE_PAGES.map(menuItem)}
            <div className="nav-sep" />
            <div className="nav-title" data-testid="nav-group-system">Sistema</div>
            {SYSTEM_PAGES.map(menuItem)}
            {extraPages.map(menuItem)}
          </div>
        )}
      </div>
      <div className="nav-group nav-scroll">
        <SidebarTree />
      </div>
    </nav>
  );
}
