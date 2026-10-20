// Fatto: an ordered log of what was done, newest first, grouped by day, each entry with what, who, when and a link
// (issue #85, ADR 0079). Laid out like Agenti and Guida: the page head (title, subtitle, Rileggi), the toolbar (from
// which day, how many days), the summary, then one card per day with its entries; the stand-up box on today.
// Entries: lib/done-log.ts, from the brain's day reports (/api/day?kind=report&date=…: PRs, work items, diary outcomes,
// Claude and Cursor chats) merged with the app's own chats (an app chat's link opens it here, through the DiscussBridge).
// "Mostra altri giorni" adds three more days (a past day's first read can take up to 40 s: each day card loads alone).
// Used by brain/index.tsx (page 'fatto').
import { useContext, useState } from 'react';
import type { ChatSummary } from '@shared/contract';
import { normReport, normTables } from '../types';
import { useBrain } from '../api';
import { dayName, fmt, isDay, shiftDay } from '../lib/format';
import { ownerOf } from '../lib/text';
import { buildLog, lastDays, type LogEntry } from '../lib/done-log';
import { Async, NoDevops } from '../components/States';
import { Markdown } from '../components/Markdown';
import { useAppChats, useEngineLabels } from '../components/Composer';
import { DiscussContext } from '../components/Discuss';
import { ExtLink, IconExternal, type Navigate } from '../components/ui';
import { Select } from '../../components/Select';
import { Standup } from './day';
import { t as tr } from '../../i18n';
import '../../styles/agent-catalog.css';
import './worklog.css';

const RANGES = [3, 7, 14];
const TONE: Record<LogEntry['kind'], string> = { 'pr-merged': 'var(--green)', 'pr-open': 'var(--blue)', 'work-item': 'var(--amber)', done: 'var(--green)', decision: 'var(--violet)', chat: 'var(--text-3)' };

function Entry({ e, onChat }: { e: LogEntry; onChat?: (id: string) => void }) {
  return (
    <li className="wl-entry" data-kind={e.kind} style={{ ['--tone' as string]: TONE[e.kind] }} data-testid="fatto-entry">
      <time className="wl-time" dateTime={e.time ? `${e.day}T${e.time}` : e.day}>{e.time || <span className="wl-notime">{tr('brainPages.fatto.noTime')}</span>}</time>
      <span className="wl-dot" aria-hidden="true" />
      <div className="wl-body">
        <span className="wl-what">
          {e.chatId && onChat
            ? <button type="button" className="wl-link" onClick={() => onChat(e.chatId!)} aria-label={tr('brainPages.fatto.openChat', { title: e.what })}>{e.what}</button>
            : e.url ? <ExtLink href={e.url} className="wl-link" title={tr('brainPages.fatto.openLink')}>{e.what} <IconExternal /></ExtLink>
              : <span>{e.what}</span>}
        </span>
        <span className="wl-meta">
          <span className="catalog-chip wl-kind">{tr(`brainPages.fatto.kind.${e.kind}`)}{e.state ? ` · ${e.state}` : ''}</span>
          <span className="wl-who">{e.who}</span>
          {e.area && <span className="wl-area">{e.area}</span>}
        </span>
      </div>
    </li>
  );
}

