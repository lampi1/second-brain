// Fatto e standup (issue #160): only the macro tasks, the work the user asked for, newest first, one card per day with
// its total; each row with its goal, role, outcome, time and the cost of everything it started (its children, reviews
// and reworks: shared/macro-tasks.ts), «n/d» when a part is unknown; a running task shows its cost so far. The stand-up
// box on top is built from the same rows (the last work day and today, one line each, Copia). Zero tokens and no
// network: everything comes from the app's run store ('runs:macro', refreshed while the page is open), never /api/day,
// the day tool, Azure DevOps or a transcript scan. Laid out like Agenti and Guida (catalog-head, catalog-card).
// Used by brain/index.tsx (page 'fatto').
import { useContext, useEffect, useState } from 'react';
import type { MacroTask } from '@shared/macro-tasks';
import { dayTotal, macroDay } from '@shared/macro-tasks';
import { roleName } from '@shared/roles';
import { dayName, fmt, isDay, shiftDay } from '../lib/format';
import { lastDays } from '../lib/done-log';
import { useAppChats } from '../components/Composer';
import { DiscussContext } from '../components/Discuss';
import { copyText, IconCopy, toast, type Navigate } from '../components/ui';
import { Select } from '../../components/Select';
import { formatCost } from '../../lib/format';
import { now } from '../../lib/clock';
import { locale, t as tr } from '../../i18n';
import '../../styles/agent-catalog.css';
import './worklog.css';

const RANGES = [3, 7, 14];
const TONE: Record<MacroTask['outcome'], string> = { done: 'var(--green)', partial: 'var(--amber)', blocked: 'var(--red)', running: 'var(--blue)', closed: 'var(--text-3)' };
const REFRESH_MS = 5000;

const localDay = (ms: number): string => macroDay({ startedAt: ms });
const clock = (ms: number): string => new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
const cost = (usd: number | null): string => usd === null ? tr('brainPages.fatto.unknownCost') : formatCost(usd);

