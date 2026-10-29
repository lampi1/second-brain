// "Memoria" (G Y, ADR 0077, 0122): the one hub of what the brain holds. On top, alive: the day's headline (SPEC 18, it
// was the Dashboard's), the live counters (proposals waiting, agents at work, agents waiting for you, changes of the
// last 24 hours, lines in memory; each eases to its new value) and the latest changes as they happen, then the one
// «Manutenzione» button. Below, a tab bar (pills with a count each, arrows / Home / End, the page arg "memoria/<tab>"
// so a link opens a tab: lib/memory-hub.ts): Proposte (ProposalsDeck.tsx), Approvate (ApprovedTab.tsx: everything in
// the brain now, deleted in one click with Annulla), Skill (SkillsPage.tsx), Regole (RulesPage.tsx), Script & Query
// (brain/pages/Script.tsx + QueriesTab.tsx), Idee (brain/pages/Idee.tsx: yours and the AI's, «Rispolvera»), File (the
// memory cards below: knowledge, what happened with the error log, the agents' memories), Apprendimento
// (LearningPage.tsx) and Statistiche (MemoryInsights.tsx). The old Skill, Regole, Script, Idee, Apprendimento and
// Dashboard pages land here (actions.ts go()). Memory never travels with an exported agent. Rendered by App.tsx
// PageFrame for 'memoria'. Styles: styles/memory-hub.css (mh-*), memory.css (mm-*).
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import type { BrainChange, ErrorEntry, MemoryFile, MemoryStats } from '@shared/brain-model';
import { brainBridge, go, goTarget, openFileViewer } from '../../actions';
import { locale, t, type TextKey } from '../../i18n';
import { useBrainModel } from '../../store/brain-model';
import { useApp } from '../../store/store';
import { ui } from '../../store/ui';
import { memorySections } from '../../lib/brain-model-view';
import { brainFile, lineParts, memoryEmpty, shortDay } from '../../lib/memory-view';
import { HUB_TABS, hubArg, parseHubArg, type HubTab } from '../../lib/memory-hub';
import { useProposalCount } from '../../lib/proposals';
import { now as clockNow } from '../../lib/clock';
import { useBrain } from '../../brain/api';
import { normScripts, normTables } from '../../brain/types';
import { Toaster } from '../../brain/components/ui';
import { DiscussContext } from '../../brain/components/Discuss';
import { HeadlineLine, useHeadline } from '../../brain/pages/HomeHeadline';
import { filterOf, Idee } from '../../brain/pages/Idee';
import { PulseBoard } from '../ContextPulse';
import { ThemesPanel } from '../../dashboard/Themes';
import { Script } from '../../brain/pages/Script';
import { useCountUp } from '../../dashboard/parts';
import { IconBolt, IconCheck, IconChart, IconFile, IconLightbulb, IconShield, IconSparkle, IconTarget, IconTerminal } from '../Icons';
import { SkillsPage } from '../SkillsPage';
import { MaintenancePanel, when } from './MaintenancePanel';
import { MaintenanceButton } from './MaintenanceButton';
import { InlineMd, MemoryInsights, OpenFile } from './MemoryInsights';
import { RulesPage } from './RulesPage';
import { LearningPage } from './LearningPage';
import { ApprovedTab, useApprovedCount } from './ApprovedTab';
import { ProposalsDeck } from './ProposalsDeck';
import { QueriesTab } from './QueriesTab';
import '../../styles/agent-catalog.css';
import '../../styles/brain-model.css';
import '../../styles/memory.css';
import '../../styles/memory-hub.css';

const GROUPS = ['Clienti', 'Ambienti', 'Persone', 'Riferimenti'] as const;
const groupLabel = (g: string) => ((GROUPS as readonly string[]).includes(g) ? t(`bm.mem.group.${g as (typeof GROUPS)[number]}`) : g);
const kindLabel = (m: MemoryFile) => (m.kind === 'knowledge' ? groupLabel(m.group) : m.kind === 'agent' ? m.group : t(`bm.mem.kind.${m.kind}`));
const num = (n: number) => Math.round(n).toLocaleString(locale());
const DAY = 24 * 3600e3;

