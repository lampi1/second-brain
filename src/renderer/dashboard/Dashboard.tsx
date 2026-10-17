// Live Dashboard: seven views of existing app/brain sources, each with a source-preserving Orchestrator draft.
// Mounted by App's PageFrame. No telemetry is fabricated and Discuss never sends a message automatically.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isLongChat } from '@shared/context';
import { useApp } from '../store/store';
import { brainBridge, goTarget } from '../actions';
import { useBrain, type Loaded } from '../brain/api';
import { normCost, normMap, normTables } from '../brain/types';
import { costRows, liveTotal } from '../lib/live-costs';
import { lang, locale } from '../i18n';
import { chatName, connections, contextLevel, contextRatio, cursorCoverage, neighbourhood, observedErrors } from './data';
import { Graph } from './Graph';
import { ThemesTab } from './Themes';
import './dashboard.css';

const copy = (it: string, en: string) => lang() === 'en' ? en : it;
const number = (value: number) => new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(value);
const money = (value: number) => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
const tabs = ['agents', 'brain', 'costs', 'context', 'errors', 'themes', 'tips'] as const;
type Tab = typeof tabs[number];
const tabName = (tab: Tab) => ({ agents: copy('Mappa agenti', 'Agents map'), brain: copy('Mappa brain', 'Brain map'), costs: copy('Costi', 'Costs'), context: copy('Token e contesto', 'Tokens & context'), errors: copy('Errori', 'Errors'), themes: copy('Temi', 'Themes'), tips: copy('Spunti', 'Tips') })[tab];
const marks: Record<Tab, string> = { agents: '◎', brain: '⌘', costs: '↗', context: '◫', errors: '△', themes: '❖', tips: '✦' };

function Discuss({ title, facts, source }: { title: string; facts: string; source: string }) {
  const [missing, setMissing] = useState(false);
  return <><button type="button" className="btn btn-ghost btn-s dash-discuss" aria-label={`${copy('Discutine', 'Discuss')}: ${title}`} onClick={() => {
    setMissing(!brainBridge.draftToRegia(`${title}\n${copy('Fonte', 'Source')}: ${source}\n${facts}\n\n${copy('Analizziamo questi dati e il prossimo passo?', 'Can we analyse these data and the next step?')}`, () => {}));
  }}><span aria-hidden="true">↗</span> {copy('Discutine', 'Discuss')}</button>{missing && <span role="status" className="dash-note">{copy('Apri un Orchestrator per discutere questi dati.', 'Open an Orchestrator to discuss these data.')}</span>}</>;
}

