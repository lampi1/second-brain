// The Log page (ADR 0111; owner, 2026-10-21: «un'unica sezione Log … log leggibili e carini, facili da leggere e da
// capire e in tempo reale … deve essere TUTTO visibile»): on the left each task as a chain (who chose which agent and
// why → the agent's work with cost, tools and errors → the result → the verification, the delegated chats indented
// under their parent), with automatic flags; on the right the live stream of every event (classifiers, estimates,
// errors and memory written to the brain, Battito, the brain's changes with their history, the app's warnings). A click
// on a step or a line opens its details: input, result, errors, tools. Reading it spends no AI tokens (the app's own
// events, main/activity/journal.ts); only «Fai analizzare all'AI» prepares a message for the Orchestrator, sent by
// the user. Mounted by App.tsx's PageFrame; pure helpers in lib/log-view.ts; styles in styles/log.css.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { LOG_RECENT, type LogEvent, type LogKind, type LogList } from '@shared/activity-log';
import type { ChatSummary } from '@shared/contract';
import { sb } from '../sb';
import { useApp } from '../store/store';
import { toast } from '../store/ui';
import { brainBridge, go, openChatRef } from '../actions';
import { useBrain } from '../brain/api';
import type { BrainPageId } from '../brain';
import { normChangelog } from '../brain/types';
import { dayLabel } from '../brain/lib/brain-sections';
import { buildTasks, byDay, clockOf, filterEvents, money, size, span, type ChainStep, type KindFilter, type LogFlag, type TaskChain } from '../lib/log-view';
import { AgentAvatar } from './AgentAvatar';
import { IconAlert, IconArrowRight, IconSparkle, IconX } from './Icons';
import { now } from '../lib/clock';
import '../dashboard/dashboard.css';
import '../styles/brain-sections.css';
import '../styles/log.css';

const KIND_LABEL: Record<LogKind, string> = {
  task: 'Incarichi', classifier: 'Classificatori', estimate: 'Stime', error: 'Errori', memory: 'Memoria', pulse: 'Battito', brain: 'Brain', app: 'App',
};
const KIND_ONE: Record<LogKind, string> = {
  task: 'Incarico', classifier: 'Classificatore', estimate: 'Stima', error: 'Errore', memory: 'Memoria', pulse: 'Battito', brain: 'Brain', app: 'App',
};
const ACTION: Record<string, string> = { added: 'aggiunto', edited: 'modificato', fixed: 'corretto', deleted: 'eliminato', restored: 'ripristinato' };
const TASKS_SHOWN = 12;
const STREAM_SHOWN = 150;

/** Where a brain change's history and restore live, by the changelog's kind of change. */
const CHANGE_PAGE: Record<string, BrainPageId> = { script: 'script', rule: 'regole', skill: 'skill', agent: 'agenti', procedure: 'skill', note: 'memoria', other: 'memoria' };
type HistoryEvent = LogEvent & { page?: BrainPageId };

/** The brain's changelog (changelog.md) as Log events: the history of the brain's changes lives here now. */
function useBrainHistory(): HistoryEvent[] {
  const log = useBrain('/api/changelog', normChangelog);
  return useMemo(() => (log.data?.entries ?? []).flatMap((e, i) => {
    const at = Date.parse(e.at.replace(' ', 'T'));
    if (!Number.isFinite(at)) return [];
    return [{ id: `bc-${e.at}-${i}`, at, kind: 'brain' as const, level: e.action === 'deleted' ? 'warn' as const : 'info' as const,
      title: `${e.target} ${ACTION[e.action] ?? e.action}`, text: e.summary, who: e.by, page: CHANGE_PAGE[e.kind] ?? 'memoria' }];
  }), [log.data]);
}

