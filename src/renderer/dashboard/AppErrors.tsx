// The app's and the tools' own errors on Qualità (once the Dashboard's Errori tab; ADR 0122: the AI errors the user
// corrected are Qualità's «errori che si ripetono», so only what Qualità lacked moved there). Two numbers with a "?"
// each (recurring errors, error events of this session), a row of curious facts, then the recurring app and tool errors
// as cards (cause in plain words, how many times, a 14-day trend, last seen, where: chat, role and skills in use, one
// example, what it means and what to do). It says what will appear when there is nothing yet. Grouping and causes:
// errors.ts; live from the app's chats, their items and the feed. Styles: styles/classifiers.css (err-*).
import { useEffect, useMemo } from 'react';
import { goTarget } from '../actions';
import { HelpTip } from '../components/HelpTip';
import { locale, t } from '../i18n';
import { observedErrors } from './data';
import { loadClosedErrors, useApp } from '../store/store';
import { now as clockNow } from '../lib/clock';
import { Discuss, Empty, Panel, Stat } from './parts';
import { groupErrors, trendOf, type Cause } from './errors';
import '../styles/classifiers.css';


const cause = (c: Cause, what: 't' | 'w' | 'f') => t(`stats.cause.${c}.${what}` as Parameters<typeof t>[0]);
const num = (v: number) => new Intl.NumberFormat(locale()).format(v);
const pctFmt = (v: number) => new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 0 }).format(v);
const whenShort = (ms: number) => new Date(ms).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' });

function Days({ days, label }: { days: number[]; label: string }) {
  const max = Math.max(1, ...days);
  return <div className="err-days" role="img" aria-label={label}>{days.map((d, i) => <i key={i} data-on={d > 0} style={{ height: `${Math.max(8, (d / max) * 100)}%` }} title={String(d)} />)}</div>;
}
function Trend({ days }: { days: number[] }) {
  const tr = trendOf(days);
  return <span className="bm-badge err-trend" data-trend={tr}>{t(`stats.err.trend.${tr}`)}<HelpTip title={t(`stats.err.trend.${tr}`)} label={t(`stats.err.trend.${tr}`)} guide="errors-rules">{t('stats.err.trendHelp')}</HelpTip></span>;
}

export function AppErrors() {
  const chats = useApp(s => s.chats), items = useApp(s => s.items), closedErrors = useApp(s => s.closedErrors), feed = useApp(s => s.feed);
  // closed chats keep only their error items (store/state.ts closedErrors); those closed in an earlier run are read once
  useEffect(() => { void loadClosedErrors(); }, []);
  const errors = useMemo(() => observedErrors(Object.values(chats), { ...closedErrors, ...items }, feed, t('brainText.dash.turnError')), [chats, items, closedErrors, feed]);
  const groups = groupErrors(errors, clockNow());
  const recurring = groups.filter(g => g.count > 1);
  const facts: string[] = [];
  const top = groups[0];
  if (top && errors.length >= 3 && top.count / errors.length >= 0.4) facts.push(t('stats.err.factWorst', { pct: pctFmt(top.count / errors.length), what: cause(top.cause, 't').toLowerCase() }));
  return <section className="bx-section mh-app-errors" data-testid="err-app">
    <div className="dash-stats mh-stats-2">
      <Stat label={t('stats.err.recurring')} value={num(recurring.length)} n={recurring.length} format={num} note={t('stats.err.recurringNote')} help={t('stats.err.recurringHelp')} />
      <Stat label={t('stats.err.events')} value={num(errors.length)} n={errors.length} format={num} note={t('stats.err.eventsNote')} help={t('stats.err.eventsHelp')} />
    </div>
    {facts.length > 0 && <div className="err-facts" data-testid="err-facts">{facts.map((f, i) => <p className="err-fact" key={i}><span aria-hidden="true">✦</span><span>{f}</span></p>)}</div>}
    <Panel title={t('stats.err.groups')} note={t('stats.err.groupsLead')} facts={groups.map(g => `${cause(g.cause, 't')}: ${g.count}× (${g.sample})`).join('\n')} source="feed · chat:items">
      {groups.length ? <div className="err-grid" data-testid="err-groups">{groups.slice(0, 12).map(g => <article className="err-card" key={g.key} data-cause={g.cause} data-testid="err-group">
        <div className="err-head"><h4>{g.cause === 'other' && g.title ? g.title : cause(g.cause, 't')}</h4><span className="err-count" aria-label={t('stats.err.times', { n: g.count })}>{g.count}×</span></div>
        <div className="err-meta"><Trend days={g.days} /><span>{t('stats.err.last', { at: whenShort(g.lastAt) })}</span></div>
        <Days days={g.days} label={t('stats.err.trendHelp')} />
        <p className="err-sample" title={g.sample}>{g.sample}</p>
        <dl className="err-dl">
          {(g.roles.length > 0 || g.chats.length > 0) && <div><dt>{t('stats.err.where')}</dt><dd>{[...g.roles, ...g.chats.filter(c => !g.roles.includes(c))].slice(0, 4).join(', ')}</dd></div>}
          {g.skills.length > 0 && <div><dt>{t('stats.err.skills')}</dt><dd>{g.skills.slice(0, 4).join(', ')}</dd></div>}
          <div><dt>{t('stats.err.what')}</dt><dd>{cause(g.cause, 'w')}</dd></div>
          <div><dt>{t('stats.err.todo')}</dt><dd className="todo">{cause(g.cause, 'f')}</dd></div>
        </dl>
        <div className="err-foot"><small className="err-first">{t('stats.err.first', { at: whenShort(g.firstAt) })}</small><Discuss title={cause(g.cause, 't')} facts={`${g.count}×, ${t('stats.err.last', { at: whenShort(g.lastAt) })}\n${g.sample}\n${g.chats.join(', ')}`} source="feed · chat:items" /></div>
      </article>)}</div> : <Empty>{t('stats.err.groupsEmpty')}</Empty>}
    </Panel>
    <p className="dash-note">{t('stats.err.memory')} <button type="button" className="link-btn" onClick={() => goTarget('memoria/file')}>{t('stats.err.openMemory')}</button></p>
  </section>;
}
