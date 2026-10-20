// The Dashboard's Errori tab, redesigned (owner, 2026-10-19: "la parte delle statistiche errori proprio non ci siamo,
// non si capisce nulla"). Four numbers with a "?" each (recurring errors, error events, AI errors corrected, days
// without errors), a row of curious facts from the data, then the recurring app and tool errors as cards (cause in
// plain words, how many times, a 14-day trend, last seen, where: chat, role and skills in use, one example, what it
// means and what to do) and the AI errors the user corrected, grouped by type (who, area, what it said and what was
// true, the rule it produced and whether the error came back after it), with their per-day chart. Every view says
// what will appear when there is nothing yet. Grouping and causes: errors.ts. The Dashboard passes its Panel, Empty,
// Source, Stat and Discuss (no import cycle). Styles: styles/classifiers.css (err-*).
import type { ReactNode } from 'react';
import { goTarget } from '../actions';
import type { Loaded } from '../brain/api';
import type { Tables } from '../brain/types';
import { BarChart } from '../brain/components/Charts';
import { HelpTip } from '../components/HelpTip';
import { locale, t } from '../i18n';
import type { ObservedError } from './data';
import { groupAiErrors, groupErrors, trendOf, type Cause } from './errors';
import '../styles/classifiers.css';

export interface ErrorsUi {
  Panel: (p: { title: string; note?: string; children: ReactNode; facts?: string; source?: string }) => ReactNode;
  Empty: (p: { children: ReactNode }) => ReactNode;
  Source: (p: { data: Loaded<unknown>; name?: string }) => ReactNode;
  Stat: (p: { label: string; value: string; note: string; n?: number; format?: (n: number) => string; help?: string }) => ReactNode;
  Discuss: (p: { title: string; facts: string; source: string }) => ReactNode;
}

const cause = (c: Cause, what: 't' | 'w' | 'f') => t(`stats.cause.${c}.${what}` as Parameters<typeof t>[0]);
const num = (v: number) => new Intl.NumberFormat(locale()).format(v);
const pctFmt = (v: number) => new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 0 }).format(v);
const whenShort = (ms: number) => new Date(ms).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' });
const dayLabel = (iso: string) => { const d = new Date(`${iso}T12:00:00Z`); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(locale(), { day: '2-digit', month: '2-digit' }); };

function Days({ days, label }: { days: number[]; label: string }) {
  const max = Math.max(1, ...days);
  return <div className="err-days" role="img" aria-label={label}>{days.map((d, i) => <i key={i} data-on={d > 0} style={{ height: `${Math.max(8, (d / max) * 100)}%` }} title={String(d)} />)}</div>;
}
function Trend({ days }: { days: number[] }) {
  const tr = trendOf(days);
  return <span className="bm-badge err-trend" data-trend={tr}>{t(`stats.err.trend.${tr}`)}<HelpTip title={t(`stats.err.trend.${tr}`)} label={t(`stats.err.trend.${tr}`)} guide="errors-rules">{t('stats.err.trendHelp')}</HelpTip></span>;
}

export function ErrorsTab({ ui, tables, errors, now }: { ui: ErrorsUi; tables: Loaded<Tables>; errors: ObservedError[]; now: number }) {
  const { Panel, Empty, Source, Stat, Discuss } = ui;
  const groups = groupErrors(errors, now);
  const recurring = groups.filter(g => g.count > 1);
  const ai = tables.data ? groupAiErrors(tables.data.errors, tables.data.today, tables.data.quality, 14, t('stats.err.untyped')) : [];
  // AI errors per day, the last 14 days (a day without errors is a real zero: the file is complete)
  const today = tables.data?.today ?? '';
  const axis = Array.from({ length: 14 }, (_, i) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - (13 - i)); return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10); });
  const perDay = axis.map(d => (tables.data?.errors ?? []).filter(e => e.data === d).length);
  const facts: string[] = [];
  const top = groups[0];
  if (top && errors.length >= 3 && top.count / errors.length >= 0.4) facts.push(t('stats.err.factWorst', { pct: pctFmt(top.count / errors.length), what: cause(top.cause, 't').toLowerCase() }));
  if (ai[0] && ai[0].count >= 2) facts.push(t('stats.err.factAiTop', { type: ai[0].type, n: ai[0].count }));
  const back = ai.filter(g => g.status === 'tornato').length, held = ai.filter(g => g.status === 'non-tornato').length;
  if (back) facts.push(t('stats.err.factBack', { n: back }));
  if (held) facts.push(t('stats.err.factHeld', { n: held }));

  return <>
    <Source data={tables} />
    {/* no "Giorni senza errori": a streak, not a measure that leads to an action (ADR 0101) */}
    <div className="dash-stats">
      <Stat label={t('stats.err.recurring')} value={num(recurring.length)} n={recurring.length} format={num} note={t('stats.err.recurringNote')} help={t('stats.err.recurringHelp')} />
      <Stat label={t('stats.err.events')} value={num(errors.length)} n={errors.length} format={num} note={t('stats.err.eventsNote')} help={t('stats.err.eventsHelp')} />
      <Stat label={t('stats.err.ai')} value={tables.data ? num(tables.data.errors.length) : '—'} n={tables.data?.errors.length} format={num} note="ai-errors.md" help={t('stats.err.aiHelp')} />
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
    <Panel title={t('stats.err.aiGroups')} note={t('stats.err.aiGroupsLead')} facts={ai.map(g => `${g.type}: ${g.count}; ${g.rule}`).join('\n')} source="ai-errors.md">
      {ai.length ? <div className="err-grid" data-testid="err-ai-groups">{ai.slice(0, 9).map(g => <article className="err-card" key={g.type} data-ai="true" data-testid="err-ai-group">
        <div className="err-head"><h4>{g.type}</h4><span className="err-count" aria-label={t('stats.err.times', { n: g.count })}>{g.count}×</span></div>
        <div className="err-meta"><Trend days={g.days} />{g.status && <span className="bm-badge" data-tone={g.status === 'tornato' ? 'amber' : g.status === 'non-tornato' ? 'green' : 'muted'}>{t(`stats.err.status.${g.status}` as Parameters<typeof t>[0])}<HelpTip title={t('stats.err.rule')} label={t('stats.err.rule')}>{t('stats.err.statusHelp')}</HelpTip></span>}<span>{dayLabel(g.last)}</span></div>
        <Days days={g.days} label={t('stats.err.trendHelp')} />
        <dl className="err-dl">
          {(g.who.length > 0 || g.areas.length > 0) && <div><dt>{t('stats.err.where')}</dt><dd>{[...g.who, ...g.areas].slice(0, 5).join(', ')}</dd></div>}
          {g.said && <div><dt>{t('stats.err.said')}</dt><dd>{g.said}</dd></div>}
          {g.truth && <div><dt>{t('stats.err.truth')}</dt><dd className="todo">{g.truth}</dd></div>}
          {g.rule && <div><dt>{t('stats.err.rule')}</dt><dd>{g.rule}</dd></div>}
        </dl>
      </article>)}</div> : <Empty>{t('stats.err.aiEmpty')}</Empty>}
    </Panel>
    {tables.data && tables.data.errors.length > 0 && <BarChart title={t('stats.err.byDay')} name="ai-errors-by-day" labels={axis.map(dayLabel)} values={perDay} highlight={13} testId="err-by-day" />}
    <p className="dash-note">{t('stats.err.memory')} <button type="button" className="link-btn" onClick={() => goTarget('memoria')}>{t('stats.err.openMemory')}</button></p>
  </>;
}
