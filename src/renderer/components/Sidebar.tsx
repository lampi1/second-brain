// The app rail groups work, the Brain (ADR 0077: Agenti, Memoria, Classificatori and the Mappa of their links; Memoria
// is the one hub of the brain's content since ADR 0122, with Skill, Regole, Script & Query, Idee and Apprendimento as its
// tabs, and carries the count of proposals waiting for the user), Andamento (Costi and Qualità, ADR 0101, 0109) and app
// tools (Log = everything the app did, live, ADR 0111, Guida; the Dashboard is gone, ADR 0122). Role-specific pages
// exclude destinations already supplied by the shell. Under the Grindhouse entry, the open agents as a delegation
// tree (SidebarTree.tsx). Used by App.tsx.
import type { ReactNode } from 'react';
import { BRAIN_PAGES, type BrainPageId } from '../brain';
import { badges, WARN_SECTIONS } from '../lib/notify';
import { useApp } from '../store/store';
import { useTasks } from '../store/tasks';
import { ui } from '../store/ui';
import { go } from '../actions';
import {
  IconBook, IconBrain, IconBranch, IconChart, IconTarget, IconCoins, IconGrid, IconHistory, IconLayers, IconLightbulb, IconList, IconMap, IconQuestion, IconSettings, IconShield, IconSparkle, IconTerminal, IconTicket,
} from './Icons';
import { t } from '../i18n';
import {workProfile} from '../../shared/work-profiles';
import { SidebarTree } from './SidebarTree';
import { useProposalCount } from '../lib/proposals';
import { HUB_PAGES } from '../lib/memory-hub';

const ICON: Record<BrainPageId, ReactNode> = {
  home: <IconGrid />,
  agenti: <IconLayers />,
  fatto: <IconBook />, idee: <IconLightbulb />,
  costi: <IconCoins />, qualita: <IconChart />, apprendimento: <IconTarget />, script: <IconTerminal />, log: <IconList />, confronto: <IconLayers />, file: <IconBrain />, task: <IconTicket />, skill: <IconSparkle />, impostazioni: <IconSettings />,
  guida: <IconQuestion />,
  regole: <IconShield />, memoria: <IconHistory />, classificatori: <IconBranch />, collegamenti: <IconMap />,
};

/** The pages of the two lower groups, in order (Lavoro is built by hand: Task can hide; the Dashboard shows under any role). */
const BRAIN_GROUP: BrainPageId[] = [];
/** The Brain section: always shown, whatever the role (ADR 0077; the owner, 2026-10-19: the brain must be visible; its
 *  changelog is on the Log page, ADR 0111). Skill, Regole, Script, Idee and Apprendimento are Memoria's tabs (ADR 0122). */
const BRAIN_CORE: BrainPageId[] = ['agenti', 'memoria', 'classificatori', 'collegamenti'];
/** Andamento: how the work goes, in money and in quality; always shown (ADR 0101, 0109). */
const TRENDS: BrainPageId[] = ['costi', 'qualita'];
/** The pages that are Memoria's tabs now: never an entry of their own, whatever the work profile lists. */
const IN_MEMORIA = Object.keys(HUB_PAGES);

function Badge({ n, warn }: { n: number; warn?: boolean }) {
  if (!n) return null;
  return <span className={`nav-badge ${warn ? 'warn' : ''}`} aria-label={t('dialogs.sidebar.new', { count: n })}>{warn ? '!' : n > 99 ? '99+' : n}</span>;
}

export function Sidebar() {
  const saved=ui.use(s=>s.prefs.workProfile);
  const composition=workProfile(saved,BRAIN_PAGES.map(page=>page.id));
  const show=(id:BrainPageId)=>!composition||composition.pageIds.includes(id);
  const brainPages=composition?composition.pageIds.filter((id):id is BrainPageId=>BRAIN_PAGES.some(page=>page.id===id)&&!['home','log','guida','task','fatto','impostazioni',...BRAIN_CORE,...TRENDS,...IN_MEMORIA].includes(id)):BRAIN_GROUP;
  const page = ui.use(s => s.page);
  const map = ui.use(s => s.map);
  const read = ui.use(s => s.read);
  const feed = useApp(s => s.feed);
  const waiting = useApp(s => s.pending.length);
  const tasksUnread = useTasks(s => s?.unread ?? 0);
  // Task only while the brain can read it: hidden once the read says the brain has no devops-me.mjs
  const tasksOn = useTasks(s => s !== null && s.error?.kind !== 'script'); // not before the first read: no flash
  const b = badges(feed, read);
  // proposals waiting for the user (Memoria → Proposte, ADR 0122, 0123)
  const proposals = useProposalCount();
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
      key: p.key, testid: `nav-${p.id}`, badge: p.id === 'home' && waiting ? waitingBadge : p.id === 'memoria' && proposals ? <span className="nav-badge amber nav-badge-pulse" data-testid="nav-badge-proposals" aria-label={t('mh.badge', { n: proposals })}>{proposals > 99 ? '99+' : proposals}</span> : <span data-testid={`nav-badge-${p.id}`}><Badge n={p.id === 'task' ? tasksUnread : b[p.id] ?? 0} warn={WARN_SECTIONS.has(p.id)} /></span>,
    });
  };
  const title = (txt: string, id: string) => <div className="nav-title" data-testid={`nav-group-${id}`}>{txt}</div>;
  return (
    <nav className="sidebar" aria-label={t('dialogs.sidebar.label')} data-testid="sidebar">
      <div className="nav-group nav-scroll">
        {page1('home')}
        <SidebarTree />
        {title(t('dialogs.sidebar.work'), 'work')}
        {tasksOn && show('task') && page1('task')}
        {show('fatto')&&page1('fatto')}
        {title(t('dialogs.sidebar.brain'), 'brain')}
        {BRAIN_CORE.map(page1)}
        {brainPages.map(page1)}
        {title(t('dialogs.sidebar.trends'), 'trends')}
        {TRENDS.map(page1)}
        {title(t('dialogs.sidebar.app'), 'app')}
        {page1('log')}
        {page1('guida')}
      </div>
    </nav>
  );
}
