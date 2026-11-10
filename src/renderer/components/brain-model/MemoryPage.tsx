// "Memoria" (G Y, ADR 0077, 0122): the one hub of what the brain holds. On top, alive: the live counters (proposals waiting, agents at work, agents waiting for you, changes of the
// last 24 hours; each eases to its new value) and the latest changes as they happen, then the one
// «Manutenzione» button. Below, a tab bar (pills with a count each, arrows / Home / End, the page arg "memoria/<tab>"
// so a link opens a tab: lib/memory-hub.ts): Proposte (ProposalsDeck.tsx), Approvate (ApprovedTab.tsx: everything in
// the brain now, deleted in one click with Annulla), Skill (SkillsPage.tsx), Regole (RulesPage.tsx), Idee (brain/pages/Idee.tsx: yours and the AI's, «Rispolvera»), File (the
// «Diario e note»: MemoryBrowser.tsx, ADR 0245); Apprendimento moved to Andamento (ADR 0202); Statistiche is gone (ADR
// 0248: it counted rules and notes; skill use is in the Skill tab); Script & Query is gone (ADR 0263: scripts and queries
// are files of their skill, shown in its «Leggi»). The old Skill, Regole, Script, Idee and Dashboard
// pages land here (actions.ts go()). Memory never travels with an exported agent. Rendered by App.tsx
// PageFrame for 'memoria'. Styles: styles/memory-hub.css (mh-*), memory.css (mm-*).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import type { BrainChange } from '@shared/brain-model';
import { brainBridge, go, goTarget } from '../../actions';
import { locale, t, type TextKey } from '../../i18n';
import { useBrainModel } from '../../store/brain-model';
import { useApp } from '../../store/store';
import { ui } from '../../store/ui';
import { HUB_TABS, hubArg, parseHubArg, type HubTab } from '../../lib/memory-hub';
import { useProposalCount } from '../../lib/proposals';
import { now as clockNow } from '../../lib/clock';
import { useBrain } from '../../brain/api';
import { normTables } from '../../brain/types';
import { Toaster } from '../../brain/components/ui';
import { DiscussContext } from '../../brain/components/Discuss';
import { Idee } from '../../brain/pages/Idee';
import { ThemesPanel } from '../../dashboard/Themes';
import { useCountUp } from '../../dashboard/parts';
import { IconBolt, IconCheck, IconFile, IconLightbulb, IconShield, IconSparkle } from '../Icons';
import { SkillsPage } from '../SkillsPage';
import { MaintenancePanel } from './MaintenancePanel';
import { MaintenanceButton } from './MaintenanceButton';
import { RulesPage } from './RulesPage';
import { ApprovedTab, useApprovedCount } from './ApprovedTab';
import { ProposalsDeck } from './ProposalsDeck';
import { MemoryBrowser } from './MemoryBrowser';
import '../../styles/agent-catalog.css';
import '../../styles/brain-model.css';
import '../../styles/memory.css';
import '../../styles/memory-hub.css';

const num = (n: number) => Math.round(n).toLocaleString(locale());
const DAY = 24 * 3600e3;

// ── alive: the live counters and the latest changes ──────────────────────────────────────────────────────────────────
function Pulse({ k, n, tone, onClick, testId, help }: { k: TextKey; n: number | undefined; tone?: 'amber' | 'green' | 'blue' | 'violet'; onClick?: () => void; testId: string; help: TextKey }) {
  const shown = useCountUp(n);
  const body = <><span className="mh-pulse-v" data-on={!!n}>{shown === undefined ? '—' : num(shown)}</span><span className="mh-pulse-k">{t(k)}</span></>;
  return onClick
    ? <button type="button" className="mh-pulse" data-tone={tone} data-testid={testId} onClick={onClick} title={t(help)}>{body}</button>
    : <div className="mh-pulse" data-tone={tone} data-testid={testId} title={t(help)}>{body}</div>;
}

