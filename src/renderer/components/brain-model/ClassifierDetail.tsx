// One classifier's detail on the Classificatori page (opened from its card, back with the button or Esc): what it
// decides, why it exists, how it works and what its numbers tell you; the key numbers with their "?"; how it is
// learning week by week (its hit measure and the verified success, one percent axis, gaps for empty weeks) and its
// decisions per week; what it decided (slices with count, success, cost and the role that ran it most); success when
// it hit versus when it missed; every curious fact; and the tables of before, each under its classifier: the routing
// table with its history, who chose the model and the quality by week (Scelta del modello), the outcomes per kind
// (Tipo di lavoro), the skill choices (Skill per un compito). Read only. Used by ClassifiersPage.tsx.
import type { ReactNode } from 'react';
import type { ClassifiersState, RouteResult } from '@shared/brain-model';
import { roleName } from '@shared/roles';
import { locale, t } from '../../i18n';
import { choiceMatch, noData, pct, usd } from '../../lib/brain-model-view';
import { facts, hitSeries, pctOf, sliceLabel, successSeries, usdOf, weekLabel, type CardView } from '../../lib/classifier-view';
import { BarChart, HBarChart } from '../../brain/components/Charts';
import { HelpTip } from '../HelpTip';
import { when } from './MaintenancePanel';
import { TrendChart } from './TrendChart';
import { ClsIcon, Num, Progress, ct, pctFmt, third } from './ClassifierParts';

const SOURCES = ['table', 'agent', 'default', 'override', 'explore'] as const;
const sourceLabel = (s: string) => ((SOURCES as readonly string[]).includes(s) ? t(`bm.cls.source.${s as (typeof SOURCES)[number]}`) : s);
const at = (iso: string | null) => (iso ? when(Date.parse(iso)) : '—');
function NoData() { return <span className="bm-nodata">{t('bm.noData')}</span>; }
function Val({ v }: { v: string | null }) { return v === null ? <NoData /> : <>{v}</>; }
function Result({ r }: { r: RouteResult }) {
  return <>
    <td className="num">{r.runs || <NoData />}</td>
    <td className="num">{r.success.value === null ? <NoData /> : <span title={t('bm.cls.runsN', { n: r.success.n })}>{pct(r.success.value, locale())} <small className="bm-nodata">({r.success.n})</small></span>}</td>
    <td className="num"><Val v={usd(r.avgCostUsd, locale())} /></td>
  </>;
}
function Panel({ title, lead, children, testId, help }: { title: string; lead?: string; children: ReactNode; testId: string; help?: string }) {
  return <section className="dash-panel" data-testid={testId}><header><div><h3>{title}{help && <HelpTip title={title} label={title}>{help}</HelpTip>}</h3>{lead && <p>{lead}</p>}</div></header>{children}</section>;
}