function MemoryCard({ m, index }: { m: MemoryFile; index: number }) {
  const open = useContext(OpenFile);
  const lines = m.previewMd ?? m.preview;
  return <article className="catalog-card mm-card" data-kind={m.kind === 'agent' ? 'agent' : 'memory'} data-mkind={m.kind} data-testid={`bm-mem-${m.file}`} style={{ '--row-index': Math.min(index, 8) } as CSSProperties}>
    <header className="bm-card-head">
      <div><h3><button type="button" className="mm-card-title" onClick={() => open(m.file)}>{m.title}</button></h3><p className="bm-card-sub" title={m.file}>{m.file}</p></div>
      <span className="bm-badges"><span className="bm-badge" data-tone={m.kind === 'agent' ? 'violet' : m.kind === 'shared' ? 'green' : 'blue'}>{kindLabel(m)}</span></span>
    </header>
    {lines.length > 0 && <ul className="mm-lines">{lines.map((p, i) => {
      const { date, text } = lineParts(p);
      return <li key={i}>{date && <time dateTime={date}>{shortDay(date, locale())}</time>}<InlineMd text={text} /></li>;
    })}</ul>}
    <footer className="bm-card-foot">
      <span>{t('bm.mem.entries', { n: m.entries })}{m.changedAt ? ` · ${t('bm.changed', { at: when(m.changedAt) })}` : ''}</span>
      <span className="sp" />
      <button type="button" className="btn btn-ghost btn-s mm-open" onClick={() => open(m.file)} data-testid="mm-open"><IconFile /> {t('mm.openFile')}</button>
    </footer>
  </article>;
}

function Section({ id, title, lead, files, empty, children }: { id: 'knowledge' | 'happened' | 'agents'; title: string; lead: string; files: MemoryFile[]; empty: string; children?: ReactNode }) {
  return <section className="bm-section" aria-labelledby={`bm-mem-${id}`} data-testid={`bm-mem-section-${id}`}>
    <header><div><h3 id={`bm-mem-${id}`}>{title}</h3><p>{lead}</p></div></header>
    {files.length ? <div className="catalog-grid">{files.map((m, i) => <MemoryCard key={m.file} m={m} index={i} />)}</div> : <p className="bm-empty">{empty}</p>}
    {children}
  </section>;
}

