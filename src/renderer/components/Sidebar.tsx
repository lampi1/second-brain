// The app rail groups work, brain content and app tools. Dashboard owns the brain map entry;
// role-specific pages exclude destinations already supplied by the shell. Used by App.tsx.
import type { ReactNode } from 'react';
import { BRAIN_PAGES, type BrainPageId } from '../brain';
import { badges, WARN_SECTIONS } from '../lib/notify';
import { useApp } from '../store/store';
import { useDevops } from '../store/devops';
import { ui } from '../store/ui';
import { go } from '../actions';
import {
  IconBook, IconBrain, IconHistory, IconTerminal, IconChart, IconCoins, IconCompass, IconGrid, IconLayers, IconLightbulb, IconQuestion, IconSettings, IconSparkle, IconTarget, IconTicket,
} from './Icons';
import { t } from '../i18n';
import {useAgents} from '../store/agents';
import {activeRole} from '../lib/role-consumers';
import { useApprovalCount } from '../store/agent-approvals';

const ICON: Record<BrainPageId, ReactNode> = {
  home: <IconGrid />,
  agenti: <IconLayers />,
  fatto: <IconBook />, idee: <IconLightbulb />,
  costi: <IconCoins />, qualita: <IconChart />, procedure: <IconCompass />, script: <IconTerminal />, changelog: <IconHistory />, confronto: <IconLayers />, miglioramento: <IconTarget />, file: <IconBrain />, devops: <IconTicket />, skill: <IconSparkle />, impostazioni: <IconSettings />, migliora: <IconSparkle />,
  dashboard: <IconChart />, guida: <IconQuestion />,
};

/** The pages of the two lower groups, in order (Lavoro is built by hand: DevOps can hide; the Dashboard shows under any role). */
const BRAIN_GROUP: BrainPageId[] = ['procedure', 'script', 'changelog', 'miglioramento'];
/** always in the Brain group, whatever the role (the owner, 2026-10-19: the brain must be visible; ADR 0076) */
const BRAIN_ALWAYS: BrainPageId[] = ['script', 'changelog'];
const APP_GROUP: BrainPageId[] = ['skill'];

function Badge({ n, warn }: { n: number; warn?: boolean }) {
  if (!n) return null;
  return <span className={`nav-badge ${warn ? 'warn' : ''}`} aria-label={t('dialogs.sidebar.new', { count: n })}>{warn ? '!' : n > 99 ? '99+' : n}</span>;
}

export function Sidebar() {
  const {catalog}=useAgents(),role=ui.use(s=>s.prefs.role);
  const composition=activeRole(role,catalog,BRAIN_PAGES.map(page=>page.id));
  const show=(id:BrainPageId)=>!composition||composition.pageIds.includes(id);
  const brainPages=composition?composition.pageIds.filter((id):id is BrainPageId=>BRAIN_PAGES.some(page=>page.id===id)&&!['home','agenti','dashboard','guida','devops','fatto','impostazioni','migliora'].includes(id)):BRAIN_GROUP;
  for(const id of BRAIN_ALWAYS)if(!brainPages.includes(id))brainPages.push(id);
  const page = ui.use(s => s.page);
  const map = ui.use(s => s.map);
  const read = ui.use(s => s.read);
  const feed = useApp(s => s.feed);
  const waiting = useApp(s => s.pending.length);
  const devopsUnread = useDevops(s => s?.unread ?? 0);
  // DevOps only while the brain can read it: hidden once the read says the brain has no devops-me.mjs
  const devopsOn = useDevops(s => s !== null && s.error?.kind !== 'script'); // not before the first read: no flash
  const b = badges(feed, read);
  // pending agent changes (Da approvare, components/AgentApprovals.tsx) outrank the Agenti page's feed count
  const approvals = useApprovalCount();
  const item = (id: string, label: string, icon: ReactNode, on: boolean, onClick: () => void, extra: { key?: string; badge?: ReactNode; testid: string; onHover?: () => void }) => (
    <button key={id} type="button" className={`nav-item ${on ? 'on' : ''}`} onClick={onClick} onPointerEnter={extra.onHover} onFocus={extra.onHover} aria-current={on ? 'page' : undefined} data-testid={extra.testid}
      data-tip={extra.key ? `${label}|${extra.key}` : undefined} aria-label={label}>
      <span className="nav-icon">{icon}</span>
      <span className="nav-label">{label}</span>
      {extra.badge}
    </button>
  );
  // the agents live in the Grindhouse (SPEC 19): its entry carries the count of agents waiting for an answer
  const waitingBadge = <span className="nav-badge amber" data-testid="nav-badge-waiting" aria-label={t('dialogs.sidebar.waiting', { count: waiting })}>{waiting}</span>;
  const page1 = (id: BrainPageId) => {
    const p = BRAIN_PAGES.find(x => x.id === id)!;
    return item(p.id, p.id==='agenti'?t('catalog.title'):p.label, ICON[p.id] ?? <IconBrain />, page === p.id && !map, () => go({ page: p.id }), {
      key: p.key, testid: `nav-${p.id}`, badge: p.id === 'home' && waiting ? waitingBadge : p.id === 'agenti' && approvals ? <span className="nav-badge amber" data-testid="nav-badge-approvals" aria-label={t('approvals.countLabel', { n: approvals })}>{approvals > 99 ? '99+' : approvals}</span> : <span data-testid={`nav-badge-${p.id}`}><Badge n={p.id === 'devops' ? devopsUnread : b[p.id] ?? 0} warn={WARN_SECTIONS.has(p.id)} /></span>,
    });
  };
  const title = (txt: string, id: string) => <div className="nav-title" data-testid={`nav-group-${id}`}>{txt}</div>;
  return (
    <nav className="sidebar" aria-label={t('dialogs.sidebar.label')} data-testid="sidebar">
      <div className="nav-group nav-scroll">
        {page1('home')}
        {page1('agenti')}
        {title(t('dialogs.sidebar.work'), 'work')}
        {devopsOn && show('devops') && page1('devops')}
        {show('fatto')&&page1('fatto')}
        {title(t('dialogs.sidebar.brain'), 'brain')}
        {brainPages.map(page1)}
        {title(t('dialogs.sidebar.app'), 'app')}
        {page1('dashboard')}
        {page1('guida')}
        {!composition&&APP_GROUP.map(page1)}
      </div>
    </nav>
  );
}