/** The macro tasks since `since`, read again every few seconds (a running task's cost grows); null = not read yet. */
function useMacroTasks(since: number): { rows: MacroTask[] | null; error: string | null; reload: () => void } {
  const [rows, setRows] = useState<MacroTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const read = () => window.sb.invoke('runs:macro', { since }).then(r => { if (alive) { setRows(r); setError(null); } }, e => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    read();
    const timer = setInterval(read, REFRESH_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [since, tick]);
  return { rows, error, reload: () => setTick(n => n + 1) };
}

/** One line per macro task: "Ieri: «goal» (Scout, fatto)". */
export function standupLines(rows: readonly MacroTask[], today: string, title: (r: MacroTask) => string): string[] {
  const days = [...new Set(rows.map(macroDay))].filter(d => d < today).sort();
  const prev = days.at(-1);
  const line = (r: MacroTask, when: string) => tr('brainPages.fatto.standupLine', { when, what: title(r), role: roleName(r.agentId), outcome: tr(`brainPages.fatto.outcome.${r.outcome}`) });
  const of = (d: string) => rows.filter(r => macroDay(r) === d).sort((a, b) => a.startedAt - b.startedAt);
  return [...(prev ? of(prev).map(r => line(r, dayName(prev, today))) : []), ...of(today).map(r => line(r, dayName(today, today)))];
}

function Standup({ lines }: { lines: string[] }) {
  const text = lines.join('\n');
  return (
    <section className="bx-card bx-standup bx-section" aria-labelledby="bx-standup-h" data-testid="bx-standup">
      <div className="bx-section-head">
        <h2 id="bx-standup-h">{tr('brainPages.day.standupTitle')}</h2>
        <p>{tr('brainPages.fatto.standupDesc')}</p>
        <span className="sp" />
        {text && <button type="button" className="bx-btn s" onClick={() => void copyText(text).then(ok => toast(ok ? tr('brainPages.day.copied') : tr('brainPages.day.copyFailed')))} data-testid="fatto-standup-copy"><IconCopy /> {tr('brainPages.day.copyBtn')}</button>}
      </div>
      <div className="lines">{lines.length ? lines.map((s, i) => <p key={i}>{s}</p>) : <p className="muted">{tr('brainPages.fatto.standupEmpty')}</p>}</div>
    </section>
  );
}

function Row({ r, title, onChat }: { r: MacroTask; title: string; onChat?: (id: string) => void }) {
  const running = r.outcome === 'running';
  return (
    <li className="wl-entry" data-outcome={r.outcome} style={{ ['--tone' as string]: TONE[r.outcome] }} data-testid="fatto-entry">
      <time className="wl-time" dateTime={new Date(r.startedAt).toISOString()}>{clock(r.startedAt)}</time>
      <span className="wl-dot" aria-hidden="true" />
      <div className="wl-body">
        <span className="wl-what wl-what-row">
          {onChat
            ? <button type="button" className="wl-link" onClick={() => onChat(r.chatId)} aria-label={tr('brainPages.fatto.openChat', { title })}>{title}</button>
            : <span>{title}</span>}
          <span className="wl-cost" data-testid="fatto-cost" data-tip={running ? tr('brainPages.fatto.costSoFar') : tr('brainPages.fatto.costTip', { n: r.runs })}>{running ? `${cost(r.costUsd)} ${tr('brainPages.fatto.soFar')}` : cost(r.costUsd)}</span>
        </span>
        <span className="wl-meta">
          <span className="catalog-chip wl-kind">{tr(`brainPages.fatto.outcome.${r.outcome}`)}</span>
          <span className="wl-who">{roleName(r.agentId)}</span>
          <span className="wl-area">{r.endedAt !== undefined ? `${clock(r.startedAt)}–${clock(r.endedAt)}` : tr('brainPages.fatto.since', { at: clock(r.startedAt) })}</span>
          {r.runs > 1 && <span className="wl-area">{tr('brainPages.fatto.parts', { n: r.runs })}</span>}
        </span>
      </div>
    </li>
  );
}

function DayCard({ day, today, index, rows, title, onChat }: { day: string; today: string; index: number; rows: MacroTask[]; title: (r: MacroTask) => string; onChat?: (id: string) => void }) {
  const name = dayName(day, today);
  return (
    <section className="catalog-card wl-day" style={{ ['--row-index' as string]: index }} aria-labelledby={`wl-${day}`} data-testid={`fatto-day-${day}`}>
      <header className="wl-day-head">
        <h3 id={`wl-${day}`}>{name}</h3>
        <span className="wl-date">{fmt.dayLong(day)}</span>
        <span className="sp" />
        <span className="catalog-badge" data-testid="fatto-day-count">{tr('brainPages.fatto.count', { n: rows.length })}</span>
        {rows.length > 0 && <span className="catalog-badge wl-total" data-testid="fatto-day-total" data-tip={tr('brainPages.fatto.totalTip')}>{tr('brainPages.fatto.total', { cost: cost(dayTotal(rows)) })}</span>}
      </header>
      {rows.length
        ? <ol className="wl-list" aria-label={`${tr('brainPages.fatto.log')}, ${name}`}>{rows.map(r => <Row key={r.id} r={r} title={title(r)} onChat={onChat} />)}</ol>
        : <p className="wl-empty" data-testid="fatto-day-empty"><b>{tr('brainPages.fatto.empty')}</b> {tr('brainPages.fatto.emptyHint')}</p>}
    </section>
  );
}

export function Fatto({ arg, nav }: { arg?: string; nav: Navigate }) {
  const chats = useAppChats();
  const bridge = useContext(DiscussContext);
  const [count, setCount] = useState(3);
  const today = localDay(now());
  const from = isDay(arg) && arg <= today ? arg : today;
  const days = lastDays(from, count, shiftDay);
  // the oldest day shown, and one more for the stand-up's last work day before today
  const since = new Date(`${shiftDay(days.at(-1) ?? today, -14)}T00:00:00`).getTime();
  const { rows, error, reload } = useMacroTasks(since);
  const go = (d: string) => nav(d === today ? 'fatto' : `fatto/${d}`);
  const title = (r: MacroTask): string => {
    const c = chats?.find(x => x.id === r.chatId);
    const goal = r.goal.split('\n').find(l => l.trim())?.trim() ?? '';
    return (c?.title && c.title !== 'Nuova chat' ? c.title : goal.slice(0, 120)) || roleName(r.agentId);
  };
  const byDay = (d: string) => (rows ?? []).filter(r => macroDay(r) === d);
  return (
    <section className="wl-page" aria-label={tr('brainPages.fatto.title')} data-testid="fatto-page">
      <header className="catalog-head">
        <div><h2>{tr('brainPages.fatto.title')}</h2><p>{tr('brainPages.fatto.subtitle')}</p></div>
        <button type="button" className="btn btn-ghost" onClick={reload} data-testid="fatto-refresh">{tr('brainPages.fatto.refresh')}</button>
      </header>
      <div className="catalog-filters">
        <label className="field"><span>{tr('brainPages.fatto.from')}</span>
          {/* the native field shows the OS locale's format ("10/20/2026" on an English Windows): the day is written in the
              app's language over it, a click opens the native picker (ADR 0101) */}
          <span className="wl-datefield"><span className="wl-datefield-text" aria-hidden="true">{fmt.dayFull(from)}</span>
            <input type="date" value={from} max={today} onChange={e => { if (isDay(e.target.value)) go(e.target.value); }}
              onClick={e => { try { e.currentTarget.showPicker(); } catch { /* not allowed: the field still edits */ } }} data-testid="fatto-from" /></span></label>
        <label className="field"><span>{tr('brainPages.fatto.range')}</span>
          <Select value={String(count)} onChange={e => setCount(Number(e.target.value))} data-testid="fatto-range">
            {[...new Set([...RANGES, count])].sort((a, b) => a - b).map(n => <option key={n} value={String(n)}>{n}</option>)}
          </Select></label>
        {from !== today && <button type="button" className="btn btn-ghost" onClick={() => go(today)}>{tr('brainPages.fatto.today')}</button>}
      </div>
      {from === today && rows && <Standup lines={standupLines(rows, today, title)} />}
      <div className="catalog-summary">
        <p className="catalog-count"><strong>{tr('brainPages.fatto.summary', { days: days.length })}</strong></p>
        <p className="catalog-note">{tr('brainPages.fatto.note')}</p>
      </div>
      {error && !rows && <p className="wl-empty" role="alert" data-testid="fatto-error"><b>{tr('brainPages.fatto.error')}</b> {error}</p>}
      <div className="wl-days" data-testid="fatto-log">
        {rows && days.map((d, i) => <DayCard key={d} day={d} today={today} index={i} rows={byDay(d)} title={title} onChat={bridge ? id => bridge.showChat(id) : undefined} />)}
      </div>
      {days.length > 0 && <div className="wl-more"><button type="button" className="btn btn-ghost" onClick={() => setCount(c => Math.min(60, c + 3))} data-testid="fatto-more">{tr('brainPages.fatto.more')}</button></div>}
    </section>
  );
}