/** The logged errors (ai-errors.md), newest first, rendered, each with its recurring group and the rule it produced. */
function ErrorLog({ items, groups }: { items: ErrorEntry[]; groups: MemoryStats['errors']['groups'] }) {
  const open = useContext(OpenFile);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(12);
  const count = new Map(groups.map(g => [g.key, g.count]));
  const rows = items.filter(e => `${e.type ?? ''} ${e.area ?? ''} ${e.agent} ${e.text} ${e.rule ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="bm-panel" data-testid="bm-mem-errors">
    <header className="bm-panel-head"><div><h3>{t('bm.mem.errors')}</h3><p>{t('bm.mem.errorsLead')}</p></div>
      <div className="bm-panel-actions">
        <input type="search" className="sk-input" value={query} onChange={e => setQuery(e.target.value)} aria-label={t('bm.mem.errorsFilterLabel')} placeholder={t('bm.mem.errorsFilter')} />
        {items.length > 0 && <button type="button" className="btn btn-ghost btn-s mm-open" onClick={() => open('ai-errors.md')}><IconFile /> {t('mm.openFile')}</button>}
      </div></header>
    {rows.length ? <ul className="bm-changes">{rows.slice(0, limit).map((e, i) => {
      const n = count.get(e.group) ?? 1;
      return <li className="bm-change" key={`${e.date}-${e.time}-${i}`}>
        <div className="bm-change-main">
          <span className="bm-change-meta">{(e.type ?? e.area) && <span className="bm-tag">{e.type ?? e.area}</span>}{e.date ? shortDay(e.date, locale()) : ''}{e.time ? ` ${e.time}` : ''} · {e.agent}{n >= 2 && <span className="mm-again" title={t('mm.timesTitle', { n })}>{t('mm.again', { n })}</span>}</span>
          <p className="bm-change-what"><InlineMd text={e.text} /></p>
          {e.rule && <p className="bm-change-why"><b>{t('mm.rule')}</b> <InlineMd text={e.rule} /></p>}
        </div>
      </li>;
    })}</ul> : <p className="bm-empty">{query ? t('bm.mem.errorsNone') : t('bm.mem.errorsEmpty')}</p>}
    {rows.length > limit && <button type="button" className="link-btn bm-more" onClick={() => setLimit(n => n + 20)}>{t('bm.maint.more', { n: Math.min(20, rows.length - limit) })}</button>}
  </div>;
}

/** A brain with nothing written yet: what the Statistiche tab will show, so it never looks broken. */
function CleanStart() {
  return <section className="mm-clean" data-testid="mm-clean">
    <h2>{t('mm.clean.title')}</h2>
    <p>{t('mm.clean.lead')}</p>
    <ul>{(['lines', 'errors', 'skills', 'facts'] as const).map(k => <li key={k}><b>{t(`mm.clean.${k}`)}</b><span>{t(`mm.clean.${k}Text`)}</span></li>)}</ul>
  </section>;
}

/** The File tab: the memory cards (knowledge, what happened with the error log, the agents' memories) and their changes. */
function MemoryFiles() {
  const { state } = useBrainModel();
  const s = memorySections(state?.memory ?? []);
  const stats = state?.memoryStats;
  const knowledge = [...s.knowledge].sort((a, b) => GROUPS.indexOf(a.group as never) - GROUPS.indexOf(b.group as never) || a.title.localeCompare(b.title));
  return <div className="mh-files">
    <Section id="knowledge" title={t('bm.mem.knowledge')} lead={t('bm.mem.knowledgeLead')} files={knowledge} empty={t('bm.mem.empty.knowledge')} />
    <Section id="happened" title={t('bm.mem.happened')} lead={t('bm.mem.happenedLead')} files={s.happened} empty={t('bm.mem.empty.happened')}><ErrorLog items={stats?.errors.items ?? []} groups={stats?.errors.groups ?? []} /></Section>
    <Section id="agents" title={t('bm.mem.agents')} lead={t('bm.mem.agentsLead')} files={s.agents} empty={t('bm.mem.empty.agents')} />
    <MaintenancePanel kinds={['memory']} testId="bm-maint-memory" />
  </div>;
}

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
const TAB_OF_KIND: Record<BrainChange['kind'], HubTab> = { skill: 'skill', rule: 'regole', memory: 'file', agent: 'apprendimento', script: 'script' };

function Activity({ changes, nowMs }: { changes: BrainChange[]; nowMs: number }) {
  const recent = changes.slice(0, 4);
  return <section className="mh-activity" aria-labelledby="mh-activity-h" data-testid="mh-activity">
    <h2 id="mh-activity-h"><i className="mh-live" aria-hidden="true" />{t('mh.activity')}</h2>
    {recent.length ? <ol aria-live="polite">{recent.map((c, i) => <li key={c.id} style={{ '--i': i } as CSSProperties} data-undone={!!c.rolledBackAt}>
      <button type="button" onClick={() => go({ page: 'memoria', arg: hubArg(TAB_OF_KIND[c.kind]) })} title={c.reason}>
        <span className="bm-tag" data-kind={c.kind}>{t(`bm.kind.${c.kind}`)}</span>
        <span className="mh-activity-what">{c.summary}</span>
        <time dateTime={new Date(c.at).toISOString()}>{ago(c.at, nowMs)}</time>
      </button>
    </li>)}</ol> : <p className="mh-activity-empty">{t('mh.activityEmpty')}</p>}
  </section>;
}

function Hero({ onTab }: { onTab: (tab: HubTab) => void }) {
  const headline = useHeadline();
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
  const lines = state?.memoryStats?.totals.entries;
  return <header className="mh-hero" data-testid="mh-hero">
    <div className="mh-hero-glow" aria-hidden="true" />
    <div className="mh-hero-top">
      <div className="mh-hero-text">
        <span className="mh-eyebrow"><i className="mh-live" aria-hidden="true" />{t('mh.eyebrow')}</span>
        <h1>{t('bm.mem.title')}</h1>
        <HeadlineLine state={headline} />
        <p className="mh-lead">{t('mh.lead')}</p>
      </div>
      <div className="mh-hero-actions"><MaintenanceButton /></div>
    </div>
    <div className="mh-hero-bottom">
      <div className="mh-pulses" role="group" aria-label={t('mh.pulseLabel')}>
        <Pulse k="mh.pulse.proposals" help="mh.pulse.proposalsHelp" n={proposals} tone="amber" onClick={() => onTab('proposte')} testId="mh-pulse-proposals" />
        <Pulse k="mh.pulse.working" help="mh.pulse.workingHelp" n={working} tone="green" testId="mh-pulse-working" />
        <Pulse k="mh.pulse.waiting" help="mh.pulse.waitingHelp" n={waiting} tone="violet" testId="mh-pulse-waiting" />
        <Pulse k="mh.pulse.changes" help="mh.pulse.changesHelp" n={state ? today : undefined} tone="blue" onClick={() => onTab('apprendimento')} testId="mh-pulse-changes" />
        <Pulse k="mh.pulse.lines" help="mh.pulse.linesHelp" n={lines} onClick={() => onTab('file')} testId="mh-pulse-lines" />
      </div>
      <Activity changes={changes} nowMs={nowMs} />
    </div>
  </header>;
}

// ── the tab bar ─────────────────────────────────────────────────────────────────────────────────────────────────────
const ICON: Record<HubTab, ReactNode> = {
  proposte: <IconBolt />, approvate: <IconCheck />, skill: <IconSparkle />, regole: <IconShield />, script: <IconTerminal />,
  idee: <IconLightbulb />, file: <IconFile />, apprendimento: <IconTarget />, statistiche: <IconChart />,
};

function useCounts(): Partial<Record<HubTab, number>> {
  const { state } = useBrainModel();
  const proposals = useProposalCount();
  const approved = useApprovedCount();
  const scripts = useBrain('/api/scripts', normScripts);
  const tables = useBrain('/api/tables', normTables);
  return {
    proposte: proposals, approvate: approved,
    skill: state?.skills.length, regole: state?.rules.length, script: scripts.data?.scripts.filter(s => s.tested.state === 'ok').length, // only working scripts show (Script.tsx)
    idee: tables.data?.ideas.length, file: state?.memory.length,
    apprendimento: state?.changes.filter(c => c.claim).length,
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
  }, [tab, counts.skill, counts.idee, counts.script, counts.approvate]);
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
    {/* the AI's side also shows the Battito's board (once the Dashboard's Spunti); the ideas' themes close the tab (once
        its Temi, ADR 0122) */}
    {filterOf(rest ?? undefined) === 'ia' && <PulseBoard />}
    <section className="bx-section mh-idee-themes"><ThemesPanel kind="ideas" /></section>
  </DiscussContext.Provider><Toaster /></div>;
}

function TabContent({ tab, rest }: { tab: HubTab; rest: string | null }) {
  const { state } = useBrainModel();
  const stats = state?.memoryStats;
  switch (tab) {
    case 'proposte': return <div className="mh-deck"><ProposalsDeck /></div>;
    case 'approvate': return <ApprovedTab />;
    case 'skill': return <SkillsPage />;
    case 'regole': return <RulesPage />;
    case 'script': return <><Script arg={rest ?? undefined} /><QueriesTab /></>;
    case 'idee': return <IdeasTab rest={rest} />;
    case 'file': return <MemoryFiles />;
    case 'apprendimento': return <LearningPage />;
    case 'statistiche': return stats ? (memoryEmpty(stats) ? <CleanStart /> : <MemoryInsights s={stats} />) : <p className="bm-empty">{t('bm.loading')}</p>;
  }
}

/** Tabs that work with no brain folder chosen: the deck, the brain's server pages and the skills in ~/.claude/skills. */
const NO_BRAIN_OK: ReadonlySet<HubTab> = new Set(['proposte', 'skill', 'script', 'idee']);

export function MemoryPage() {
  const { state, error } = useBrainModel();
  const arg = ui.use(s => s.pageArg);
  const { tab, rest } = useMemo(() => parseHubArg(arg), [arg]);
  const root = state?.root ?? null;
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
  return <OpenFile.Provider value={rel => openFileViewer(brainFile(root, rel))}><div className="bm-page agent-overview mm-page mh-page" data-testid="bm-memory-page" data-tab={tab}>
    <Hero onTab={onTab} />
    {error && <p role="alert">{error}</p>}
    <TabBar tab={tab} onTab={onTab} />
    <section ref={panel} className="mh-panel" role="tabpanel" id="mh-panel" aria-labelledby={`mh-tab-${tab}`} key={tab} data-testid={`mh-panel-${tab}`}>
      {state && !state.root && !NO_BRAIN_OK.has(tab) ? <p className="bm-empty">{t('bm.noBrain')}</p> : <TabContent tab={tab} rest={rest} />}
    </section>
  </div></OpenFile.Provider>;
}
