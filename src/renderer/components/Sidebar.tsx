// The left navigation, always visible and collapsible (remembered), in three groups (2026-10-15, before one flat list of
// 13): Lavoro = the chat grid (Ctrl+1), DevOps (only while the brain has its script: the app is generic) and Fatto;
// Brain = what the brain holds (Idee, Procedure, Regole imparate, Esplora, the "Mappa 3D" button); App = how the app
// itself is doing and is shaped (Costi, Qualità, Confronto modelli, Skill e agenti, "Migliora l'app"). Impostazioni is
// not listed: the gear menu, Ctrl+, and Ctrl+K reach it. Each entry keeps its G-letter shortcut and carries the unread
// badge of the feed kinds it owns (lib/notify.ts sectionOf; Costi as a warning), cleared when the section is visited;
// DevOps shows its unread news (store/devops.ts), cleared by marking them read. Pointing at "Mappa" gets the map's data
// ready (preloadMap). Used by App.tsx.
import type { ReactNode } from 'react';
import { BRAIN_PAGES, preloadMap, type BrainPageId } from '../brain';
import { badges, WARN_SECTIONS } from '../lib/notify';
import { useApp } from '../store/store';
import { useDevops } from '../store/devops';
import { setPrefs, ui } from '../store/ui';
import { go } from '../actions';
import {
  IconBook, IconBrain, IconChart, IconChevronRight, IconCoins, IconCompass, IconGrid, IconLayers, IconLightbulb, IconMap, IconSettings, IconSparkle, IconTarget, IconTicket,
} from './Icons';
import { t } from '../i18n';
import {useAgents} from '../store/agents';
import {activeRole} from '../lib/role-consumers';

const ICON: Record<BrainPageId, ReactNode> = {
  home: <IconGrid />,
  agenti: <IconLayers />,
  fatto: <IconBook />, idee: <IconLightbulb />,
  costi: <IconCoins />, qualita: <IconChart />, procedure: <IconCompass />, confronto: <IconLayers />, miglioramento: <IconTarget />, file: <IconBrain />, devops: <IconTicket />, skill: <IconSparkle />, impostazioni: <IconSettings />, migliora: <IconSparkle />,
  dashboard: <IconChart />,
};

/** The pages of the two lower groups, in order (Lavoro is built by hand: Chat is not a page, DevOps can hide). */
const BRAIN_GROUP: BrainPageId[] = ['procedure', 'miglioramento'];
const APP_GROUP: BrainPageId[] = ['skill'];

function Badge({ n, warn }: { n: number; warn?: boolean }) {
  if (!n) return null;
  return <span className={`nav-badge ${warn ? 'warn' : ''}`} aria-label={t('dialogs.sidebar.new', { count: n })}>{warn ? '!' : n > 99 ? '99+' : n}</span>;
}