/** The routing table, its history, who chose the model and the quality by week (the page's tables of before). */
function ModelTables({ state }: { state: ClassifiersState }) {
  const r = state.routing;
  return <>
    <Panel testId="bm-cls-routing" title={t('bm.cls.routing')} lead={r.version !== null ? t('bm.cls.routingLead', { v: r.version ?? 0, at: at(r.appliedAt), by: r.by ?? '—' }) : undefined}>
      {r.error && <p role="alert">{r.error}</p>}
      {state.sources.length > 0 && <div className="bm-cls-sources" aria-label={t('bm.cls.sources')}><span className="bm-label">{t('bm.cls.sources')}</span>{state.sources.map(s => <span key={s.source} className="bm-badge">{sourceLabel(s.source)} · {t('bm.cls.runsN', { n: s.chats })}</span>)}</div>}
      {r.routes.length ? <div className="bm-table-wrap"><table className="bm-table">
        <thead><tr><th>{t('bm.cls.col.kind')}</th><th>{t('bm.cls.col.area')}</th><th>{t('bm.cls.col.model')}</th><th>{t('bm.cls.col.effort')}</th><th>{t('bm.cls.col.why')}</th><th>{t('bm.cls.col.runs')}</th><th>{t('bm.cls.col.success')}</th><th>{t('bm.cls.col.cost')}</th></tr></thead>
        <tbody>{r.routes.map((x, i) => <tr key={i} data-testid="bm-cls-route"><td className="kind"><code>{x.kind}</code></td><td>{x.area ?? t('bm.cls.anyArea')}</td><td className="model"><code title={x.harness}>{x.model}</code></td><td>{x.effort ?? '—'}</td><td className="why">{x.why}</td><Result r={x.result} /></tr>)}</tbody>
      </table></div> : <p className="bm-empty">{t('bm.cls.noTable')}</p>}
      <details className="bm-history-wrap"><summary className="bm-history-sum">{t('bm.cls.history')} ({state.history.length})</summary>
        {state.history.length ? <ul className="bm-history">{state.history.slice().reverse().map((h, i) => <li key={i}><time>{at(h.at)}</time><div>{t('bm.cls.historyRow', { from: h.from === null ? '—' : String(h.from), to: h.to, by: h.by })}{h.reason && <p>{h.reason}</p>}</div></li>)}</ul> : <p className="bm-empty">{t('bm.cls.historyEmpty')}</p>}
      </details>
    </Panel>
    <Panel testId="bm-cls-quality" title={t('bm.cls.quality')} lead={t('bm.cls.qualityLead')}>
      {state.quality.length ? <div className="bm-table-wrap"><table className="bm-table">
        <thead><tr><th>{t('bm.cls.col.route')}</th>{state.quality[0]!.weeks.map(w => <th key={w.week} className="num">{w.week}</th>)}</tr></thead>
        <tbody>{state.quality.map(q => <tr key={q.key} data-nodata={noData(q.weeks)}><td>{q.label}{noData(q.weeks) && <> <NoData /></>}</td>
          {q.weeks.map(w => <td key={w.week} className="num">{w.runs ? <span className="bm-week"><span>{w.success === null ? <NoData /> : pct(w.success, locale())}</span><small>{t('bm.cls.runsN', { n: w.runs })}{w.avgCostUsd !== null ? ` · ${usd(w.avgCostUsd, locale())}` : ''}</small></span> : <span aria-label={t('bm.noData')} className="bm-nodata">—</span>}</td>)}</tr>)}</tbody>
      </table></div> : <p className="bm-empty">{t('bm.noData')}</p>}
    </Panel>
  </>;
}
function KindTable({ state }: { state: ClassifiersState }) {
  return <Panel testId="bm-cls-kinds" title={t('bm.cls.kinds')} lead={t('bm.cls.kindsLead')}>
    {state.kinds.length ? <div className="bm-table-wrap"><table className="bm-table">
      <thead><tr><th>{t('bm.cls.col.kind')}</th><th>{t('bm.cls.col.chats')}</th><th>{t('bm.cls.col.known')}</th><th>{t('bm.cls.col.ok')}</th></tr></thead>
      <tbody>{state.kinds.map(k => <tr key={k.kind}><td><code>{k.kind}</code></td><td className="num">{k.chats}</td><td className="num">{k.known || <NoData />}</td><td className="num">{k.known ? `${k.ok} · ${pct(k.ok / k.known, locale())}` : <NoData />}</td></tr>)}</tbody>
    </table></div> : <p className="bm-empty">{t('bm.cls.kindsEmpty')}</p>}
  </Panel>;
}
function SkillChoices({ state }: { state: ClassifiersState }) {
  return <Panel testId="bm-cls-choices" title={t('bm.cls.choices')} lead={t('bm.cls.choicesLead')}>
    {state.choices.length ? <div className="bm-table-wrap"><table className="bm-table">
      <thead><tr><th>{t('bm.cls.col.when')}</th><th>{t('bm.cls.col.goal')}</th><th>{t('bm.cls.col.role')}</th><th>{t('bm.cls.col.suggested')}</th><th>{t('bm.cls.col.used')}</th><th /></tr></thead>
      <tbody>{state.choices.map(c => { const m = choiceMatch(c); return <tr key={`${c.chatId}-${c.at}`} data-testid="bm-cls-choice">
        <td className="num">{when(c.at)}</td><td className="goal">{c.goal}</td><td>{c.role.name}</td>
        <td>{c.suggested.length ? c.suggested.join(', ') : '—'}</td><td>{c.used.length ? c.used.join(', ') : '—'}</td>
        <td><span className="bm-match" data-match={m}>{t(`bm.cls.${m}`)}</span></td>
      </tr>; })}</tbody>
    </table></div> : <p className="bm-empty">{t('bm.cls.choicesEmpty')}</p>}
  </Panel>;
}