function DayCard({ day, today, index, chats }: { day: string; today: string; index: number; chats: ChatSummary[] | null }) {
  const rep = useBrain(`/api/day?kind=report&date=${day}`, normReport);
  const engine = useEngineLabels();
  const bridge = useContext(DiscussContext);
  const names = { you: tr('brainPages.fatto.who.you'), claude: engine('claude'), cursor: engine('cursor') };
  const log = buildLog([day], { [day]: rep.data ?? undefined }, chats, names, engine)[0]!;
  const title = dayName(day, today);
  return (
    <section className="catalog-card wl-day" style={{ ['--row-index' as string]: index }} aria-labelledby={`wl-${day}`} data-testid={`fatto-day-${day}`}>
      <header className="wl-day-head">
        <h3 id={`wl-${day}`}>{title}</h3>
        <span className="wl-date">{fmt.dayLong(day)}</span>
        <span className="sp" />
        {rep.data && <span className="catalog-badge" data-testid="fatto-day-count">{tr('brainPages.fatto.count', { n: log.entries.length })}</span>}
      </header>
      <Async loading={rep.loading && !rep.data} error={rep.data ? null : rep.error} onRetry={() => rep.reload()} label={tr('brainPages.fatto.preparing', { isToday: day === today })} lines={3}>
        {() => (
          <>
            {rep.data?.devops === false && <NoDevops />}
            {log.entries.length
              ? <ol className="wl-list" aria-label={`${tr('brainPages.fatto.log')}, ${title}`}>{log.entries.map(e => <Entry key={e.key} e={e} onChat={bridge ? id => bridge.showChat(id) : undefined} />)}</ol>
              : <p className="wl-empty" data-testid="fatto-day-empty"><b>{tr('brainPages.fatto.empty')}</b> {tr('brainPages.fatto.emptyHint')}</p>}
            {rep.data?.text && (
              <details className="wl-detail">
                <summary>{tr('brainPages.fatto.detailTitle', { commits: rep.data.commits.length })}</summary>
                <Markdown text={rep.data.text} name={`giornata-${day}`} />
              </details>
            )}
          </>
        )}
      </Async>
    </section>
  );
}

export function Fatto({ arg, nav }: { arg?: string; nav: Navigate }) {
  const t = useBrain('/api/tables', normTables);
  const chats = useAppChats();
  const [count, setCount] = useState(3);
  const today = t.data?.today ?? '';
  const from = isDay(arg) && (!today || arg <= today) ? arg : today;
  const days = from ? lastDays(from, count, shiftDay) : [];
  const go = (d: string) => nav(d === today ? 'fatto' : `fatto/${d}`);
  return (
    <section className="wl-page" aria-label={tr('brainPages.fatto.title')} data-testid="fatto-page">
      <header className="catalog-head">
        <div><h2>{tr('brainPages.fatto.title')}</h2><p>{tr('brainPages.fatto.subtitle')}</p></div>
        <button type="button" className="btn btn-ghost" onClick={() => t.reload(true)} data-testid="fatto-refresh">{tr('brainPages.fatto.refresh')}</button>
      </header>
      <div className="catalog-filters">
        <label className="field"><span>{tr('brainPages.fatto.from')}</span>
          {/* the native field shows the OS locale's format ("10/20/2026" on an English Windows): the day is written in the
              app's language over it, a click opens the native picker (ADR 0101) */}
          <span className="wl-datefield"><span className="wl-datefield-text" aria-hidden="true">{from ? fmt.dayFull(from) : '—'}</span>
            <input type="date" value={from} max={today || undefined} onChange={e => { if (isDay(e.target.value)) go(e.target.value); }}
              onClick={e => { try { e.currentTarget.showPicker(); } catch { /* not allowed: the field still edits */ } }} data-testid="fatto-from" /></span></label>
        <label className="field"><span>{tr('brainPages.fatto.range')}</span>
          <Select value={String(count)} onChange={e => setCount(Number(e.target.value))} data-testid="fatto-range">
            {[...new Set([...RANGES, count])].sort((a, b) => a - b).map(n => <option key={n} value={String(n)}>{n}</option>)}
          </Select></label>
        {from && from !== today && <button type="button" className="btn btn-ghost" onClick={() => go(today)}>{tr('brainPages.fatto.today')}</button>}
      </div>
      {from === today && t.data && <Standup tables={t.data} owner={ownerOf(t.data.ideas)} />}
      <div className="catalog-summary">
        <p className="catalog-count"><strong>{tr('brainPages.fatto.summary', { days: days.length })}</strong></p>
        <p className="catalog-note">{tr('brainPages.fatto.note')}</p>
      </div>
      <div className="wl-days" data-testid="fatto-log">
        {today && days.map((d, i) => <DayCard key={d} day={d} today={today} index={i} chats={chats} />)}
      </div>
      {days.length > 0 && <div className="wl-more"><button type="button" className="btn btn-ghost" onClick={() => setCount(c => Math.min(60, c + 3))} data-testid="fatto-more">{tr('brainPages.fatto.more')}</button></div>}
    </section>
  );
}
