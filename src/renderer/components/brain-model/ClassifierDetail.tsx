// One classifier's detail in Qualità's Classificatori section (opened from its card, back with the button or Esc): what it
// decides, why it exists, how it works and what its numbers tell you; the key numbers with their "?"; how it is
// learning week by week (its hit measure and the verified success, one percent axis, gaps for empty weeks) and its
// decisions per week; what it decided (slices with count, success, cost and the role that ran it most); success when
// the advice that ends with an action (ADR 0101); and, under «Tipo di lavoro», the outcomes per kind. The routing
// table, its history and «Scelta del modello» left with the table (ADR 0210). Read only. Used by ClassifiersSection.tsx.
import type { ReactNode } from 'react';
import type { ClassifiersState } from '@shared/brain-model';
import { roleName } from '@shared/roles';
import { locale, t } from '../../i18n';
import { pct } from '../../lib/brain-model-view';
import { facts, hitSeries, kOfN, pctOf, sliceLabel, successSeries, usdOf, weekLabel, type CardView } from '../../lib/classifier-view';
import { BarChart, HBarChart } from '../../brain/components/Charts';
import { HelpTip } from '../HelpTip';
import { TrendChart } from './TrendChart';
import { ClsIcon, Num, ct, pctFmt, third } from './ClassifierParts';

function NoData() { return <span className="bm-nodata">{t('bm.noData')}</span>; }
function Val({ v }: { v: string | null }) { return v === null ? <NoData /> : <>{v}</>; }
function Panel({ title, lead, children, testId, help }: { title: string; lead?: string; children: ReactNode; testId: string; help?: string }) {
  return <section className="dash-panel" data-testid={testId}><header><div><h3>{title}{help && <HelpTip title={title} label={title}>{help}</HelpTip>}</h3>{lead && <p>{lead}</p>}</div></header>{children}</section>;
}

function KindTable({ state }: { state: ClassifiersState }) {
  return <Panel testId="bm-cls-kinds" title={t('bm.cls.kinds')} lead={t('bm.cls.kindsLead')}>
    {state.kinds.length ? <div className="bm-table-wrap"><table className="bm-table">
      <thead><tr><th>{t('bm.cls.col.kind')}</th><th>{t('bm.cls.col.chats')}</th><th>{t('bm.cls.col.known')}</th><th>{t('bm.cls.col.ok')}</th></tr></thead>
      <tbody>{state.kinds.map(k => <tr key={k.kind}><td><code>{k.kind}</code></td><td className="num">{k.chats}</td><td className="num">{k.known || <NoData />}</td><td className="num">{k.known ? `${k.ok} · ${pct(k.ok / k.known, locale())}` : <NoData />}</td></tr>)}</tbody>
    </table></div> : <p className="bm-empty">{t('bm.cls.kindsEmpty')}</p>}
  </Panel>;
}

export function ClassifierDetail({ c, state, onBack }: { c: CardView; state: ClassifiersState; onBack: () => void }) {
  const name = ct(c.id, 'name'), all = facts(c), k3 = third(c);
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
    <p data-testid="cls-coverage">{t('stats.cls.coverage', { n: c.success.n, total: c.decisions })}</p>
    {c.id === 'jobkind' && <p>{t('stats.cls.jobCoverage')}</p>}
    <div className="cls-summary">
      <Num label={t('stats.cls.decisions')} value={c.decisions ? c.decisions.toLocaleString(locale()) : null} help={ct(c.id, 'decisionsHelp')} />
      <Num label={ct(c.id, 'hit')} value={pctOf(c.hit)} sub={kOfN(c.hit)} help={ct(c.id, 'hitHelp')} />
      {c.id !== 'estimates' && c.id !== 'jobkind' && c.id !== 'tasks' && <Num label={t('stats.cls.success')} value={pctOf(c.success)} sub={kOfN(c.success)} help={t('stats.cls.successHelp')} />}
      <Num label={k3.label} value={k3.value} help={k3.help} />
    </div>
    <section className="dash-panel cls-facts" data-testid="cls-facts"><header><div><h3>{t('stats.cls.facts')}</h3></div></header>
      {all.length ? <ul>{all.map((f, i) => <li key={i}><span aria-hidden="true">✦</span>{f}</li>)}</ul> : <p className="bm-empty">{t('stats.cls.factsNone')}</p>}
    </section>
    {c.weeks && <div className="cls-detail-charts">
      <Panel testId="cls-learning" title={t('stats.cls.learning')} lead={t('stats.cls.learningLead')}>
        {hasWeeks ? <div className="cls-pad"><TrendChart labels={weeks.map(w => weekLabel(w.week))} label={t('stats.cls.learning')} format={pctFmt}
          series={[{ label: ct(c.id, 'hit'), values: hitSeries(weeks) }, ...(c.id === 'jobkind' ? [] : c.id === 'tasks' ? [{ label: ct('tasks', 'specific'), values: c.tasks?.specific ?? [] }] : [{ label: t('stats.cls.series.success'), values: successSeries(weeks) }])]}
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
            {c.id !== 'jobkind' && <td className="num">{s.known ? `${pct(s.ok / s.known, locale())} (${s.ok}/${s.known})` : <NoData />}</td>}
            <td className="num"><Val v={usdOf(s.avgCostUsd)} /></td>
            {c.id !== 'jobkind' && <td>{s.top ? `${roleName(s.top.key)} · ${s.top.count}` : '—'}</td>}</tr>)}</tbody>
        </table></div>
      </Panel>
    </div>}
    {c.id === 'kind' && <KindTable state={state} />}
  </div>;
}
