// Live Dashboard: statistics only (ADR 0077), five views of existing app/brain sources, each with a source-preserving
// Orchestrator draft. The brain's notes map moved to the Brain section's Mappa (BrainNotesMap.tsx) and the logged
// errors' lessons ("Cosa abbiamo imparato") to its Memoria page. Mounted by App's PageFrame. No telemetry is fabricated and Discuss never sends a message automatically.
// The header and the tab bar keep the same place on every tab, the map's included (owner, 18/10: no jump when switching);
// buttons follow one hierarchy: primary = the one next step, ghost = secondary, quiet = repeated per-row actions.
// Every tile has a "?" (HelpTip) saying exactly how its number is computed; costs live only under Andamento → Costi
// (#125: the Costi tab is gone, its curious facts moved there); Errori groups recurring errors into explained
// cards (ErrorsTab.tsx, errors.ts) (owner, 2026-10-19: "le statistiche non si capisce nulla").
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isLongChat } from '@shared/context';
import { useApp } from '../store/store';
import { brainBridge } from '../actions';
import { useBrain, type Loaded } from '../brain/api';
import { normCost, normTables } from '../brain/types';
import { costRows } from '../lib/live-costs';
import { locale, t } from '../i18n';
import { formatCost } from '../lib/format';
import { chatName, connections, contextLevel, contextRatio, observedErrors } from './data';
import { Graph } from './Graph';
import { ThemesTab } from './Themes';
import { HeadlineLine, useHeadline } from '../brain/pages/HomeHeadline';
import { HelpTip } from '../components/HelpTip';
import { PulseBoard } from '../components/ContextPulse';
import { ErrorsTab } from './ErrorsTab';
import { now as clockNow } from '../lib/clock';
import './dashboard.css';

const number = (value: number) => new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(value);
const money = (value: number) => formatCost(value);
const tabs = ['agents', 'context', 'errors', 'themes', 'tips'] as const;
type Tab = typeof tabs[number];
const tabName = (tab: Tab) => ({ agents: t('brainText.dash.tab.agents'), context: t('brainText.dash.tab.context'), errors: t('brainText.dash.tab.errors'), themes: t('brainText.dash.tab.themes'), tips: t('brainText.dash.tab.tips') })[tab];
const marks: Record<Tab, string> = { agents: '◎', context: '◫', errors: '△', themes: '❖', tips: '✦' };

type Weight = 'primary' | 'ghost' | 'quiet';
const weightClass: Record<Weight, string> = { primary: 'btn-primary', ghost: 'btn-ghost', quiet: 'btn-subtle' };
export function Discuss({ title, facts, source, weight = 'quiet' }: { title: string; facts: string; source: string; weight?: Weight }) {
  const [missing, setMissing] = useState(false);
  return <><button type="button" className={`btn ${weightClass[weight]} btn-s dash-discuss dash-discuss-${weight}`} aria-label={`${t('brainText.dash.discuss')}: ${title}`} onClick={() => {
    setMissing(!brainBridge.draftToOrchestrator(`${title}\n${t('brainText.dash.source')}: ${source}\n${facts}\n\n${t('brainText.dash.question')}`, () => {}));
  }}><span aria-hidden="true">↗</span> {t('brainText.dash.discuss')}</button>{missing && <span role="status" className="dash-note">{t('brainText.dash.openOrchestrator')}</span>}</>;
}

