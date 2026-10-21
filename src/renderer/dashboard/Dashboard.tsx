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
import { lang, locale } from '../i18n';
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

const copy = (it: string, en: string) => lang() === 'en' ? en : it;
const number = (value: number) => new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(value);
const money = (value: number) => formatCost(value);
const tabs = ['agents', 'context', 'errors', 'themes', 'tips'] as const;
type Tab = typeof tabs[number];
const tabName = (tab: Tab) => ({ agents: copy('Mappa agenti', 'Agents map'), context: copy('Token e contesto', 'Tokens & context'), errors: copy('Errori', 'Errors'), themes: copy('Temi', 'Themes'), tips: copy('Spunti', 'Tips') })[tab];
const marks: Record<Tab, string> = { agents: '◎', context: '◫', errors: '△', themes: '❖', tips: '✦' };

type Weight = 'primary' | 'ghost' | 'quiet';
const weightClass: Record<Weight, string> = { primary: 'btn-primary', ghost: 'btn-ghost', quiet: 'btn-subtle' };
export function Discuss({ title, facts, source, weight = 'quiet' }: { title: string; facts: string; source: string; weight?: Weight }) {
  const [missing, setMissing] = useState(false);
  return <><button type="button" className={`btn ${weightClass[weight]} btn-s dash-discuss dash-discuss-${weight}`} aria-label={`${copy('Discuti', 'Discuss')}: ${title}`} onClick={() => {
    setMissing(!brainBridge.draftToOrchestrator(`${title}\n${copy('Fonte', 'Source')}: ${source}\n${facts}\n\n${copy('Analizziamo questi dati e il prossimo passo?', 'Can we analyse these data and the next step?')}`, () => {}));
  }}><span aria-hidden="true">↗</span> {copy('Discuti', 'Discuss')}</button>{missing && <span role="status" className="dash-note">{copy('Apri un Orchestrator per discutere questi dati.', 'Open an Orchestrator to discuss these data.')}</span>}</>;
}

