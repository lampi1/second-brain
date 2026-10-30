// The Log page (ADR 0111; owner, 2026-10-21: «un'unica sezione Log … log leggibili e carini, facili da leggere e da
// capire e in tempo reale … deve essere TUTTO visibile»): on the left each task as a chain (who chose which agent and
// why → the agent's work with cost, tools and errors → the result → the verification, the delegated chats indented
// under their parent), with automatic flags; on the right the live stream of every event (classifiers, estimates,
// errors and memory written to the brain, the brain's changes with their history, the app's warnings). A click
// on a step or a line opens its details: input, result, errors, tools. Reading it spends no AI tokens (the app's own
// events, main/activity/journal.ts); only «Fai analizzare all'IA» prepares a message for the Orchestrator, sent by
// the user. Mounted by App.tsx's PageFrame; pure helpers in lib/log-view.ts; styles in styles/log.css.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { LOG_KINDS, LOG_RECENT, type LogEvent, type LogKind, type LogList } from '@shared/activity-log';
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
import { Modal } from './ui';
import { IconAlert, IconArrowRight, IconSparkle } from './Icons';
import { now } from '../lib/clock';
import { locale, t } from '../i18n';
import '../dashboard/dashboard.css';
import '../styles/brain-sections.css';
import '../styles/log.css';