function useLogEvents(): { events: LogEvent[]; meta: Omit<LogList, 'events'> | null; error: string | null } {
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [meta, setMeta] = useState<Omit<LogList, 'events'> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const off = sb.on('log:events', add => setEvents(prev => { const ids = new Set(prev.map(e => e.id)); return [...prev, ...add.filter(e => !ids.has(e.id))].slice(-LOG_RECENT); }));
    sb.invoke('log:list', undefined).then(l => {
      if (!live) return;
      setEvents(prev => { const ids = new Set(l.events.map(e => e.id)); return [...l.events, ...prev.filter(e => !ids.has(e.id))].slice(-LOG_RECENT); });
      setMeta({ bytes: l.bytes, keepDays: l.keepDays, maxBytes: l.maxBytes });
    }).catch(e => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; off(); };
  }, []);
  return { events, meta, error };
}

type Detail = { kind: 'step'; step: ChainStep; task: TaskChain } | { kind: 'event'; event: LogEvent };

export function LogPage() {
  const { events, meta, error } = useLogEvents();
  const history = useBrainHistory();
  const chats = useApp(s => s.chats);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [flagsOnly, setFlagsOnly] = useState(false);
  const [moreTasks, setMoreTasks] = useState(false);
  const [moreStream, setMoreStream] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const all = useMemo(() => [...events, ...history].sort((a, b) => a.at - b.at), [events, history]);
  const tasks = useMemo(() => buildTasks(events), [events]);
  const shownTasks = useMemo(() => {
    const words = q.trim();
    return tasks.filter(t => (!flagsOnly || t.flags.length) && (kind === 'all' || kind === 'task') && (!words || filterEvents(t.steps.flatMap(s => s.events), words, 'all').length || t.title.toLowerCase().includes(words.toLowerCase())));
  }, [tasks, q, kind, flagsOnly]);
  const stream = useMemo(() => filterEvents(all, q, kind), [all, q, kind]);
  const today = new Date(now());
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const todayCount = all.filter(e => e.at >= startOfDay).length;
  const flagCount = tasks.reduce((n, t) => n + t.flags.length, 0);
  const todayCost = events.filter(e => e.at >= startOfDay && e.step === 'work').reduce((n, e) => n + (e.costUsd ?? 0), 0);
  const counts = useMemo(() => { const m = new Map<LogKind, number>(); for (const e of all) m.set(e.kind, (m.get(e.kind) ?? 0) + 1); return m; }, [all]);
  const kinds = (Object.keys(KIND_LABEL) as LogKind[]).filter(k => counts.has(k));
  useEffect(() => {
    if (!detail) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setDetail(null); } };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [detail]);
  const days = byDay(stream).map(([d, list]) => [d, list] as const);
  let left = moreStream ? Infinity : STREAM_SHOWN;
  return (
    <div className="dashboard bs-page lg-page" data-testid="log-page">
      <header className="dash-header bs-header"><div><span className="dash-eyebrow">APP</span><h1>Log</h1>
        <p>Tutto quello che succede nell’app, in tempo reale: incarichi, classificatori, stime, errori, memoria, Battito. Leggerlo non consuma token.</p></div>
        <span className="dash-live-label lg-live"><i className="dash-live-dot" aria-hidden="true" />In diretta</span></header>
      <div className="dash-stats lg-stats">
        <div className="dash-stat"><span>Eventi oggi</span><strong data-testid="lg-today">{todayCount}</strong><small>{todayCost > 0 ? `${money(todayCost)} di lavoro degli agenti` : 'Dagli eventi dell’app'}</small></div>
        <div className="dash-stat"><span>Incarichi</span><strong>{tasks.length}</strong><small>{tasks.filter(t => t.steps.some(s => s.chatId && isBusy(chats[s.chatId]))).length} in corso adesso</small></div>
        <div className={`dash-stat${flagCount ? ' lg-stat-warn' : ''}`}><span>Segnalazioni</span><strong data-testid="lg-flags">{flagCount}</strong><small>{flagCount ? 'Anomalie trovate dalle regole dell’app' : 'Nessuna anomalia'}</small></div>
        <div className="dash-stat"><span>Spazio</span><strong className="bs-stat-text">{meta ? size(meta.bytes) : '—'}</strong><small>{meta ? `Pulizia automatica: ${meta.keepDays} giorni, max ${size(meta.maxBytes)}` : 'Pulizia automatica'}</small></div>
      </div>
      <div className="bs-toolbar" role="search">
        <label className="dash-search bs-search"><span aria-hidden="true">⌕</span><input type="search" value={q} onChange={e => setQ(e.target.value)} aria-label="Cerca nel log" placeholder="Cerca un agente, uno strumento, un errore…" data-testid="lg-search" /></label>
        <div className="bs-chips" role="group" aria-label="Tipo di evento">
          <button type="button" className="bs-chip" aria-pressed={kind === 'all'} onClick={() => setKind('all')} data-testid="lg-filter-all">Tutto <b>{all.length}</b></button>
          {kinds.map(k => <button key={k} type="button" className={`bs-chip lg-chip lg-k-${k}`} aria-pressed={kind === k} onClick={() => setKind(k)} data-testid={`lg-filter-${k}`}><i aria-hidden="true" />{KIND_LABEL[k]} <b>{counts.get(k)}</b></button>)}
        </div>
        <button type="button" className={`bs-chip lg-flag-toggle${flagsOnly ? ' on' : ''}`} aria-pressed={flagsOnly} onClick={() => setFlagsOnly(!flagsOnly)} disabled={!flagCount} data-testid="lg-flags-only"><IconAlert size={12} /> Solo segnalazioni</button>
      </div>
      {error && !events.length ? <div className="dash-empty">Non riesco a leggere il log: {error}</div> : null}
      <div className="lg-grid">
        <section className="lg-col" aria-label="Incarichi">
          <header className="lg-col-head"><h2>Incarichi</h2><small>Chi ha scelto chi, il lavoro, il risultato, la verifica</small></header>
          {!shownTasks.length ? <div className="lg-empty"><span className="dash-orbit-icon" aria-hidden="true">↻</span><p>{tasks.length ? 'Nessun incarico corrisponde ai filtri.' : 'Quando l’Orchestrator affida un lavoro a un agente, qui vedi tutta la catena, passo per passo.'}</p></div>
            : <>{shownTasks.slice(0, moreTasks ? undefined : TASKS_SHOWN).map(t => <TaskCard key={t.rootId} task={t} chats={chats} onStep={s => setDetail({ kind: 'step', step: s, task: t })} />)}
              {!moreTasks && shownTasks.length > TASKS_SHOWN && <button type="button" className="btn btn-ghost btn-s lg-more" onClick={() => setMoreTasks(true)}>Mostra altri {shownTasks.length - TASKS_SHOWN} incarichi</button>}</>}
        </section>
        <section className="lg-col lg-stream" aria-label="Flusso in tempo reale">
          <header className="lg-col-head"><h2>Flusso</h2><small>Ogni evento, il più recente in alto</small></header>
          {!stream.length ? <div className="lg-empty"><p>{all.length ? 'Nessun evento corrisponde ai filtri.' : 'Ancora nessun evento: compaiono qui appena l’app lavora.'}</p></div>
            : <div className="lg-days" data-testid="lg-stream">{days.map(([d, list]) => {
              if (left <= 0) return null;
              const rows = list.slice(0, left); left -= rows.length;
              return <div key={d} className="lg-day"><h3>{dayLabel(d, today)}</h3><ol>{rows.map(e => <StreamRow key={e.id} e={e} onOpen={() => setDetail({ kind: 'event', event: e })} />)}</ol></div>;
            })}
            {!moreStream && stream.length > STREAM_SHOWN && <button type="button" className="btn btn-ghost btn-s lg-more" onClick={() => setMoreStream(true)}>Mostra altri {stream.length - STREAM_SHOWN} eventi</button>}</div>}
        </section>
      </div>
      {/* on the body: the page is a size container, which would hold a fixed panel inside it */}
      {detail && createPortal(<DetailPanel detail={detail} chats={chats} onClose={() => setDetail(null)} />, document.body)}
    </div>
  );
}

