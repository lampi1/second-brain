// "Classificatori" (G K, ADR 0077, #84): read only, how the app chooses by itself and how it is going. Model choice:
// the routing table in force (kind → model, effort, why) with, per row, the chats it decided, the verified success
// rate and the average cost, and the table's history; the outcomes per kind of work and who chose the model (table,
// agent profile, default, the user). Agent choice: for the latest chats, the agent suggested today versus the agent
// used. Quality over time: per route and per agent-choice channel, by week. A value without data says "nessun dato
// ancora", never zero. Data: 'classifiers:state' (main/brainmodel/classifiers.ts). In the Dashboard's look
// (dashboard.css). Rendered by App.tsx PageFrame for 'classificatori'.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { ClassifiersState, RouteResult } from '@shared/brain-model';
import { locale, t } from '../../i18n';
import { sb } from '../../sb';
import { choiceMatch, noData, pct, usd } from '../../lib/brain-model-view';
import { when } from './MaintenancePanel';
import '../../dashboard/dashboard.css';
import '../../styles/brain-model.css';

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
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
function Panel({ title, lead, children, testId }: { title: string; lead?: string; children: ReactNode; testId: string }) {
  return <section className="dash-panel" data-testid={testId}><header><div><h3>{title}</h3>{lead && <p>{lead}</p>}</div></header>{children}</section>;
}

