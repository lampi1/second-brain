// A role's results by model (ADR 0284), on its page in Agent Studio: one row per model its runs used, with the runs,
// the performance (the same estimate as the card's, started from the role's on its other models) and its ±, what one verified success
// cost (marked «stima» when part of it is list price × tokens) and the median working time. The level is the role's
// and does not change with the model; the performance is the model's. Data: AgentStanding.models (main/agents/
// standing.ts), read with the role's metrics; only the runs still kept whole. Used by AgentStudio.tsx.
import type { AgentStanding } from '../../shared/agents';
import { locale, t } from '../i18n';
import { formatCost, minutes, prettyModel } from '../lib/format';

const percent = (v: number) => new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 0 }).format(v);

export function ModelStandings({ id, standing, inUse }: { id: string; standing: AgentStanding | null | undefined; inUse: string | null }) {
  const rows = standing?.models ?? [];
  if (!rows.length) return null;
  // a role on its level's model names none: the row of its latest run is then marked «ultimo usato»
  const last = inUse === null ? rows.reduce((a, b) => b.lastAt > a.lastAt ? b : a).model : null;
  return <section className="ad-card" aria-labelledby={`ad-models-${id}`} data-testid="agent-models">
    <header className="ad-card-head"><h3 id={`ad-models-${id}`}>{t('studio.models')}</h3></header>
    <p className="ad-hint">{t('studio.modelsHint')}</p>
    <table className="ad-models">
      <thead><tr><th scope="col">{t('studio.modelsModel')}</th><th scope="col">{t('studio.modelsRuns')}</th><th scope="col">{t('studio.modelsPerf')}</th>
        <th scope="col">{t('studio.modelsCost')}</th><th scope="col">{t('studio.modelsTime')}</th></tr></thead>
      <tbody>{rows.map(m => <tr key={m.model} data-testid={`agent-model-${m.model}`}>
        <th scope="row" title={m.model}>{prettyModel(m.model)}{inUse === m.model ? <span className="ad-chip">{t('studio.modelsInUse')}</span> : last === m.model && <span className="ad-chip">{t('studio.modelsLast')}</span>}</th>
        <td>{m.runs.toLocaleString(locale())}</td>
        <td>{m.performance !== null && m.spread !== null
          ? <><b>{percent(m.performance)}</b> <small>{t('studio.modelsSpread', { v: Math.round(m.spread * 100), n: m.evaluated })}</small></>
          : <small>{m.evaluated < m.minRuns ? t('studio.modelsFew', { n: m.evaluated, min: m.minRuns }) : t('studio.modelsWarming')}</small>}</td>
        <td>{m.costPerWin !== null ? <>{m.costEstimated && '≈ '}{formatCost(m.costPerWin)}{m.costEstimated && <small> {t('studio.modelsEstimate')}</small>}</>
          : <small>{m.unpriced > 0 ? t('studio.modelsUnpriced') : '—'}</small>}</td>
        <td>{m.medianMs !== null ? minutes(m.medianMs) : '—'}</td>
      </tr>)}</tbody>
    </table>
  </section>;
}