const isBusy = (c: ChatSummary | undefined) => !!c && !c.closedAt && (c.state === 'running' || c.state === 'starting' || c.state === 'waiting');

function taskState(t: TaskChain, chats: Readonly<Record<string, ChatSummary | undefined>>): { label: string; tone: string } {
  const live = t.chats.map(id => chats[id]).filter((c): c is ChatSummary => !!c && !c.closedAt);
  if (live.some(c => c.state === 'waiting' || c.pending > 0)) return { label: 'Ti aspetta', tone: 'wait' };
  if (live.some(c => c.state === 'running' || c.state === 'starting')) return { label: 'In corso', tone: 'run' };
  if (t.errors) return { label: 'Con errori', tone: 'err' };
  return { label: live.length ? 'Fermo' : 'Finito', tone: 'done' };
}

const STEP_ICON: Record<string, string> = { open: '→', classifier: '◇', work: '⚙', request: '?', result: '✓', review: '◎', verdict: '★', closed: '■', error: '!', unverified: '○' };

function TaskCard({ task, chats, onStep }: { task: TaskChain; chats: Readonly<Record<string, ChatSummary | undefined>>; onStep: (s: ChainStep) => void }) {
  const state = taskState(task, chats);
  const root = chats[task.rootId];
  const flagged = new Set(task.flags.map(f => f.stepKey).filter(Boolean));
  return <article className={`lg-task tone-${state.tone}`} data-testid="lg-task">
    <header>
      <AgentAvatar avatar={root?.agent?.avatar} name={root?.agent?.name ?? task.title} size={26} />
      <div className="lg-task-title"><h3 title={task.title}>{task.title}</h3>
        <small>{clockOf(task.first).slice(0, 5)} · {span(Math.max(0, task.last - task.first))}{task.costUsd > 0 ? ` · ${money(task.costUsd)}` : ''}</small></div>
      <span className={`lg-state lg-state-${state.tone}`}><i aria-hidden="true" />{state.label}</span>
    </header>
    {task.flags.length > 0 && <div className="lg-flags">{task.flags.map((f, i) => <FlagChip key={i} f={f} />)}</div>}
    <ol className="lg-chain">{task.steps.map(s => <li key={s.key} className={`lg-step k-${s.kind} lv-${s.level}${flagged.has(s.key) ? ' flagged' : ''}`} style={{ '--depth': s.depth } as React.CSSProperties}>
      <button type="button" onClick={() => onStep(s)} disabled={s.kind === 'unverified'} data-testid={`lg-step-${s.kind}`}>
        <span className="lg-step-ico" aria-hidden="true">{STEP_ICON[s.kind]}</span>
        <span className="lg-step-body"><span className="lg-step-title">{s.title}{s.turns > 1 ? <em> · {s.turns} turni</em> : null}</span>
          {stepMeta(s)}
          {s.text && s.kind !== 'work' && <span className="lg-step-text">{s.text}</span>}</span>
        <time>{clockOf(s.at).slice(0, 5)}</time>
      </button>
    </li>)}</ol>
    <footer>
      {root && !root.closedAt ? <button type="button" className="btn btn-subtle btn-s" onClick={() => openChatRef(task.rootId)}>Apri la chat <IconArrowRight size={11} /></button> : <span className="bs-muted">{task.chats.length === 1 ? '1 chat' : `${task.chats.length} chat`}</span>}
      <span className="sp" />
      <AiButton text={taskBrief(task)} />
    </footer>
  </article>;
}