export function Panel({ title, note, children, facts, source = 'Dashboard' }: { title: string; note?: string; children: ReactNode; facts?: string; source?: string }) {
  return <section className="dash-panel"><header><div><h3>{title}</h3>{note && <p>{note}</p>}</div>{facts !== undefined && <Discuss title={title} facts={facts} source={source} weight="ghost" />}</header>{children}</section>;
}
export function Empty({ children }: { children: ReactNode }) { return <div className="dash-empty">{children}</div>; }
export function Source({ data, name }: { data: Loaded<unknown>; name?: string }) {
  return <div className="dash-source" role="status">{name && `${name} · `}{data.error ? `${t('brainText.dash.stale')}: ${data.error}` : data.loading || data.refreshing ? t('brainText.dash.refreshing') : data.at ? `${t('brainText.dash.updated')} ${new Date(data.at).toLocaleTimeString(locale())}` : t('brainText.dash.waiting')}
    <button type="button" className="btn btn-subtle btn-s dash-refresh" onClick={() => data.reload(true)} disabled={data.loading || data.refreshing}><span aria-hidden="true">↻</span>{t('brainText.dash.refresh')}</button></div>;
}
const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Eases a shown number toward its new value; the final frame is always the exact value. */
function useCountUp(target: number | undefined): number | undefined {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (target === undefined || still()) { from.current = target; setShown(target); return; }
    const start = from.current ?? 0, began = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - began) / 700), eased = 1 - Math.pow(1 - k, 3);
      const value = k === 1 ? target : start + (target - start) * eased;
      from.current = value; setShown(value);
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return shown;
}
function Stat({ label, value, note, n, format, help }: { label: string; value: string; note: string; n?: number; format?: (n: number) => string; help?: string }) {
  const shown = useCountUp(n);
  return <div className="dash-stat"><span className="dash-stat-label">{label}{help && <HelpTip title={label} label={label}>{help}</HelpTip>}</span><strong>{shown !== undefined && format ? format(shown) : value}</strong><small>{note}</small><Discuss title={label} facts={`${value} · ${note}`} source="Dashboard" /></div>;
}
export function Dashboard() {
  const [tab, setTab] = useState<Tab>('agents');
  const headline = useHeadline();
  const tabBar = useRef<HTMLDivElement>(null), [ink, setInk] = useState({ x: 0, w: 0 });
  useLayoutEffect(() => {
    const place = () => { const el = tabBar.current?.querySelector<HTMLElement>('[aria-selected=true]'); if (el) setInk({ x: el.offsetLeft, w: el.offsetWidth }); };
    place(); window.addEventListener('resize', place); return () => window.removeEventListener('resize', place);
  }, [tab]);
  const chatsById = useApp(s => s.chats), items = useApp(s => s.items), usage = useApp(s => s.usage), feed = useApp(s => s.feed);
  const warn = useApp(s => s.settings?.contextWarnTokens ?? 200_000);
  const chats = useMemo(() => Object.values(chatsById), [chatsById]);
  const [tick, setTick] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => { if (!document.hidden) setTick(Date.now()); }, 1500); return () => clearInterval(timer); }, []);
  const costs = useBrain(tab === 'tips' ? '/api/cost?days=7' : null, normCost, { pollMs: 30_000 });
  const tables = useBrain(tab === 'errors' || tab === 'tips' ? '/api/tables' : null, normTables, { pollMs: 30_000 });
  const [selected, setSelected] = useState<string | null>(null);
  const live = chats.filter(c => !c.closedAt && c.state !== 'closed');
  const links = useMemo(() => connections(chats, items), [chats, items]);
  const rows = useMemo(() => costRows(usage, chats), [usage, chats]);
  const errors = useMemo(() => observedErrors(chats, items, feed, t('brainText.dash.turnError')), [chats, items, feed]);
  const long = live.filter(c => isLongChat(c, warn));
  const switchTab = (value: Tab) => { setTab(value); setSelected(null); };
  const activeChat = chats.find(c => c.id === selected);

  return <div className="dashboard bx" data-testid="dashboard">
    <header className="dash-header"><div><span className="dash-eyebrow">{t('brainText.dash.eyebrow')}</span><h1>Dashboard<span className="dash-live-dot" /></h1><HeadlineLine state={headline} /><p>{t('brainText.dash.lead')}</p></div><span className="dash-live-label">{t('brainText.dash.liveLabel')}</span></header>
    <div className="dash-tabs" role="tablist" aria-label="Dashboard" ref={tabBar}><i className="dash-ink" aria-hidden="true" style={{ transform: `translateX(${ink.x}px)`, width: ink.w }} />{tabs.map((id, i) => <button key={id} type="button" role="tab" id={`dash-tab-${id}`} aria-controls={`dash-panel-${id}`} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onClick={() => switchTab(id)} onKeyDown={event => {
      const next = event.key === 'ArrowRight' ? (i + 1) % tabs.length : event.key === 'ArrowLeft' ? (i + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
      if (next !== null) { event.preventDefault(); switchTab(tabs[next]!); document.getElementById(`dash-tab-${tabs[next]}`)?.focus(); }
    }}><span aria-hidden="true">{marks[id]}</span>{tabName(id)}</button>)}</div>
    <div key={tab} className="dash-content" role="tabpanel" id={`dash-panel-${tab}`} aria-labelledby={`dash-tab-${tab}`} tabIndex={0}>
      {tab === 'agents' && <>
        <div className="dash-stats"><Stat label={t('brainText.dash.openAgents')} value={number(live.filter(c => !c.isOrchestrator).length)} n={live.filter(c => !c.isOrchestrator).length} format={number} note={t('brainText.dash.openAgentsNote')} help={t('brainText.dash.openAgentsHelp')} /><Stat label={t('brainText.dash.working')} value={number(live.filter(c => c.state === 'running' || c.state === 'starting').length)} n={live.filter(c => c.state === 'running' || c.state === 'starting').length} format={number} note={t('brainText.dash.workingNote')} help={t('brainText.dash.workingHelp')} /><Stat label={t('brainText.dash.waitingYou')} value={number(live.filter(c => c.state === 'waiting').length)} n={live.filter(c => c.state === 'waiting').length} format={number} note={t('brainText.dash.waitingYouNote')} help={t('brainText.dash.waitingYouHelp')} /></div>
        <Panel title={t('brainText.dash.network')} note={t('brainText.dash.networkNote')} facts={`${live.length} chats; ${links.filter(e => e.at && tick - e.at < 15_000).length} recent connections`} source="chat:list · chat:items">
          {live.length ? <div className="dash-network"><Graph testId="dash-agents-map" label={tabName('agents')} nodes={live.map(c => ({ id: c.id, label: chatName(c), detail: `${c.harness} · ${c.model ?? '—'} · ${c.state}`, central: c.isOrchestrator, active: c.state === 'running' || c.state === 'starting' }))} edges={links.map(e => ({ ...e, active: e.at !== null && tick >= e.at && tick - e.at < 15_000 }))} selected={selected} onSelect={setSelected} />
            <aside className="dash-inspector">{activeChat ? <><span className="dash-eyebrow">{activeChat.isOrchestrator ? 'ORCHESTRATOR' : activeChat.harness}</span><h2>{chatName(activeChat)}</h2><p>{activeChat.model ?? t('brainText.dash.noModel')}</p><span className={`dash-status ${activeChat.state}`}>{activeChat.state}</span><p>{activeChat.lastText || t('brainText.dash.noRecent')}</p><div className="dash-actions"><Discuss title={chatName(activeChat)} facts={`${activeChat.harness}; ${activeChat.model}; ${activeChat.state}\n${activeChat.lastText}`} source={`chat:${activeChat.id}`} weight="primary" /></div></> : <><span className="dash-orbit-icon">◎</span><h2>{t('brainText.dash.follow')}</h2><p>{t('brainText.dash.followBody')}</p></>}</aside></div> : <Empty>{t('brainText.dash.noNetwork')}</Empty>}
        </Panel>
      </>}
      {tab === 'context' && <>
        <div className="dash-stats"><Stat label={t('brainText.dash.aboveThreshold')} value={number(long.length)} n={long.length} format={number} note={t('brainText.dash.aboveThresholdNote')} help={t('brainText.dash.aboveThresholdHelp')} /><Stat label={t('brainText.dash.reported')} value={`${live.filter(c => c.contextTokens !== undefined).length} / ${live.length}`} note={t('brainText.dash.reportedNote')} help={t('brainText.dash.reportedHelp')} /></div>
        <Panel title={t('brainText.dash.room')} note={t('brainText.dash.roomNote')}>
          {live.length ? [...live].sort((a, b) => (contextRatio(b) ?? -1) - (contextRatio(a) ?? -1)).map(c => {
            const ratio = contextRatio(c), level = contextLevel(c, warn), high = level === 'above';
            const value = c.contextTokens === undefined ? t('brainText.dash.notReported') : `${c.contextEstimated ? '≈ ' : ''}${number(c.contextTokens)}${c.contextMaxTokens ? ` / ${number(c.contextMaxTokens)}` : ''}`;
            return <div className={`dash-context-row ${high ? 'warn' : ''}`} key={c.id}><div className="dash-row"><div><b>{chatName(c)}</b><small>{c.harness} · {c.model ?? '—'}{high ? ` · ${t('brainText.dash.overThreshold')}` : ''}</small></div><strong>{value}</strong><Discuss title={chatName(c)} facts={`Context: ${value}; ${ratio === null ? 'window unknown' : `${Math.round(ratio * 100)}%`}; ${level === 'unknown' ? 'threshold status unknown (context not reported)' : `${level} configured threshold`}`} source="chat:list · contextTokens / contextMaxTokens" /></div>{ratio !== null && <div className="dash-track" role="meter" aria-label={`${chatName(c)}: ${t('brainText.dash.context')}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(ratio * 100))}><i style={{ width: `${Math.min(100, ratio * 100)}%` }} /></div>}</div>;
          }) : <Empty>{t('brainText.dash.noChats')}</Empty>}
        </Panel>
      </>}
      {tab === 'errors' && <ErrorsTab ui={{ Panel, Empty, Source, Stat, Discuss }} tables={tables} errors={errors} now={clockNow()} />}
      {tab === 'themes' && <ThemesTab ui={{ Panel, Empty, Source }} />}
      {tab === 'tips' && <>
        <div className="dash-tip-intro"><span>✦</span><div><h2>{t('brainText.dash.signals')}</h2><p>{t('brainText.dash.signalsBody')}</p></div></div>
        <Source data={costs} name={t('brainText.dash.costs')} /><Source data={tables} name="ai-errors.md" />
        <div className="dash-tip-grid">
          {long.map(c => <Panel key={c.id} title={chatName(c)} note={t('brainText.dash.contextAbove')} source={`chat:${c.id}`} facts={`${number(c.contextTokens ?? 0)} context tokens; ${c.contextMaxTokens ?? 'unknown'} window; estimated=${!!c.contextEstimated}`}><p>{t('brainText.dash.contextAboveBody')}</p></Panel>)}
          {rows[0] && <Panel title={t('brainText.dash.topCost')} note={chatName(rows[0])} source="costRows · mixed periods, see Costs" facts={`${chatName(rows[0])}: ${rows[0].approx ? '≈ ' : ''}${money(rows[0].usd)}${rows[0].unpriced ? ' + unpriced' : ''}; mixed source periods, not an efficiency ranking`}><p>{t('brainText.dash.topCostBody')}</p></Panel>}
          {(costs.data?.advice ?? []).map((a, i) => <Panel key={i} title={a.text} note={t('brainText.dash.costTip')} source="/api/cost?days=7" facts={`${a.text}: ${money(a.usd)} estimated saving`}><p>{t('brainText.dash.saving')}: {money(a.usd)}</p></Panel>)}
          {(tables.data?.recurrence.totals ?? []).filter(([, n]) => n > 1).map(([type, n]) => <Panel key={type} title={type} note={t('brainText.dash.recurring')} source="ai-errors.md · recurrence" facts={`${type}: ${n} recorded occurrences`}><p>{number(n)} {t('brainText.dash.recurringBody')}</p></Panel>)}
        </div>
        {/* the Battito's board (at most 3 cards, ADR 0102) under the app's own signals */}
        <PulseBoard />
        {!long.length && !rows.length && !costs.data?.advice.length && !(tables.data?.recurrence.totals ?? []).some(([, n]) => n > 1) && <Empty>{t('brainText.dash.noSignals')}</Empty>}
      </>}
    </div>
  </div>;
}