const ago = (ms: number, nowMs: number): string => {
  const m = Math.max(0, Math.round((nowMs - ms) / 60e3));
  if (m < 1) return t('mh.ago.now');
  if (m < 60) return t('mh.ago.min', { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t('mh.ago.hours', { n: h });
  return t('mh.ago.days', { n: Math.round(h / 24) });
};
/** where a change is shown: its Memoria tab; a role's change (what it proved) in Andamento → Apprendimento (ADR 0202) */
const PLACE_OF_KIND: Record<BrainChange['kind'], { page: 'memoria' | 'andamento'; arg: string }> = {
  skill: { page: 'memoria', arg: hubArg('skill') }, rule: { page: 'memoria', arg: hubArg('regole') }, memory: { page: 'memoria', arg: hubArg('file') },
  agent: { page: 'andamento', arg: 'apprendimento' }, script: { page: 'memoria', arg: hubArg('skill') },
};

function Activity({ changes, nowMs }: { changes: BrainChange[]; nowMs: number }) {
  const recent = changes.slice(0, 4);
  return <section className="mh-activity" aria-labelledby="mh-activity-h" data-testid="mh-activity">
    <h2 id="mh-activity-h"><i className="mh-live" aria-hidden="true" />{t('mh.activity')}</h2>
    {recent.length ? <ol aria-live="polite">{recent.map((c, i) => <li key={c.id} style={{ '--i': i } as CSSProperties} data-undone={!!c.rolledBackAt}>
      <button type="button" onClick={() => go(PLACE_OF_KIND[c.kind])} title={c.reason}>
        <span className="bm-tag" data-kind={c.kind}>{t(`bm.kind.${c.kind}`)}</span>
        <span className="mh-activity-what">{c.summary}</span>
        <time dateTime={new Date(c.at).toISOString()}>{ago(c.at, nowMs)}</time>
      </button>
    </li>)}</ol> : <p className="mh-activity-empty">{t('mh.activityEmpty')}</p>}
  </section>;
}

function Hero({ onTab }: { onTab: (tab: HubTab) => void }) {
  const { state } = useBrainModel();
  const proposals = useProposalCount();
  const chats = useApp(s => s.chats);
  const [nowMs, setNow] = useState(() => clockNow());
  useEffect(() => { const id = setInterval(() => { if (!document.hidden) setNow(clockNow()); }, 30_000); return () => clearInterval(id); }, []);
  const live = Object.values(chats).filter(c => !c.closedAt && c.state !== 'closed' && !c.isOrchestrator);
  const working = live.filter(c => c.state === 'running' || c.state === 'starting').length;
  const waiting = Object.values(chats).filter(c => !c.closedAt && c.state === 'waiting').length;
  const changes = state?.changes ?? [];
  const today = changes.filter(c => !c.rolledBackAt && nowMs - c.at < DAY).length;
  return <header className="mh-hero" data-testid="mh-hero">
    <div className="mh-hero-glow" aria-hidden="true" />
    <div className="mh-hero-top">
      <div className="mh-hero-text">
        <span className="mh-eyebrow"><i className="mh-live" aria-hidden="true" />{t('mh.eyebrow')}</span>
        <h1>{t('bm.mem.title')}</h1>
        <p className="mh-lead">{t('mh.lead')}</p>
      </div>
      <div className="mh-hero-actions"><MaintenanceButton /></div>
    </div>
    <div className="mh-hero-bottom">
      <div className="mh-pulses" role="group" aria-label={t('mh.pulseLabel')}>
        <Pulse k="mh.pulse.proposals" help="mh.pulse.proposalsHelp" n={proposals} tone="amber" onClick={() => onTab('proposte')} testId="mh-pulse-proposals" />
        <Pulse k="mh.pulse.working" help="mh.pulse.workingHelp" n={working} tone="green" testId="mh-pulse-working" />
        <Pulse k="mh.pulse.waiting" help="mh.pulse.waitingHelp" n={waiting} tone="violet" testId="mh-pulse-waiting" />
        <Pulse k="mh.pulse.changes" help="mh.pulse.changesHelp" n={state ? today : undefined} tone="blue" onClick={() => go({ page: 'andamento', arg: 'apprendimento' })} testId="mh-pulse-changes" />
      </div>
      <Activity changes={changes} nowMs={nowMs} />
    </div>
  </header>;
}

// ── the tab bar ─────────────────────────────────────────────────────────────────────────────────────────────────────
const ICON: Record<HubTab, ReactNode> = {
  proposte: <IconBolt />, approvate: <IconCheck />, skill: <IconSparkle />, regole: <IconShield />,
  idee: <IconLightbulb />, file: <IconFile />,
};

function useCounts(): Partial<Record<HubTab, number>> {
  const { state } = useBrainModel();
  const proposals = useProposalCount();
  const approved = useApprovedCount();
  const tables = useBrain('/api/tables', normTables);
  return {
    proposte: proposals, approvate: approved,
    skill: state?.skills.length, regole: state?.rules.length,
    idee: tables.data?.ideas.length,
  };
}

function TabBar({ tab, onTab }: { tab: HubTab; onTab: (tab: HubTab) => void }) {
  const counts = useCounts();
  const bar = useRef<HTMLDivElement>(null);
  const [ink, setInk] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const el = bar.current?.querySelector<HTMLElement>('[aria-selected=true]');
      if (!el) return;
      setInk({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    };
    place();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    if (bar.current) {
      ro?.observe(bar.current);
      // Counts and translated labels can reflow tabs without changing the bar's size.
      bar.current.querySelectorAll('button').forEach(button => ro?.observe(button));
    }
    return () => ro?.disconnect();
  }, [tab, counts.skill, counts.idee, counts.approvate]);
  const key = (e: KeyboardEvent, i: number) => {
    const n = HUB_TABS.length;
    const next = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
    if (next === null) return;
    e.preventDefault();
    onTab(HUB_TABS[next]!);
    requestAnimationFrame(() => document.getElementById(`mh-tab-${HUB_TABS[next]}`)?.focus());
  };
  return <div className="mh-tabs-wrap"><div className="mh-tabs" role="tablist" aria-label={t('mh.tabsLabel')} ref={bar} data-testid="mh-tabs">
    {ink && <i className="mh-ink" aria-hidden="true" style={{ transform: `translate(${ink.x}px, ${ink.y}px)`, width: ink.w, height: ink.h }} />}
    {HUB_TABS.map((id, i) => {
      const n = counts[id];
      const on = id === tab;
      return <button key={id} type="button" role="tab" id={`mh-tab-${id}`} aria-controls="mh-panel" aria-selected={on} tabIndex={on ? 0 : -1}
        data-testid={`mh-tab-${id}`} data-tab={id} onClick={() => onTab(id)} onKeyDown={e => key(e, i)}>
        <span className="mh-tab-icon" aria-hidden="true">{ICON[id]}</span>
        <span className="mh-tab-label">{t(`mh.tab.${id}`)}</span>
        {n !== undefined && n > 0 && <span className="mh-count" data-hot={id === 'proposte'} data-testid={`mh-count-${id}`}>{n > 999 ? '999+' : n}</span>}
      </button>;
    })}
  </div></div>;
}

/** Idee in the hub: the brain page inside its own `.bx` scope, its "Discuti" through the app's Orchestrator. */
function IdeasTab({ rest }: { rest: string | null }) {
  return <div className="bx mh-bx"><DiscussContext.Provider value={brainBridge}>
    <Idee arg={rest ?? undefined} embedded nav={target => goTarget(target)} />
    {/* the ideas' themes close the tab (once Dashboard → Temi) */}
    <section className="bx-section mh-idee-themes"><ThemesPanel kind="ideas" /></section>
  </DiscussContext.Provider><Toaster /></div>;
}

function TabContent({ tab, rest }: { tab: HubTab; rest: string | null }) {
  switch (tab) {
    case 'proposte': return <div className="mh-deck"><ProposalsDeck /></div>;
    case 'approvate': return <ApprovedTab />;
    case 'skill': return <SkillsPage />;
    case 'regole': return <RulesPage />;
    case 'idee': return <IdeasTab rest={rest} />;
    case 'file': return <><MemoryBrowser /><MaintenancePanel kinds={['memory']} testId="bm-maint-memory" /></>;
  }
}

/** Tabs that work with no brain folder chosen: the deck, the brain's server pages and the skills in ~/.claude/skills. */
const NO_BRAIN_OK: ReadonlySet<HubTab> = new Set(['proposte', 'skill', 'idee']);

export function MemoryPage() {
  const { state, error } = useBrainModel();
  const arg = ui.use(s => s.pageArg);
  const { tab, rest } = useMemo(() => parseHubArg(arg), [arg]);
  // a tab change is a place of its own (back / forward, links); within a tab, its own arg stays as it is
  const onTab = (next: HubTab) => { if (next !== tab) go({ page: 'memoria', arg: hubArg(next) }); };
  // scrolled down (the tab bar stuck on top), a new tab starts from its own top, right under the bar
  const panel = useRef<HTMLElement>(null);
  const shown = useRef(tab);
  useEffect(() => {
    if (shown.current === tab) return;
    shown.current = tab;
    const el = panel.current;
    const bar = el?.previousElementSibling;
    const frame = el?.closest('.bx-scroll');
    if (!el || !bar || !frame) return;
    const gap = el.getBoundingClientRect().top - bar.getBoundingClientRect().bottom;
    if (gap < 1) frame.scrollTop += gap; // only the hub's own frame scrolls, never the window
  }, [tab]);
  return <div className="bm-page agent-overview mm-page mh-page" data-testid="bm-memory-page" data-tab={tab}>
    <Hero onTab={onTab} />
    {error && <p role="alert">{error}</p>}
    <TabBar tab={tab} onTab={onTab} />
    <section ref={panel} className="mh-panel" role="tabpanel" id="mh-panel" aria-labelledby={`mh-tab-${tab}`} key={tab} data-testid={`mh-panel-${tab}`}>
      {state && !state.root && !NO_BRAIN_OK.has(tab) ? <p className="bm-empty">{t('bm.noBrain')}</p> : <TabContent tab={tab} rest={rest} />}
    </section>
  </div>;
}
