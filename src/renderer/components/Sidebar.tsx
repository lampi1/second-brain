// The left navigation, always visible and collapsible (remembered): the chat grid (Ctrl+1), every brain section (with
// its G-letter shortcut) and the dedicated "Mappa" button (Impostazioni is not listed: the gear menu, Ctrl+, and Ctrl+K reach it). Each entry carries the unread badge of the feed kinds it
// owns (lib/notify.ts sectionOf; Costi as a warning), cleared when the section is visited; DevOps shows its unread news
// (store/devops.ts), cleared by marking them read. Pointing at "Mappa" gets the map's data ready (preloadMap).
// Used by App.tsx.
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

const ICON: Record<BrainPageId, ReactNode> = {
  fatto: <IconBook />, idee: <IconLightbulb />,
  costi: <IconCoins />, qualita: <IconChart />, procedure: <IconCompass />, confronto: <IconLayers />, miglioramento: <IconTarget />, esplora: <IconBrain />, devops: <IconTicket />, skill: <IconSparkle />, impostazioni: <IconSettings />, migliora: <IconSparkle />,
};

function Badge({ n, warn }: { n: number; warn?: boolean }) {
  if (!n) return null;
  return <span className={`nav-badge ${warn ? 'warn' : ''}`} aria-label={`${n} nuove`}>{warn ? '!' : n > 99 ? '99+' : n}</span>;
}

export function Sidebar() {
  const collapsedPref = ui.use(s => s.prefs.navCollapsed);
  const page = ui.use(s => s.page);
  const map = ui.use(s => s.map);
  const read = ui.use(s => s.read);
  const feed = useApp(s => s.feed);
  const waiting = useApp(s => s.pending.length);
  const devopsUnread = useDevops(s => s?.unread ?? 0);
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
  return (
    <nav className={`sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="Sezioni" data-testid="sidebar">
      <div className="nav-group">
        {item('workspace', 'Chat', <IconGrid />, !page && !map, () => go({ page: 'workspace' }), {
          key: 'Ctrl+1', testid: 'nav-workspace',
          badge: waiting ? <span className="nav-badge amber" data-testid="nav-badge-waiting" aria-label={`${waiting} ti aspettano`}>{waiting}</span> : <span data-testid="nav-badge-workspace"><Badge n={b.workspace ?? 0} /></span>,
        })}
      </div>
      <div className="nav-sep" role="separator" />
      <div className="nav-group nav-scroll">
        {!collapsed && <div className="nav-title">Cervello</div>}
        {BRAIN_PAGES.filter(p => p.id !== 'impostazioni' && p.id !== 'migliora').map(p => item(p.id, p.label, ICON[p.id] ?? <IconBrain />, page === p.id && !map, () => go({ page: p.id }), {
          key: p.key, testid: `nav-${p.id}`, badge: <span data-testid={`nav-badge-${p.id}`}><Badge n={p.id === 'devops' ? devopsUnread : b[p.id] ?? 0} warn={WARN_SECTIONS.has(p.id)} /></span>,
        }))}
      </div>
      <div className="nav-sep" role="separator" />
      <div className="nav-group">
        {item('migliora', "Migliora l'app", <IconSparkle />, page === 'migliora' && !map, () => go({ page: 'migliora' }), { key: 'G U', testid: 'nav-migliora' })}
        {item('mappa', 'Mappa 3D', <IconMap />, map, () => go({ page: 'mappa' }), { key: 'Ctrl+Shift+M', testid: 'nav-map', onHover: () => preloadMap(true) })}
        <button type="button" className="nav-item nav-collapse" onClick={() => setPrefs({ navCollapsed: !collapsed })} aria-label={collapsed ? 'Espandi il menu' : 'Comprimi il menu'}
          data-tip={collapsed ? 'Espandi il menu' : undefined} data-testid="nav-collapse" aria-expanded={!collapsed}>
          <span className="nav-icon"><IconChevronRight style={{ transform: collapsed ? 'none' : 'rotate(180deg)' }} /></span>
          {!collapsed && <span className="nav-label">Comprimi</span>}
        </button>
      </div>
    </nav>
  );
}