function stepMeta(s: ChainStep): ReactNode {
  if (s.kind !== 'work') return null;
  const parts: ReactNode[] = [];
  if (s.costUsd > 0) parts.push(<span key="c" className="lg-pill">{money(s.costUsd)}</span>);
  if (s.ms > 0) parts.push(<span key="t" className="lg-pill">{span(s.ms)}</span>);
  if (s.tools.length) parts.push(<span key="s" className="lg-pill" title={s.tools.join(', ')}>{s.tools.length} {s.tools.length === 1 ? 'strumento' : 'strumenti'}</span>);
  if (s.toolErrors) parts.push(<span key="e" className="lg-pill lg-pill-err">{s.toolErrors} {s.toolErrors === 1 ? 'errore' : 'errori'}</span>);
  return parts.length ? <span className="lg-step-meta">{parts}</span> : null;
}

function FlagChip({ f }: { f: LogFlag }) {
  return <span className={`lg-flag lg-flag-${f.kind}`} title={f.detail} data-testid={`lg-flag-${f.kind}`}><IconAlert size={11} />{f.title}</span>;
}

function StreamRow({ e, onOpen }: { e: LogEvent; onOpen: () => void }) {
  return <li className={`lg-row lv-${e.level}`}>
    <button type="button" onClick={onOpen} data-testid="lg-row">
      <time>{clockOf(e.at)}</time>
      <span className={`lg-kind lg-k-${e.kind}`}>{KIND_ONE[e.kind]}</span>
      <span className="lg-row-body"><span className="lg-row-title">{e.title}</span>{(e.text || e.error) && <span className="lg-row-text">{e.error ?? e.text}</span>}</span>
      {typeof e.costUsd === 'number' && e.costUsd > 0 && <span className="lg-pill">{money(e.costUsd)}</span>}
    </button>
  </li>;
}