export function Sidebar() {
  const {catalog}=useAgents(),role=ui.use(s=>s.prefs.role);
  const composition=activeRole(role,catalog,BRAIN_PAGES.map(page=>page.id));
  const show=(id:BrainPageId)=>!composition||composition.pageIds.includes(id);
  const brainPages=composition?composition.pageIds.filter((id):id is BrainPageId=>BRAIN_PAGES.some(page=>page.id===id)&&!['home','devops','fatto','impostazioni'].includes(id)):BRAIN_GROUP;
  const collapsedPref = ui.use(s => s.prefs.navCollapsed);
  const page = ui.use(s => s.page);
  const map = ui.use(s => s.map);
  const read = ui.use(s => s.read);
  const feed = useApp(s => s.feed);
  const waiting = useApp(s => s.pending.length);
  const devopsUnread = useDevops(s => s?.unread ?? 0);
  // DevOps only while the brain can read it: hidden once the read says the brain has no devops-me.mjs
  const devopsOn = useDevops(s => s !== null && s.error?.kind !== 'script'); // not before the first read: no flash
  const collapsed = collapsedPref ?? window.innerWidth < 1800;
  const b = badges(feed, read);
  const item = (id: string, label: string, icon: ReactNode, on: boolean, onClick: () => void, extra: { key?: string; badge?: ReactNode; testid: string; onHover?: () => void }) => (
    <button key={id} type="button" className={`nav-item ${on ? 'on' : ''}`} onClick={onClick} onPointerEnter={extra.onHover} onFocus={extra.onHover} aria-current={on ? 'page' : undefined} data-testid={extra.testid}
      data-tip={collapsed ? `${label}${extra.key ? `|${extra.key}` : ''}` : extra.key ? `${label}|${extra.key}` : undefined} aria-label={label}>
      <span className="nav-icon">{icon}</span>
      {!collapsed && <span className="nav-label">{label}</span>}
      {extra.badge}
    </button>
  );
  const page1 = (id: BrainPageId) => {
    const p = BRAIN_PAGES.find(x => x.id === id)!;
    return item(p.id, p.id==='agenti'?t('product.profiles'):p.label, ICON[p.id] ?? <IconBrain />, page === p.id && !map, () => go({ page: p.id }), {
      key: p.key, testid: `nav-${p.id}`, badge: <span data-testid={`nav-badge-${p.id}`}><Badge n={p.id === 'devops' ? devopsUnread : b[p.id] ?? 0} warn={WARN_SECTIONS.has(p.id)} /></span>,
    });
  };
  const title = (txt: string, id: string) => (collapsed ? <div className="nav-sep" role="separator" aria-label={txt} data-testid={`nav-group-${id}`} /> : <div className="nav-title" data-testid={`nav-group-${id}`}>{txt}</div>);
  return (
    <nav className={`sidebar ${collapsed ? 'collapsed' : ''}`} aria-label={t('dialogs.sidebar.label')} data-testid="sidebar">
      <div className="nav-group nav-scroll">
        {page1('home')}
        {page1('dashboard')}
        {!collapsed && <div className="nav-title" data-testid="nav-group-work">{t('dialogs.sidebar.work')}</div>}
        {item('workspace', t('dialogs.sidebar.chat'), <IconGrid />, !page && !map, () => go({ page: 'workspace' }), {
          key: t('dialogs.sidebar.chatShortcut'), testid: 'nav-workspace',
          badge: waiting ? <span className="nav-badge amber" data-testid="nav-badge-waiting" aria-label={t('dialogs.sidebar.waiting', { count: waiting })}>{waiting}</span> : <span data-testid="nav-badge-workspace"><Badge n={b.workspace ?? 0} /></span>,
        })}
        {devopsOn && show('devops') && page1('devops')}
        {show('fatto')&&page1('fatto')}
        {title(t('dialogs.sidebar.brain'), 'brain')}
        {brainPages.map(page1)}
        {item('mappa', t('dialogs.sidebar.map'), <IconMap />, map, () => go({ page: 'mappa' }), { key: t('dialogs.sidebar.mapShortcut'), testid: 'nav-map', onHover: () => preloadMap(true) })}
        {!composition&&title(t('dialogs.sidebar.app'), 'app')}
        {!composition&&APP_GROUP.map(page1)}
      </div>
      <div className="nav-sep" role="separator" />
      <div className="nav-group">
        <button type="button" className="nav-item nav-collapse" onClick={() => setPrefs({ navCollapsed: !collapsed })} aria-label={collapsed ? t('dialogs.sidebar.expandLabel') : t('dialogs.sidebar.collapseLabel')}
          data-tip={collapsed ? t('dialogs.sidebar.expandLabel') : undefined} data-testid="nav-collapse" aria-expanded={!collapsed}>
          <span className="nav-icon"><IconChevronRight style={{ transform: collapsed ? 'none' : 'rotate(180deg)' }} /></span>
          {!collapsed && <span className="nav-label">{t('dialogs.sidebar.collapse')}</span>}
        </button>
      </div>
    </nav>
  );
}