const kindLabel = (k: LogKind) => t(`log.kind.${k}`);
const kindOne = (k: LogKind) => t(`log.one.${k}`);
const ACTIONS = ['added', 'edited', 'fixed', 'deleted', 'restored'] as const;
const actionLabel = (a: string) => (ACTIONS as readonly string[]).includes(a) ? t(`log.action.${a as typeof ACTIONS[number]}`) : a;
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
      title: `${e.target} ${actionLabel(e.action)}`, text: e.summary, who: e.by, page: CHANGE_PAGE[e.kind] ?? 'memoria' }];
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
    return tasks.filter(task => (!flagsOnly || task.flags.length) && (kind === 'all' || kind === 'task') && (!words || filterEvents(task.steps.flatMap(s => s.events), words, 'all').length || task.title.toLowerCase().includes(words.toLowerCase())));
  }, [tasks, q, kind, flagsOnly]);
  const stream = useMemo(() => filterEvents(all, q, kind), [all, q, kind]);
  const today = new Date(now());
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const todayCount = all.filter(e => e.at >= startOfDay).length;
  const flagCount = tasks.reduce((n, task) => n + task.flags.length, 0);
  const todayCost = events.filter(e => e.at >= startOfDay && e.step === 'work').reduce((n, e) => n + (e.costUsd ?? 0), 0);
  const counts = useMemo(() => { const m = new Map<LogKind, number>(); for (const e of all) m.set(e.kind, (m.get(e.kind) ?? 0) + 1); return m; }, [all]);
  const kinds = LOG_KINDS.filter(k => counts.has(k));
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
        <p>{t('log.lead')}</p></div>
        <span className="dash-live-label lg-live"><i className="dash-live-dot" aria-hidden="true" />{t('log.live')}</span></header>
      <div className="dash-stats lg-stats">
        <div className="dash-stat"><span>{t('log.stat.today')}</span><strong data-testid="lg-today">{todayCount}</strong><small>{todayCost > 0 ? t('log.stat.todayCost', { cost: money(todayCost) }) : t('log.stat.todayHint')}</small></div>
        <div className="dash-stat"><span>{t('log.stat.tasks')}</span><strong>{tasks.length}</strong><small>{t('log.stat.running', { n: tasks.filter(task => task.steps.some(s => s.chatId && isBusy(chats[s.chatId]))).length })}</small></div>
        <div className={`dash-stat${flagCount ? ' lg-stat-warn' : ''}`}><span>{t('log.stat.flags')}</span><strong data-testid="lg-flags">{flagCount}</strong><small>{flagCount ? t('log.stat.flagsSome') : t('log.stat.flagsNone')}</small></div>
        <div className="dash-stat"><span>{t('log.stat.space')}</span><strong className="bs-stat-text">{meta ? size(meta.bytes) : '—'}</strong><small>{meta ? t('log.stat.cleanup', { days: meta.keepDays, max: size(meta.maxBytes) }) : t('log.stat.cleanupShort')}</small></div>
      </div>
      <div className="bs-toolbar" role="search">
        <label className="dash-search bs-search"><span aria-hidden="true">⌕</span><input type="search" value={q} onChange={e => setQ(e.target.value)} aria-label={t('log.search')} placeholder={t('log.searchHint')} data-testid="lg-search" /></label>
        <div className="bs-chips" role="group" aria-label={t('log.kinds')}>
          <button type="button" className="bs-chip" aria-pressed={kind === 'all'} onClick={() => setKind('all')} data-testid="lg-filter-all">{t('log.all')} <b>{all.length}</b></button>
          {kinds.map(k => <button key={k} type="button" className={`bs-chip lg-chip lg-k-${k}`} aria-pressed={kind === k} onClick={() => setKind(k)} data-testid={`lg-filter-${k}`}><i aria-hidden="true" />{kindLabel(k)} <b>{counts.get(k)}</b></button>)}
        </div>
        <button type="button" className={`bs-chip lg-flag-toggle${flagsOnly ? ' on' : ''}`} aria-pressed={flagsOnly} onClick={() => setFlagsOnly(!flagsOnly)} disabled={!flagCount} data-testid="lg-flags-only"><IconAlert size={12} /> {t('log.flagsOnly')}</button>
      </div>
      {error && !events.length ? <div className="dash-empty">{t('log.readError', { error })}</div> : null}
      <div className="lg-grid">
        <section className="lg-col" aria-label={t('log.tasks')}>
          <header className="lg-col-head"><h2>{t('log.tasks')}</h2><small>{t('log.tasksHint')}</small></header>
          {!shownTasks.length ? <div className="lg-empty"><span className="dash-orbit-icon" aria-hidden="true">↻</span><p>{tasks.length ? t('log.tasksNone') : t('log.tasksEmpty')}</p></div>
            : <>{shownTasks.slice(0, moreTasks ? undefined : TASKS_SHOWN).map(task => <TaskCard key={task.rootId} task={task} chats={chats} onStep={s => setDetail({ kind: 'step', step: s, task })} />)}
              {!moreTasks && shownTasks.length > TASKS_SHOWN && <button type="button" className="btn btn-ghost btn-s lg-more" onClick={() => setMoreTasks(true)}>{t('log.moreTasks', { n: shownTasks.length - TASKS_SHOWN })}</button>}</>}
        </section>
        <section className="lg-col lg-stream" aria-label={t('log.stream')}>
          <header className="lg-col-head"><h2>{t('log.stream')}</h2><small>{t('log.streamHint')}</small></header>
          {!stream.length ? <div className="lg-empty"><p>{all.length ? t('log.streamNone') : t('log.streamEmpty')}</p></div>
            : <div className="lg-days" data-testid="lg-stream">{days.map(([d, list]) => {
              if (left <= 0) return null;
              const rows = list.slice(0, left); left -= rows.length;
              return <div key={d} className="lg-day"><h3>{dayLabel(d, today)}</h3><ol>{rows.map(e => <StreamRow key={e.id} e={e} onOpen={() => setDetail({ kind: 'event', event: e })} />)}</ol></div>;
            })}
            {!moreStream && stream.length > STREAM_SHOWN && <button type="button" className="btn btn-ghost btn-s lg-more" onClick={() => setMoreStream(true)}>{t('log.moreStream', { n: stream.length - STREAM_SHOWN })}</button>}</div>}
        </section>
      </div>
      {/* on the body: the page is a size container, which would hold a fixed panel inside it */}
      {detail && <DetailPanel detail={detail} chats={chats} onClose={() => setDetail(null)} />}
    </div>
  );
}