function Panel({ title, note, children, facts, source = 'Dashboard' }: { title: string; note?: string; children: ReactNode; facts?: string; source?: string }) {
  return <section className="dash-panel"><header><div><h3>{title}</h3>{note && <p>{note}</p>}</div>{facts !== undefined && <Discuss title={title} facts={facts} source={source} />}</header>{children}</section>;
}
function Empty({ children }: { children: ReactNode }) { return <div className="dash-empty">{children}</div>; }
function Source({ data, name }: { data: Loaded<unknown>; name?: string }) {
  return <div className="dash-source" role="status">{name && `${name} · `}{data.error ? `${copy('Dati non aggiornati', 'Data unavailable or stale')}: ${data.error}` : data.loading || data.refreshing ? copy('Aggiornamento…', 'Refreshing…') : data.at ? `${copy('Aggiornato', 'Updated')} ${new Date(data.at).toLocaleTimeString(locale())}` : copy('In attesa dei dati', 'Waiting for data')}
    <button type="button" className="btn btn-ghost btn-s" onClick={() => data.reload(true)}>{copy('Aggiorna', 'Refresh')}</button></div>;
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
function Stat({ label, value, note, n, format }: { label: string; value: string; note: string; n?: number; format?: (n: number) => string }) {
  const shown = useCountUp(n);
  return <div className="dash-stat"><span>{label}</span><strong>{shown !== undefined && format ? format(shown) : value}</strong><small>{note}</small><Discuss title={label} facts={`${value} · ${note}`} source="Dashboard" /></div>;
}
interface BarRow { label: string; value: number; approx?: boolean; unpriced?: boolean }
function Bars({ title, rows, format = money, source }: { title: string; rows: BarRow[]; format?: (n: number) => string; source: string }) {
  const max = Math.max(1, ...rows.map(r => r.value));
  const shown = (r: BarRow, unpriced: string) => `${r.approx ? '≈ ' : ''}${format(r.value)}${r.unpriced ? ` + ${unpriced}` : ''}`;
  return <Panel title={title} source={source} facts={rows.map(r => `${r.label}: ${shown(r, 'unpriced')}`).join('\n')}>
    {rows.length ? <div className="dash-bars">{rows.map((row, i) => <div className="dash-bar-row" key={`${row.label}-${i}`}><div><span>{row.label}</span><b>{shown(row, copy('non quotato', 'unpriced'))}</b><Discuss title={row.label} facts={shown(row, 'unpriced')} source={source} /></div><div className="dash-track"><i style={{ width: `${row.value / max * 100}%` }} /></div></div>)}</div> : <Empty>{copy('Nessun dato disponibile per questa fonte.', 'No data available from this source.')}</Empty>}
  </Panel>;
}

export function Dashboard() {
  const [tab, setTab] = useState<Tab>('agents');
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
  const map = useBrain(tab === 'brain' ? '/api/map' : null, normMap, { pollMs: 30_000 });
  const costs = useBrain(tab === 'costs' || tab === 'tips' ? '/api/cost?days=7' : null, normCost, { pollMs: 30_000 });
  const tables = useBrain(tab === 'errors' || tab === 'tips' ? '/api/tables' : null, normTables, { pollMs: 30_000 });
  const [query, setQuery] = useState(''), [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [errorQuery, setErrorQuery] = useState('');
  const live = chats.filter(c => !c.closedAt && c.state !== 'closed');
  const links = useMemo(() => connections(chats, items), [chats, items]);
  const rows = useMemo(() => costRows(usage, chats), [usage, chats]);
  const total = liveTotal(usage, chats);
  const errors = useMemo(() => observedErrors(chats, items, feed, copy('Turno terminato con un errore', 'Turn ended with an error')), [chats, items, feed]);
  const long = live.filter(c => isLongChat(c, warn));
  const switchTab = (value: Tab) => { setTab(value); setSelected(null); setQuery(''); setFocus(null); };
  const activeChat = chats.find(c => c.id === selected);
  const brainNodes = useMemo(() => neighbourhood(map.data?.nodes ?? [], map.data?.edges ?? [], query, focus), [map.data, query, focus]);
  const brainNode = map.data?.nodes.find(n => n.id === selected);
  const errorRows = (tables.data?.errors ?? []).filter(e => `${e.tipo} ${e.area} ${e.chi} ${e.vero}`.toLowerCase().includes(errorQuery.toLowerCase()));
  const groups = new Map<string, BarRow>();
  for (const row of rows) {
    const g = groups.get(row.harness) ?? { label: row.harness, value: 0 };
    groups.set(row.harness, { label: g.label, value: g.value + row.usd, approx: g.approx || row.approx, unpriced: g.unpriced || !!row.unpriced });
  }
  const untracked = [...new Set(chats.map(c => c.harness))].filter(h => h !== 'kimi').sort();
  const cursor = costs.data?.cursor ?? null, cover = cursor && costs.data ? cursorCoverage(cursor, costs.data.to) : null;
  const when = (value?: string) => { const at = value ? new Date(value) : null; return !value ? copy('sconosciuto', 'unknown') : at && !Number.isNaN(at.getTime()) ? at.toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' }) : value; };
  const errorDays = new Map<string, number>();
  for (const error of tables.data?.errors ?? []) if (error.data) errorDays.set(error.data, (errorDays.get(error.data) ?? 0) + 1);

  return <div className="dashboard" data-testid="dashboard">
    <header className="dash-header"><div><span className="dash-eyebrow">{copy('IL TUO SISTEMA, IN DIRETTA', 'YOUR SYSTEM, LIVE')}</span><h1>Dashboard<span className="dash-live-dot" /></h1><p>{copy('Ogni connessione racconta il lavoro. Ogni dato apre una conversazione.', 'Every connection tells a story. Every signal starts a conversation.')}</p></div><span className="dash-live-label">{copy('Dati reali · aggiornamento live', 'Real data · live updates')}</span></header>
    <div className="dash-tabs" role="tablist" aria-label="Dashboard" ref={tabBar}><i className="dash-ink" aria-hidden="true" style={{ transform: `translateX(${ink.x}px)`, width: ink.w }} />{tabs.map((id, i) => <button key={id} type="button" role="tab" id={`dash-tab-${id}`} aria-controls={`dash-panel-${id}`} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onClick={() => switchTab(id)} onKeyDown={event => {
      const next = event.key === 'ArrowRight' ? (i + 1) % tabs.length : event.key === 'ArrowLeft' ? (i + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
      if (next !== null) { event.preventDefault(); switchTab(tabs[next]!); document.getElementById(`dash-tab-${tabs[next]}`)?.focus(); }
    }}><span aria-hidden="true">{marks[id]}</span>{tabName(id)}</button>)}</div>
    <div key={tab} className="dash-content" role="tabpanel" id={`dash-panel-${tab}`} aria-labelledby={`dash-tab-${tab}`} tabIndex={0}>
      {tab === 'agents' && <>
        <div className="dash-stats"><Stat label={copy('Agenti aperti', 'Open agents')} value={number(live.filter(c => !c.isRegia).length)} n={live.filter(c => !c.isRegia).length} format={number} note={copy('Chat aperte, Orchestrator escluso', 'Open chats, Orchestrator excluded')} /><Stat label={copy('Al lavoro', 'Working')} value={number(live.filter(c => c.state === 'running' || c.state === 'starting').length)} n={live.filter(c => c.state === 'running' || c.state === 'starting').length} format={number} note={copy('Stato live delle chat', 'Live chat state')} /><Stat label={copy('Aspettano te', 'Waiting for you')} value={number(live.filter(c => c.state === 'waiting').length)} n={live.filter(c => c.state === 'waiting').length} format={number} note={copy('Chat con richieste aperte', 'Chats with pending requests')} /></div>
        <Panel title={copy('Una rete, un Orchestrator', 'One network, one Orchestrator')} note={copy('Le linee pulsano per 15 secondi dopo una comunicazione osservata. Seleziona un nodo.', 'Edges pulse for 15 seconds after an observed communication. Select a node.')} facts={`${live.length} chats; ${links.filter(e => e.at && tick - e.at < 15_000).length} recent connections`} source="chat:list · chat:items">
          {live.length ? <div className="dash-network"><Graph label={tabName('agents')} nodes={live.map(c => ({ id: c.id, label: chatName(c), detail: `${c.harness} · ${c.model ?? '—'} · ${c.state}`, central: c.isRegia, active: c.state === 'running' || c.state === 'starting' }))} edges={links.map(e => ({ ...e, active: e.at !== null && tick >= e.at && tick - e.at < 15_000 }))} selected={selected} onSelect={setSelected} />
            <aside className="dash-inspector">{activeChat ? <><span className="dash-eyebrow">{activeChat.isRegia ? 'ORCHESTRATOR' : activeChat.harness}</span><h2>{chatName(activeChat)}</h2><p>{activeChat.model ?? copy('Modello non riportato', 'Model not reported')}</p><span className={`dash-status ${activeChat.state}`}>{activeChat.state}</span><p>{activeChat.lastText || copy('Nessun messaggio recente.', 'No recent message.')}</p><Discuss title={chatName(activeChat)} facts={`${activeChat.harness}; ${activeChat.model}; ${activeChat.state}\n${activeChat.lastText}`} source={`chat:${activeChat.id}`} /></> : <><span className="dash-orbit-icon">◎</span><h2>{copy('Segui il flusso', 'Follow the flow')}</h2><p>{copy('Scegli un agente per vedere modello, stato e ultima attività.', 'Choose an agent to inspect its model, state and latest activity.')}</p></>}</aside></div> : <Empty>{copy('La rete apparirà quando aprirai le prime chat.', 'The network will appear when you open your first chats.')}</Empty>}
        </Panel>
      </>}
      {tab === 'brain' && <><Source data={map} /><Panel title={copy('Le connessioni del tuo brain', 'Your brain connections')} note={`${brainNodes.length} / ${map.data?.nodes.length ?? '—'} ${copy('nodi visibili · cerca o esplora i vicini', 'visible nodes · search or explore neighbours')}`} facts={`${map.data?.nodes.length ?? 'unknown'} nodes; ${map.data?.edges.length ?? 'unknown'} links`} source="/api/map">
        <div className="dash-toolbar"><input aria-label={copy('Cerca note', 'Search notes')} placeholder={copy('Cerca una nota, un file, un concetto…', 'Find a note, a file, a concept…')} value={query} onChange={e => { setQuery(e.target.value); setFocus(null); }} /><button className="btn btn-ghost btn-s" type="button" onClick={() => { setFocus(null); setSelected(null); setQuery(''); }}>{copy('Vista completa', 'Overview')}</button></div>
        {brainNodes.length ? <div className="dash-network"><Graph label={tabName('brain')} nodes={brainNodes.map(n => ({ id: n.id, label: n.label, detail: n.what || n.kind }))} edges={map.data?.edges ?? []} selected={selected} onSelect={setSelected} /><aside className="dash-inspector">{brainNode ? <><span className="dash-eyebrow">{brainNode.kind}</span><h2>{brainNode.label}</h2><p>{brainNode.what}</p><code>{brainNode.file || brainNode.id}</code><button className="btn btn-ghost" type="button" onClick={() => { setFocus(brainNode.id); setQuery(''); }}>{copy('Esplora i collegamenti', 'Explore connections')}</button>{brainNode.file && <button className="btn btn-ghost" type="button" onClick={() => goTarget(`file/${brainNode.file}`)}>{copy('Apri nota', 'Open note')}</button>}<Discuss title={brainNode.label} facts={`${brainNode.what ?? ''}\n${brainNode.file ?? brainNode.id}`} source="/api/map" /></> : <><span className="dash-orbit-icon">⌘</span><h2>{copy('Le idee si incontrano', 'Ideas connect')}</h2><p>{copy('Seleziona una nota per esplorarne i collegamenti o discuterne.', 'Select a note to explore its connections or discuss it.')}</p></>}</aside></div> : <Empty>{map.loading ? copy('Caricamento della mappa…', 'Loading map…') : copy('Nessuna nota trovata. Verifica il brain o cambia ricerca.', 'No notes found. Check your brain or change the search.')}</Empty>}
        {map.data?.warnings.map((warning, i) => <p key={i} className="dash-note">{warning}</p>)}
      </Panel></>}
      {tab === 'costs' && <>
        <Source data={costs} /><div className="dash-stats"><Stat label={copy('Oggi · Claude + Cursor', 'Today · Claude + Cursor')} value={total ? `${total.estimated ? '≈ ' : ''}${money(total.usd)}` : '—'} note={total?.partial ? copy('Parziale: Cursor non disponibile', 'Partial: Cursor unavailable') : copy('Stima equivalente API, non fattura', 'API-equivalent estimate, not a bill')} /><Stat label={copy('Ultimi 7 giorni · Claude', 'Last 7 days · Claude')} value={costs.data ? money(costs.data.total) : '—'} n={costs.data?.total} format={money} note={costs.data ? `${costs.data.from} → ${costs.data.to}` : copy('In attesa della fonte', 'Waiting for source')} /><Stat label={copy('Cursor · ultimi 7 giorni', 'Cursor · last 7 days')} value={cursor?.downloaded ? money(cursor.total) : '—'} note={cursor?.downloaded ? `Export ${when(cursor.downloaded)} · ${copy('ultima riga', 'last row')} ${when(cursor.lastRow)}${cover === false ? ` · ${copy('parziale: l’export finisce prima del periodo', 'partial: the export ends before the period')}` : cover === null ? ` · ${copy('copertura sconosciuta', 'coverage unknown')}` : ''}` : copy('Export Cursor non disponibile', 'Cursor export unavailable')} /></div>
        <div className="dash-columns"><Bars title={copy('Per giorno · Claude, 7 giorni', 'By day · Claude, 7 days')} source="/api/cost?days=7 · USD" rows={Object.entries(costs.data?.byDay ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([label, v]) => ({ label, value: v.usd }))} /><Bars title={copy('Per modello · Claude, 7 giorni', 'By model · Claude, 7 days')} source="/api/cost?days=7 · USD" rows={Object.entries(costs.data?.byModel ?? {}).map(([label, v]) => ({ label, value: v.usd }))} /></div>
        <Bars title={copy('Per motore · oggi, o sessione corrente se manca il giorno', 'By engine · today, or current run where no daily figure exists')} source="costRows: Claude/Cursor today where available, otherwise current run; partial/estimated" rows={[...groups.values()]} />
        <Panel title={copy('Per agente · oggi, o sessione corrente', 'Per agent · today, or current run')} note={copy('Claude/Cursor: oggi quando disponibile. Altri motori e fallback: sessione corrente. ≈ stimato; parziale = prezzi mancanti.', 'Claude/Cursor: today where available. Other engines and fallbacks: current run. ≈ estimated; partial = missing prices.')}>
          {rows.length ? rows.map(row => <div className="dash-row" key={row.key}><div><b>{chatName(row)}</b><small>{row.harness}{row.closed ? ` · ${copy('archiviata', 'archived')}` : ''}</small></div><strong>{row.approx ? '≈ ' : ''}{money(row.usd)}{row.unpriced ? ` + ${copy('non quotato', 'unpriced')}` : ''}</strong><Discuss title={chatName(row)} facts={`${row.harness}: ${row.approx ? '≈ ' : ''}${money(row.usd)}; ${row.unpriced ? 'partial, unpriced turns' : 'reported spend'}. Claude/Cursor today where available; otherwise current run.`} source="costRows · app:usage / chat:list" /></div>) : <Empty>{copy('Nessun costo quotato disponibile. Un dato mancante non vale zero.', 'No priced costs available. Missing data is not zero.')}</Empty>}
          {chats.filter(c => c.costKnown === false && !rows.some(r => r.chatId === c.id)).map(c => <div className="dash-row" key={c.id}><div><b>{chatName(c)}</b><small>{c.harness}</small></div><span>{copy('Costo non disponibile', 'Cost unavailable')}</span><Discuss title={chatName(c)} facts="Cost is not reported by this engine." source="chat:list" /></div>)}
        </Panel>
      </>}
      {tab === 'context' && <>
        <div className="dash-stats"><Stat label={copy('Token consumati oggi · Kimi', 'Tokens used today · Kimi')} value={usage?.kimi ? number(usage.kimi.tokens) : '—'} n={usage?.kimi?.tokens} format={number} note={`${copy('Copertura: solo Kimi', 'Coverage: Kimi only')}${untracked.length ? ` · ${copy('nessun totale token da', 'no token totals from')} ${untracked.join(', ')}` : ''}`} /><Stat label={copy('Contesti sopra soglia', 'Contexts above threshold')} value={number(long.length)} n={long.length} format={number} note={copy('Soglie configurate, chat aperte', 'Configured thresholds, open chats')} /><Stat label={copy('Contesto riportato', 'Context reported')} value={`${live.filter(c => c.contextTokens !== undefined).length} / ${live.length}`} note={copy('Chat aperte con una misura disponibile', 'Open chats with an available measurement')} /></div>
        {usage?.kimi && <Bars title={copy('Token Kimi per modello · oggi', 'Kimi tokens by model · today')} rows={usage.kimi.models.map(m => ({ label: m.model, value: m.tokens }))} format={number} source="app:usage.kimi · today, Rome" />}
        <Panel title={copy('Spazio per ragionare', 'Room to think')} note={copy('Contesto attuale di ogni chat, non token cumulativi consumati. ≈ indica una stima.', 'Current context per chat, not cumulative tokens used. ≈ indicates an estimate.')}>
          {live.length ? [...live].sort((a, b) => (contextRatio(b) ?? -1) - (contextRatio(a) ?? -1)).map(c => {
            const ratio = contextRatio(c), level = contextLevel(c, warn), high = level === 'above';
            const value = c.contextTokens === undefined ? copy('Non riportato', 'Not reported') : `${c.contextEstimated ? '≈ ' : ''}${number(c.contextTokens)}${c.contextMaxTokens ? ` / ${number(c.contextMaxTokens)}` : ''}`;
            return <div className={`dash-context-row ${high ? 'warn' : ''}`} key={c.id}><div className="dash-row"><div><b>{chatName(c)}</b><small>{c.harness} · {c.model ?? '—'}{high ? ` · ${copy('sopra soglia', 'above threshold')}` : ''}</small></div><strong>{value}</strong><Discuss title={chatName(c)} facts={`Context: ${value}; ${ratio === null ? 'window unknown' : `${Math.round(ratio * 100)}%`}; ${level === 'unknown' ? 'threshold status unknown (context not reported)' : `${level} configured threshold`}`} source="chat:list · contextTokens / contextMaxTokens" /></div>{ratio !== null && <div className="dash-track" role="meter" aria-label={`${chatName(c)}: ${copy('contesto', 'context')}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(ratio * 100))}><i style={{ width: `${Math.min(100, ratio * 100)}%` }} /></div>}</div>;
          }) : <Empty>{copy('Apri una chat per seguirne il contesto.', 'Open a chat to follow its context.')}</Empty>}
        </Panel>
      </>}
      {tab === 'errors' && <>
        <Source data={tables} /><div className="dash-stats"><Stat label={copy('Errori AI registrati', 'Logged AI errors')} value={tables.data ? number(tables.data.errors.length) : '—'} n={tables.data?.errors.length} format={number} note="ai-errors.md" /><Stat label={copy('Eventi di errore osservati', 'Observed error events')} value={number(errors.length)} n={errors.length} format={number} note={copy('Feed e messaggi conservati; non incidenti unici', 'Retained feed and messages; not unique incidents')} /></div>
        <Bars title={copy('Errori AI per giorno', 'AI errors by day')} source="ai-errors.md · parsed dated rows" rows={[...errorDays].sort(([a], [b]) => a.localeCompare(b)).slice(-14).map(([label, value]) => ({ label, value }))} format={number} />
        <Panel title={copy('Cosa abbiamo imparato', 'What we learned')} note="ai-errors.md"><div className="dash-toolbar"><input value={errorQuery} onChange={e => setErrorQuery(e.target.value)} aria-label={copy('Filtra errori', 'Filter errors')} placeholder={copy('Filtra per agente, area o errore…', 'Filter by agent, area or error…')} /></div>
          {errorRows.length ? errorRows.slice().reverse().map((e, i) => <article className="dash-error" key={`${e.data}-${e.ora}-${i}`}><div><span className="dash-tag">{e.tipo || e.area || 'AI'}</span><small>{e.data} {e.ora} · {e.chi}</small></div><h4>{e.vero || e.detto}</h4>{e.regola && <p>{e.regola}</p>}<Discuss title={`${e.area}: ${e.tipo}`} facts={`${e.data} ${e.ora} · ${e.chi}\n${e.detto}\n${e.vero}\n${e.regola}`} source="ai-errors.md" /></article>) : <Empty>{tables.data ? copy('Nessun errore corrisponde alla ricerca.', 'No errors match the search.') : copy('Il registro non è ancora disponibile.', 'The error log is not yet available.')}</Empty>}
        </Panel><Panel title={copy('Errori recenti dell’app e degli strumenti', 'Recent app and tool errors')} note={copy('Eventi conservati nel feed e nelle chat; non è lo storico completo dei log.', 'Retained feed and chat events; this is not the complete application log.')}>
          {errors.length ? errors.map(e => <article className="dash-error" key={e.id}><small>{e.source} · {new Date(e.at).toLocaleString(locale())}</small><h4>{e.title}</h4><p>{e.detail}</p><Discuss title={e.title} facts={e.detail} source={`${e.source} · ${new Date(e.at).toISOString()}`} /></article>) : <Empty>{copy('Nessun evento di errore nei dati conservati.', 'No error events in retained data.')}</Empty>}
        </Panel>
      </>}
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
        {!long.length && !rows.length && !costs.data?.advice.length && !(tables.data?.recurrence.totals ?? []).some(([, n]) => n > 1) && <Empty>{copy('Nessun segnale azionabile nei dati disponibili. Gli spunti compariranno qui.', 'No actionable signals in available data. Insights will appear here.')}</Empty>}
      </>}
    </div>
  </div>;
}