export function Panel({ title, note, children, facts, source = 'Dashboard' }: { title: string; note?: string; children: ReactNode; facts?: string; source?: string }) {
  return <section className="dash-panel"><header><div><h3>{title}</h3>{note && <p>{note}</p>}</div>{facts !== undefined && <Discuss title={title} facts={facts} source={source} weight="ghost" />}</header>{children}</section>;
}
export function Empty({ children }: { children: ReactNode }) { return <div className="dash-empty">{children}</div>; }
export function Source({ data, name }: { data: Loaded<unknown>; name?: string }) {
  return <div className="dash-source" role="status">{name && `${name} · `}{data.error ? `${copy('Dati non aggiornati', 'Data unavailable or stale')}: ${data.error}` : data.loading || data.refreshing ? copy('Aggiornamento…', 'Refreshing…') : data.at ? `${copy('Aggiornato', 'Updated')} ${new Date(data.at).toLocaleTimeString(locale())}` : copy('In attesa dei dati', 'Waiting for data')}
    <button type="button" className="btn btn-subtle btn-s dash-refresh" onClick={() => data.reload(true)} disabled={data.loading || data.refreshing}><span aria-hidden="true">↻</span>{copy('Aggiorna', 'Refresh')}</button></div>;
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
  const errors = useMemo(() => observedErrors(chats, items, feed, copy('Turno terminato con un errore', 'Turn ended with an error')), [chats, items, feed]);
  const long = live.filter(c => isLongChat(c, warn));
  const switchTab = (value: Tab) => { setTab(value); setSelected(null); };
  const activeChat = chats.find(c => c.id === selected);

  return <div className="dashboard bx" data-testid="dashboard">
    <header className="dash-header"><div><span className="dash-eyebrow">{copy('IL TUO SISTEMA, IN DIRETTA', 'YOUR SYSTEM, LIVE')}</span><h1>Dashboard<span className="dash-live-dot" /></h1><HeadlineLine state={headline} /><p>{copy('Ogni connessione racconta il lavoro. Ogni dato apre una conversazione.', 'Every connection tells a story. Every signal starts a conversation.')}</p></div><span className="dash-live-label">{copy('Dati reali · aggiornamento live', 'Real data · live updates')}</span></header>
    <div className="dash-tabs" role="tablist" aria-label="Dashboard" ref={tabBar}><i className="dash-ink" aria-hidden="true" style={{ transform: `translateX(${ink.x}px)`, width: ink.w }} />{tabs.map((id, i) => <button key={id} type="button" role="tab" id={`dash-tab-${id}`} aria-controls={`dash-panel-${id}`} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onClick={() => switchTab(id)} onKeyDown={event => {
      const next = event.key === 'ArrowRight' ? (i + 1) % tabs.length : event.key === 'ArrowLeft' ? (i + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
      if (next !== null) { event.preventDefault(); switchTab(tabs[next]!); document.getElementById(`dash-tab-${tabs[next]}`)?.focus(); }
    }}><span aria-hidden="true">{marks[id]}</span>{tabName(id)}</button>)}</div>
    <div key={tab} className="dash-content" role="tabpanel" id={`dash-panel-${tab}`} aria-labelledby={`dash-tab-${tab}`} tabIndex={0}>
      {tab === 'agents' && <>
        <div className="dash-stats"><Stat label={copy('Agenti aperti', 'Open agents')} value={number(live.filter(c => !c.isOrchestrator).length)} n={live.filter(c => !c.isOrchestrator).length} format={number} note={copy('Chat aperte, Orchestrator escluso', 'Open chats, Orchestrator excluded')} help={copy('Le chat di lavoro aperte in questo momento (non chiuse né archiviate), senza contare gli Orchestrator.', 'The work chats open right now (not closed or archived), the Orchestrators not counted.')} /><Stat label={copy('Al lavoro', 'Working')} value={number(live.filter(c => c.state === 'running' || c.state === 'starting').length)} n={live.filter(c => c.state === 'running' || c.state === 'starting').length} format={number} note={copy('Stato live delle chat', 'Live chat state')} help={copy('Le chat aperte che stanno avviandosi o generando una risposta adesso; si aggiorna in diretta.', 'The open chats starting or generating an answer right now; updated live.')} /><Stat label={copy('Aspettano te', 'Waiting for you')} value={number(live.filter(c => c.state === 'waiting').length)} n={live.filter(c => c.state === 'waiting').length} format={number} note={copy('Chat con richieste aperte', 'Chats with pending requests')} help={copy('Le chat aperte ferme su una tua domanda, un permesso o una decisione: finché non rispondi non vanno avanti.', 'The open chats stopped on a question, a permission or a decision of yours: they wait until you answer.')} /></div>
        <Panel title={copy('Una rete, un Orchestrator', 'One network, one Orchestrator')} note={copy('Le linee pulsano per 15 secondi dopo una comunicazione osservata. Seleziona un nodo.', 'Edges pulse for 15 seconds after an observed communication. Select a node.')} facts={`${live.length} chats; ${links.filter(e => e.at && tick - e.at < 15_000).length} recent connections`} source="chat:list · chat:items">
          {live.length ? <div className="dash-network"><Graph testId="dash-agents-map" label={tabName('agents')} nodes={live.map(c => ({ id: c.id, label: chatName(c), detail: `${c.harness} · ${c.model ?? '—'} · ${c.state}`, central: c.isOrchestrator, active: c.state === 'running' || c.state === 'starting' }))} edges={links.map(e => ({ ...e, active: e.at !== null && tick >= e.at && tick - e.at < 15_000 }))} selected={selected} onSelect={setSelected} />
            <aside className="dash-inspector">{activeChat ? <><span className="dash-eyebrow">{activeChat.isOrchestrator ? 'ORCHESTRATOR' : activeChat.harness}</span><h2>{chatName(activeChat)}</h2><p>{activeChat.model ?? copy('Modello non riportato', 'Model not reported')}</p><span className={`dash-status ${activeChat.state}`}>{activeChat.state}</span><p>{activeChat.lastText || copy('Nessun messaggio recente.', 'No recent message.')}</p><div className="dash-actions"><Discuss title={chatName(activeChat)} facts={`${activeChat.harness}; ${activeChat.model}; ${activeChat.state}\n${activeChat.lastText}`} source={`chat:${activeChat.id}`} weight="primary" /></div></> : <><span className="dash-orbit-icon">◎</span><h2>{copy('Segui il flusso', 'Follow the flow')}</h2><p>{copy('Scegli un agente per vedere modello, stato e ultima attività.', 'Choose an agent to inspect its model, state and latest activity.')}</p></>}</aside></div> : <Empty>{copy('La rete apparirà quando aprirai le prime chat.', 'The network will appear when you open your first chats.')}</Empty>}
        </Panel>
      </>}
      {tab === 'context' && <>
        <div className="dash-stats"><Stat label={copy('Contesti sopra soglia', 'Contexts above threshold')} value={number(long.length)} n={long.length} format={number} note={copy('Soglie configurate, chat aperte', 'Configured thresholds, open chats')} help={copy('Le chat aperte il cui contesto attuale supera la soglia di Impostazioni («chat lunga»): oltre, il modello legge peggio e ogni turno costa di più.', 'The open chats whose current context is above the threshold in Settings ("long chat"): beyond it the model reads worse and every turn costs more.')} /><Stat label={copy('Contesto riportato', 'Context reported')} value={`${live.filter(c => c.contextTokens !== undefined).length} / ${live.length}`} note={copy('Chat aperte con una misura disponibile', 'Open chats with an available measurement')} help={copy('Quante chat aperte riportano la dimensione del contesto: non tutti i motori la danno. Una chat senza misura resta «non riportato», mai zero.', 'How many open chats report their context size: not every engine gives it. A chat without a measure stays "not reported", never zero.')} /></div>
        <Panel title={copy('Spazio per ragionare', 'Room to think')} note={copy('Contesto attuale di ogni chat, non token cumulativi consumati. ≈ indica una stima.', 'Current context per chat, not cumulative tokens used. ≈ indicates an estimate.')}>
          {live.length ? [...live].sort((a, b) => (contextRatio(b) ?? -1) - (contextRatio(a) ?? -1)).map(c => {
            const ratio = contextRatio(c), level = contextLevel(c, warn), high = level === 'above';
            const value = c.contextTokens === undefined ? copy('Non riportato', 'Not reported') : `${c.contextEstimated ? '≈ ' : ''}${number(c.contextTokens)}${c.contextMaxTokens ? ` / ${number(c.contextMaxTokens)}` : ''}`;
            return <div className={`dash-context-row ${high ? 'warn' : ''}`} key={c.id}><div className="dash-row"><div><b>{chatName(c)}</b><small>{c.harness} · {c.model ?? '—'}{high ? ` · ${copy('sopra soglia', 'above threshold')}` : ''}</small></div><strong>{value}</strong><Discuss title={chatName(c)} facts={`Context: ${value}; ${ratio === null ? 'window unknown' : `${Math.round(ratio * 100)}%`}; ${level === 'unknown' ? 'threshold status unknown (context not reported)' : `${level} configured threshold`}`} source="chat:list · contextTokens / contextMaxTokens" /></div>{ratio !== null && <div className="dash-track" role="meter" aria-label={`${chatName(c)}: ${copy('contesto', 'context')}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(ratio * 100))}><i style={{ width: `${Math.min(100, ratio * 100)}%` }} /></div>}</div>;
          }) : <Empty>{copy('Nessuna chat aperta: il contesto appare qui quando ne parte una.', 'No open chat: its context shows here once one starts.')}</Empty>}
        </Panel>
      </>}
      {tab === 'errors' && <ErrorsTab ui={{ Panel, Empty, Source, Stat, Discuss }} tables={tables} errors={errors} now={clockNow()} />}
      {tab === 'themes' && <ThemesTab ui={{ Panel, Empty, Source }} />}
      {tab === 'tips' && <>
        <div className="dash-tip-intro"><span>✦</span><div><h2>{copy('Segnali che meritano attenzione', 'Signals worth your attention')}</h2><p>{copy('Calcolati dai tuoi dati. Porta il contesto all’Orchestrator e scegli il prossimo passo.', 'Computed from your data. Bring the context to the Orchestrator and choose the next step.')}</p></div></div>
        <Source data={costs} name={copy('Costi', 'Costs')} /><Source data={tables} name="ai-errors.md" />
        <div className="dash-tip-grid">
          {long.map(c => <Panel key={c.id} title={chatName(c)} note={copy('Contesto sopra soglia', 'Context above threshold')} source={`chat:${c.id}`} facts={`${number(c.contextTokens ?? 0)} context tokens; ${c.contextMaxTokens ?? 'unknown'} window; estimated=${!!c.contextEstimated}`}><p>{copy('Controlla quanto spazio resta prima di avviare altro lavoro.', 'Check remaining context before starting more work.')}</p></Panel>)}
          {rows[0] && <Panel title={copy('Il costo più alto tra le righe disponibili', 'Highest cost among available rows')} note={chatName(rows[0])} source="costRows · mixed periods, see Costs" facts={`${chatName(rows[0])}: ${rows[0].approx ? '≈ ' : ''}${money(rows[0].usd)}${rows[0].unpriced ? ' + unpriced' : ''}; mixed source periods, not an efficiency ranking`}><p>{copy('Apri i costi per confrontare periodo, motore e lavoro svolto.', 'Open Costs to compare period, engine and work delivered.')}</p></Panel>}
          {(costs.data?.advice ?? []).map((a, i) => <Panel key={i} title={a.text} note={copy('Suggerimento dalla fonte costi', 'Suggestion from cost source')} source="/api/cost?days=7" facts={`${a.text}: ${money(a.usd)} estimated saving`}><p>{copy('Risparmio stimato', 'Estimated saving')}: {money(a.usd)}</p></Panel>)}
          {(tables.data?.recurrence.totals ?? []).filter(([, n]) => n > 1).map(([type, n]) => <Panel key={type} title={type} note={copy('Errore ricorrente', 'Recurring error')} source="ai-errors.md · recurrence" facts={`${type}: ${n} recorded occurrences`}><p>{number(n)} {copy('occorrenze registrate. Esamina la regola con l’Orchestrator.', 'recorded occurrences. Review the rule with the Orchestrator.')}</p></Panel>)}
        </div>
        {/* the Battito's board (at most 3 cards, ADR 0102) under the app's own signals */}
        <PulseBoard />
        {!long.length && !rows.length && !costs.data?.advice.length && !(tables.data?.recurrence.totals ?? []).some(([, n]) => n > 1) && <Empty>{copy('Nessun segnale azionabile nei dati disponibili. Gli spunti compariranno qui.', 'No actionable signals in available data. Insights will appear here.')}</Empty>}
      </>}
    </div>
  </div>;
}