const isBusy = (c: ChatSummary | undefined) => !!c && !c.closedAt && (c.state === 'running' || c.state === 'starting' || c.state === 'waiting');

function taskState(task: TaskChain, chats: Readonly<Record<string, ChatSummary | undefined>>): { label: string; tone: string } {
  const live = task.chats.map(id => chats[id]).filter((c): c is ChatSummary => !!c && !c.closedAt);
  if (live.some(c => c.state === 'waiting' || c.pending > 0)) return { label: t('log.state.wait'), tone: 'wait' };
  if (live.some(c => c.state === 'running' || c.state === 'starting')) return { label: t('log.state.run'), tone: 'run' };
  if (task.errors) return { label: t('log.state.err'), tone: 'err' };
  return { label: live.length ? t('log.state.idle') : t('log.state.done'), tone: 'done' };
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
        <span className="lg-step-body"><span className="lg-step-title">{s.title}{s.turns > 1 ? <em> · {t('log.turns', { n: s.turns })}</em> : null}</span>
          {stepMeta(s)}
          {s.text && s.kind !== 'work' && <span className="lg-step-text">{s.text}</span>}</span>
        <time>{clockOf(s.at).slice(0, 5)}</time>
      </button>
    </li>)}</ol>
    <footer>
      {root && !root.closedAt ? <button type="button" className="btn btn-subtle btn-s" onClick={() => openChatRef(task.rootId)}>{t('log.openChat')} <IconArrowRight size={11} /></button> : <span className="bs-muted">{t('log.chats', { n: task.chats.length })}</span>}
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
  if (s.tools.length) parts.push(<span key="s" className="lg-pill" title={s.tools.join(', ')}>{t('log.tools', { n: s.tools.length })}</span>);
  if (s.toolErrors) parts.push(<span key="e" className="lg-pill lg-pill-err">{t('log.errors', { n: s.toolErrors })}</span>);
  return parts.length ? <span className="lg-step-meta">{parts}</span> : null;
}

function FlagChip({ f }: { f: LogFlag }) {
  return <span className={`lg-flag lg-flag-${f.kind}`} title={f.detail} data-testid={`lg-flag-${f.kind}`}><IconAlert size={11} />{f.title}</span>;
}