export function ClassifiersPage() {
  const [state, setState] = useState<ClassifiersState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setState(await sb.invoke('classifiers:state', undefined)); setError(null); } catch (e) { setError(errText(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const r = state?.routing;
  const qLabel = (key: string, label: string) => (key === 'agent:words' ? t('bm.cls.agentWords') : key === 'agent:hybrid' ? t('bm.cls.agentHybrid') : label);
  return <div className="dashboard bm-dash" data-testid="bm-classifiers-page">
    <header className="dash-header"><div><span className="dash-eyebrow">{t('bm.cls.eyebrow')}</span><h1>{t('bm.cls.title')}</h1><p>{t('bm.cls.lead')}</p></div>
      <button type="button" className="btn btn-ghost btn-s" onClick={() => void load()}><span aria-hidden="true">↻</span> {t('bm.cls.refresh')}</button></header>
    {error && <p role="alert" className="dash-note">{error}</p>}
    {!state && !error && <p role="status">{t('bm.loading')}</p>}
    {state && <>
      <Panel testId="bm-cls-routing" title={t('bm.cls.routing')} lead={r?.version !== null && r ? t('bm.cls.routingLead', { v: r.version ?? 0, at: at(r.appliedAt), by: r.by ?? '—' }) : undefined}>
        {r?.error && <p role="alert">{r.error}</p>}
        {r?.routes.length ? <div className="bm-table-wrap"><table className="bm-table">
          <thead><tr><th>{t('bm.cls.col.kind')}</th><th>{t('bm.cls.col.area')}</th><th>{t('bm.cls.col.model')}</th><th>{t('bm.cls.col.effort')}</th><th>{t('bm.cls.col.why')}</th><th>{t('bm.cls.col.runs')}</th><th>{t('bm.cls.col.success')}</th><th>{t('bm.cls.col.cost')}</th></tr></thead>
          <tbody>{r.routes.map((x, i) => <tr key={i} data-testid="bm-cls-route"><td><code>{x.kind}</code></td><td>{x.area ?? t('bm.cls.anyArea')}</td><td><code>{x.harness} · {x.model}</code></td><td>{x.effort ?? '—'}</td><td className="why">{x.why}</td><Result r={x.result} /></tr>)}</tbody>
        </table></div> : <p className="bm-empty">{t('bm.cls.noTable')}</p>}
        <details className="bm-history-wrap"><summary className="bm-history-sum">{t('bm.cls.history')} ({state.history.length})</summary>
          {state.history.length ? <ul className="bm-history">{state.history.slice().reverse().map((h, i) => <li key={i}><time>{at(h.at)}</time><div>{t('bm.cls.historyRow', { from: h.from === null ? '—' : String(h.from), to: h.to, by: h.by })}{h.reason && <p>{h.reason}</p>}</div></li>)}</ul> : <p className="bm-empty">{t('bm.cls.historyEmpty')}</p>}
        </details>
      </Panel>
      <Panel testId="bm-cls-kinds" title={t('bm.cls.kinds')} lead={t('bm.cls.kindsLead')}>
        {state.sources.length > 0 && <div className="bm-cls-sources" aria-label={t('bm.cls.sources')}><span className="bm-label">{t('bm.cls.sources')}</span>{state.sources.map(s => <span key={s.source} className="bm-badge">{sourceLabel(s.source)} · {t('bm.cls.runsN', { n: s.chats })}</span>)}</div>}
        {state.kinds.length ? <div className="bm-table-wrap"><table className="bm-table">
          <thead><tr><th>{t('bm.cls.col.kind')}</th><th>{t('bm.cls.col.chats')}</th><th>{t('bm.cls.col.known')}</th><th>{t('bm.cls.col.ok')}</th></tr></thead>
          <tbody>{state.kinds.map(k => <tr key={k.kind}><td><code>{k.kind}</code></td><td className="num">{k.chats}</td><td className="num">{k.known || <NoData />}</td><td className="num">{k.known ? `${k.ok} · ${pct(k.ok / k.known, locale())}` : <NoData />}</td></tr>)}</tbody>
        </table></div> : <p className="bm-empty">{t('bm.cls.kindsEmpty')}</p>}
      </Panel>
      <Panel testId="bm-cls-choices" title={t('bm.cls.choices')} lead={t('bm.cls.choicesLead')}>
        {state.choices.length ? <div className="bm-table-wrap"><table className="bm-table">
          <thead><tr><th>{t('bm.cls.col.when')}</th><th>{t('bm.cls.col.goal')}</th><th>{t('bm.cls.col.suggested')}</th><th>{t('bm.cls.col.used')}</th><th /></tr></thead>
          <tbody>{state.choices.map(c => { const m = choiceMatch(c); return <tr key={`${c.chatId}-${c.at}`} data-testid="bm-cls-choice">
            <td className="num">{when(c.at)}</td><td className="goal">{c.goal}</td>
            <td>{c.suggested ? <>{c.suggested.name} <small className="bm-nodata">{t('bm.cls.score', { n: c.suggested.score })}</small></> : '—'}</td>
            <td>{c.used.name}{c.used.score !== null && <> <small className="bm-nodata">{t('bm.cls.score', { n: c.used.score })}</small></>}{c.used.mode === 'words' || c.used.mode === 'hybrid' ? <> <small className="bm-nodata">· {t(`bm.cls.mode.${c.used.mode}`)}</small></> : null}</td>
            <td><span className="bm-match" data-match={m}>{t(`bm.cls.${m}`)}</span></td>
          </tr>; })}</tbody>
        </table></div> : <p className="bm-empty">{t('bm.cls.choicesEmpty')}</p>}
      </Panel>
      <Panel testId="bm-cls-quality" title={t('bm.cls.quality')} lead={t('bm.cls.qualityLead')}>
        {state.quality.length ? <div className="bm-table-wrap"><table className="bm-table">
          <thead><tr><th>{t('bm.cls.col.route')}</th>{state.quality[0]!.weeks.map(w => <th key={w.week} className="num">{w.week}</th>)}</tr></thead>
          <tbody>{state.quality.map(q => <tr key={q.key} data-nodata={noData(q.weeks)}><td>{qLabel(q.key, q.label)}{noData(q.weeks) && <> <NoData /></>}</td>
            {q.weeks.map(w => <td key={w.week} className="num">{w.runs ? <span className="bm-week"><span>{w.success === null ? <NoData /> : pct(w.success, locale())}</span><small>{t('bm.cls.runsN', { n: w.runs })}{w.avgCostUsd !== null ? ` · ${usd(w.avgCostUsd, locale())}` : ''}</small></span> : <span aria-label={t('bm.noData')} className="bm-nodata">—</span>}</td>)}</tr>)}</tbody>
        </table></div> : <p className="bm-empty">{t('bm.noData')}</p>}
      </Panel>
    </>}
  </div>;
}