export function ClassifierDetail({ c, state, onBack }: { c: CardView; state: ClassifiersState; onBack: () => void }) {
  const name = ct(c.id, 'name'), all = facts(c, state.sources), k3 = third(c);
  const weeks = c.weeks ?? [];
  const hasWeeks = weeks.some(w => w.decisions);
  const slices = c.slices.slice(0, 10);
  return <div className="cls-detail" data-testid={`cls-detail-${c.id}`}>
    <button type="button" className="btn btn-subtle btn-s cls-back" onClick={onBack} data-testid="cls-back"><span aria-hidden="true">←</span> {t('stats.cls.back')}</button>
    <header className="cls-detail-head" data-id={c.id}><ClsIcon id={c.id} /><div><h2>{name}</h2><p>{ct(c.id, 'decides')}</p></div></header>
    <div className="cls-explain">
      <div><span className="bm-label">{t('stats.cls.why')}</span><p>{ct(c.id, 'why')}</p></div>
      <div><span className="bm-label">{t('stats.cls.how')}</span><p>{ct(c.id, 'how')}</p></div>
      <div><span className="bm-label">{t('stats.cls.use')}</span><p>{ct(c.id, 'use')}</p></div>
    </div>
    <div className="cls-summary">
      <Num label={t('stats.cls.decisions')} value={c.decisions ? c.decisions.toLocaleString(locale()) : null} help={ct(c.id, 'decisionsHelp')} />
      <Num label={ct(c.id, 'hit')} value={pctOf(c.hit)} sub={t('stats.cls.n', { n: c.hit.n })} help={ct(c.id, 'hitHelp')} />
      {c.id !== 'estimates' && c.id !== 'jobkind' && <Num label={t('stats.cls.success')} value={pctOf(c.success)} sub={t('stats.cls.n', { n: c.success.n })} help={t('stats.cls.successHelp')} />}
      <Num label={k3.label} value={k3.value} help={k3.help} />
      {c.id === 'skills' && <Num label={t('stats.cls.threshold')} value={c.threshold === null ? null : String(c.threshold)} help={t('stats.cls.thresholdHelp')} />}
    </div>
    <section className="dash-panel cls-facts" data-testid="cls-facts"><header><div><h3>{t('stats.cls.facts')}</h3></div></header>
      {all.length ? <ul>{all.map((f, i) => <li key={i}><span aria-hidden="true">✦</span>{f}</li>)}</ul> : <p className="bm-empty">{t('stats.cls.factsNone')}</p>}
      <div className="cls-facts-progress"><Progress c={c} /></div>
    </section>
    {c.weeks && <div className="cls-detail-charts">
      <Panel testId="cls-learning" title={t('stats.cls.learning')} lead={t('stats.cls.learningLead')}>
        {hasWeeks ? <div className="cls-pad"><TrendChart labels={weeks.map(w => weekLabel(w.week))} label={t('stats.cls.learning')} format={pctFmt}
          series={[{ label: ct(c.id, 'hit'), values: hitSeries(weeks) }, ...(c.id === 'jobkind' ? [] : [{ label: t('stats.cls.series.success'), values: successSeries(weeks) }])]}
          extra={i => `${t('stats.cls.decisions')}: ${weeks[i]!.decisions}`} /></div> : <p className="bm-empty">{t('stats.cls.chartEmpty')}</p>}
      </Panel>
      {hasWeeks && <BarChart title={t('stats.cls.perWeek')} name={`${c.id}-per-week`} labels={weeks.map(w => weekLabel(w.week))} values={weeks.map(w => w.decisions)} highlight={weeks.length - 1} testId="cls-per-week" />}
    </div>}
    {c.id === 'estimates' && c.spark.length > 1 && <Panel testId="cls-spark" title={t('stats.cls.sparkTitle')} lead={t('stats.cls.sparkLead')}>
      <div className="cls-pad"><TrendChart labels={c.spark.map((_, i) => `#${i + 1}`)} series={[{ label: ct('estimates', 'typical'), values: c.spark, slot: 3 }]} max={Math.max(2, ...c.spark)} format={v => `×${v.toFixed(1)}`} label={t('stats.cls.sparkTitle')} /></div>
    </Panel>}
    {slices.length > 0 && <div className="cls-detail-charts">
      <HBarChart title={t('stats.cls.slices')} name={`${c.id}-slices`} labels={slices.map(s => sliceLabel(c.id, s.key))} series={[{ label: t('stats.cls.col.count'), values: slices.map(s => s.count) }]} categorical={false} testId="cls-slices-chart" />
      <Panel testId="cls-slices" title={t('stats.cls.slices')} lead={t('stats.cls.slicesLead')}>
        <div className="bm-table-wrap"><table className="bm-table">
          <thead><tr><th>{t('stats.cls.col.value')}</th><th className="num">{t('stats.cls.col.count')}</th>{c.id !== 'jobkind' && <th className="num">{t('stats.cls.col.success')}</th>}<th className="num">{t('stats.cls.col.cost')}</th>{c.id !== 'jobkind' && <th>{t('stats.cls.col.top')}</th>}</tr></thead>
          <tbody>{slices.map(s => <tr key={s.key}><td>{sliceLabel(c.id, s.key)}</td><td className="num">{s.count}</td>
            {c.id !== 'jobkind' && <td className="num">{s.known ? `${pct(s.ok / s.known, locale())} (${s.known})` : <NoData />}</td>}
            <td className="num"><Val v={usdOf(s.avgCostUsd)} /></td>
            {c.id !== 'jobkind' && <td>{s.top ? `${roleName(s.top.key)} · ${s.top.count}` : '—'}</td>}</tr>)}</tbody>
        </table></div>
      </Panel>
    </div>}
    {c.compare && <Panel testId="cls-compare" title={t('stats.cls.compare')} help={t('stats.cls.compareHelp')}>
      <div className="cls-compare">
        {([['hit', c.compare.hit], ['miss', c.compare.miss]] as const).map(([k, s]) => <div key={k} data-side={k}>
          <span>{k === 'hit' ? t('stats.cls.compareHit') : t('stats.cls.compareMiss')}</span>
          <strong>{pctOf(s) ?? t('stats.cls.noData')}</strong><small>{t('stats.cls.n', { n: s.n })}</small>
          <div className="cls-meter"><i style={{ width: `${Math.round((s.value ?? 0) * 100)}%` }} /></div>
        </div>)}
      </div>
    </Panel>}
    {c.id === 'model' && <ModelTables state={state} />}
    {c.id === 'kind' && <KindTable state={state} />}
    {c.id === 'skills' && <SkillChoices state={state} />}
  </div>;
}