function StreamRow({ e, onOpen }: { e: LogEvent; onOpen: () => void }) {
  return <li className={`lg-row lv-${e.level}`}>
    <button type="button" onClick={onOpen} data-testid="lg-row">
      <time>{clockOf(e.at)}</time>
      <span className={`lg-kind lg-k-${e.kind}`}>{kindOne(e.kind)}</span>
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
  // a side panel on the shared dialog (ui.tsx Modal): Esc, a click outside or ✕ close it, Tab stays inside, the focus
  // goes back to the step or line that opened it
  const eyebrow = detail.kind === 'step' ? detail.task.title : kindOne(detail.event.kind);
  const when = new Date(head.at).toLocaleString(locale(), { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return <Modal onClose={onClose} label={head.title} testid="lg-detail" className="lg-detail" size="side" bodyClassName="lg-detail-main"
    title={head.title} subtitle={`${eyebrow} · ${when}${first?.who ? ` · ${first.who}` : ''}`}
    footer={<>
      {chat && <button type="button" className="btn btn-ghost btn-m" onClick={() => { onClose(); openChatRef(chat.id); }}>{t('log.openChat')} <IconArrowRight size={11} /></button>}
      {detail.kind === 'event' && detail.event.kind === 'brain' && <button type="button" className="btn btn-ghost btn-m" onClick={() => { onClose(); go({ page: (detail.event as HistoryEvent).page ?? 'memoria' }); }}>{t('log.history')} <IconArrowRight size={11} /></button>}
      <span className="sp" />
      <AiButton text={detail.kind === 'step' ? `${taskBrief(detail.task)}\n\n${t('log.aiStep')}: ${head.title}\n${evs.map(e => [e.input && `${t('log.input')}: ${e.input.slice(0, 600)}`, e.output && `${t('log.result')}: ${e.output.slice(0, 600)}`, e.error && `${t('log.errorsLabel')}: ${e.error}`].filter(Boolean).join('\n')).join('\n')}` : `${t('log.aiEvent')} (${kindOne(detail.event.kind)}, ${new Date(detail.event.at).toLocaleString(locale())}): ${detail.event.title}\n${[detail.event.text, detail.event.error].filter(Boolean).join('\n')}`} />
    </>}>
    {flags.map((f, i) => <p key={i} className="lg-detail-flag"><IconAlert size={12} /><b>{f.title}.</b> {f.detail}</p>)}
    {(cost > 0 || ms > 0 || tools.length > 0) && <div className="lg-detail-facts">
      {cost > 0 && <div><span>{t('log.cost')}</span><b>{money(cost)}</b></div>}
      {ms > 0 && <div><span>{t('log.time')}</span><b>{span(ms)}</b></div>}
      {tools.length > 0 && <div><span>{t('log.toolsLabel')}</span><b>{tools.length}</b></div>}
    </div>}
    {tools.length > 0 && <div className="lg-tools">{tools.map(tool => <code key={tool}>{tool}</code>)}</div>}
    <div className="lg-detail-body">
      {evs.length > 1 ? evs.map((e, i) => <details key={e.id} className="lg-turn" open={i === evs.length - 1}>
        <summary><b>{e.title}</b><span>{clockOf(e.at)}{typeof e.costUsd === 'number' ? ` · ${money(e.costUsd)}` : ''}{e.ms ? ` · ${span(e.ms)}` : ''}</span></summary>
        <Block title={t('log.detail')} text={e.text} /><Block title={t('log.input')} text={e.input} /><Block title={t('log.result')} text={e.output} /><Block title={t('log.errorsLabel')} text={e.error} tone="err" />
      </details>)
        : <><Block title={t('log.detail')} text={first?.text} /><Block title={t('log.input')} text={first?.input} /><Block title={t('log.result')} text={first?.output} /><Block title={t('log.errorsLabel')} text={first?.error} tone="err" /></>}
      {!evs.some(e => e.text || e.input || e.output || e.error) && <p className="bs-muted">{t('log.noDetail')}</p>}
    </div>
  </Modal>;
}

/** «Fai analizzare all'IA»: a draft in the Orchestrator's input, never sent by the app (it spends tokens only if the user sends it). */
function AiButton({ text }: { text: string }) {
  const ask = () => {
    if (!brainBridge.draftToOrchestrator(`${t('log.aiPrompt')}\n\n${text}`, () => {}))
      toast(t('log.aiNoOrchestrator'));
  };
  return <button type="button" className="lg-ai" onClick={ask} title={t('log.aiHint')}><IconSparkle size={12} /> {t('log.ai')}</button>;
}

/** The task's chain as text, for the Orchestrator. */
function taskBrief(task: TaskChain): string {
  const lines = task.steps.map(s => `${'  '.repeat(s.depth)}→ ${s.title}${s.kind === 'work' ? ` (${[s.costUsd > 0 && money(s.costUsd), s.ms > 0 && span(s.ms), s.tools.length && `${t('log.toolsLabel')}: ${s.tools.join(', ')}`, s.toolErrors && t('log.errors', { n: s.toolErrors })].filter(Boolean).join(', ')})` : s.text ? ` — ${s.text.slice(0, 200)}` : ''}`);
  return [`${t('log.aiTask')} «${task.title}»`, ...lines, ...task.flags.map(f => `⚠ ${f.title}: ${f.detail}`)].join('\n');
}