function Block({ title, text, tone }: { title: string; text?: string; tone?: 'err' }) {
  if (!text) return null;
  return <section className={`lg-block${tone ? ` lg-block-${tone}` : ''}`}><h4>{title}</h4><pre>{text}</pre></section>;
}

function DetailPanel({ detail, chats, onClose }: { detail: Detail; chats: Readonly<Record<string, ChatSummary | undefined>>; onClose: () => void }) {
  const evs = detail.kind === 'step' ? detail.step.events : [detail.event];
  const head = detail.kind === 'step' ? detail.step : detail.event;
  const first = evs[0];
  const chatId = first?.chatId;
  const chat = chatId ? chats[chatId] : undefined;
  const cost = evs.reduce((n, e) => n + (e.costUsd ?? 0), 0), ms = evs.reduce((n, e) => n + (e.ms ?? 0), 0);
  const tools = [...new Set(evs.flatMap(e => e.tools ?? []))];
  const flags = detail.kind === 'step' ? detail.task.flags.filter(f => f.stepKey === detail.step.key) : [];
  return <div className="lg-scrim" onClick={onClose}>
    <aside className="lg-detail" role="dialog" aria-modal="true" aria-label={head.title} onClick={e => e.stopPropagation()} data-testid="lg-detail">
      <header><div><span className="dash-eyebrow">{detail.kind === 'step' ? detail.task.title : KIND_ONE[detail.event.kind].toUpperCase()}</span><h3>{head.title}</h3>
        <small>{new Date(head.at).toLocaleString('it-IT', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', second: '2-digit' })}{first?.who ? ` · ${first.who}` : ''}</small></div>
        <button type="button" className="lg-close" onClick={onClose} aria-label="Chiudi"><IconX size={14} /></button></header>
      {flags.map((f, i) => <p key={i} className="lg-detail-flag"><IconAlert size={12} /><b>{f.title}.</b> {f.detail}</p>)}
      {(cost > 0 || ms > 0 || tools.length > 0) && <div className="lg-detail-facts">
        {cost > 0 && <div><span>Costo</span><b>{money(cost)}</b></div>}
        {ms > 0 && <div><span>Tempo</span><b>{span(ms)}</b></div>}
        {tools.length > 0 && <div><span>Strumenti</span><b>{tools.length}</b></div>}
      </div>}
      {tools.length > 0 && <div className="lg-tools">{tools.map(t => <code key={t}>{t}</code>)}</div>}
      <div className="lg-detail-body">
        {evs.length > 1 ? evs.map((e, i) => <details key={e.id} className="lg-turn" open={i === evs.length - 1}>
          <summary><b>{e.title}</b><span>{clockOf(e.at)}{typeof e.costUsd === 'number' ? ` · ${money(e.costUsd)}` : ''}{e.ms ? ` · ${span(e.ms)}` : ''}</span></summary>
          <Block title="Dettaglio" text={e.text} /><Block title="Input" text={e.input} /><Block title="Risultato" text={e.output} /><Block title="Errori" text={e.error} tone="err" />
        </details>)
          : <><Block title="Dettaglio" text={first?.text} /><Block title="Input" text={first?.input} /><Block title="Risultato" text={first?.output} /><Block title="Errori" text={first?.error} tone="err" /></>}
        {!evs.some(e => e.text || e.input || e.output || e.error) && <p className="bs-muted">Nessun altro dettaglio registrato per questo passaggio.</p>}
      </div>
      <footer>
        {chat && <button type="button" className="btn btn-subtle btn-s" onClick={() => { onClose(); openChatRef(chat.id); }}>Apri la chat <IconArrowRight size={11} /></button>}
        {detail.kind === 'event' && detail.event.kind === 'brain' && <button type="button" className="btn btn-subtle btn-s" onClick={() => { onClose(); go({ page: (detail.event as HistoryEvent).page ?? 'memoria' }); }}>Storico e ripristino <IconArrowRight size={11} /></button>}
        <span className="sp" />
        <AiButton text={detail.kind === 'step' ? `${taskBrief(detail.task)}\n\nPassaggio: ${head.title}\n${evs.map(e => [e.input && `Input: ${e.input.slice(0, 600)}`, e.output && `Risultato: ${e.output.slice(0, 600)}`, e.error && `Errore: ${e.error}`].filter(Boolean).join('\n')).join('\n')}` : `Evento del Log (${KIND_ONE[detail.event.kind]}, ${new Date(detail.event.at).toLocaleString('it-IT')}): ${detail.event.title}\n${[detail.event.text, detail.event.error].filter(Boolean).join('\n')}`} />
      </footer>
    </aside>
  </div>;
}

/** «Fai analizzare all'AI»: a draft in the Orchestrator's input, never sent by the app (it spends tokens only if the user sends it). */
function AiButton({ text }: { text: string }) {
  const ask = () => {
    if (!brainBridge.draftToOrchestrator(`Analizza questo dal Log dell'app e dimmi cosa non va e cosa conviene fare:\n\n${text}`, () => {}))
      toast('Apri un Orchestrator per farlo analizzare.');
  };
  return <button type="button" className="lg-ai" onClick={ask} title="Prepara un messaggio per l’Orchestrator: consuma token solo se lo invii"><IconSparkle size={12} /> Fai analizzare all’AI</button>;
}

/** The task's chain as text, for the Orchestrator. */
function taskBrief(t: TaskChain): string {
  const lines = t.steps.map(s => `${'  '.repeat(s.depth)}→ ${s.title}${s.kind === 'work' ? ` (${[s.costUsd > 0 && money(s.costUsd), s.ms > 0 && span(s.ms), s.tools.length && `strumenti: ${s.tools.join(', ')}`, s.toolErrors && `${s.toolErrors} errori`].filter(Boolean).join(', ')})` : s.text ? ` — ${s.text.slice(0, 200)}` : ''}`);
  return [`Incarico «${t.title}»`, ...lines, ...t.flags.map(f => `⚠ ${f.title}: ${f.detail}`)].join('\n');
}
