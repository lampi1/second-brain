// Cross-session agent costs and observed timing for Costi. Uses event-backed analytics without filling missing
// history, blending charge/list-price/estimate measures, or ranking agents across incomparable work samples.
import type { AgentAnalyticsData, AgentMeasure, AgentTimingKind } from '@shared/agent-analytics';
import { lang, locale } from '../../i18n';
import { formatCost } from '../../lib/format';
import { useBrain } from '../api';
import { Loading } from './States';
import { Section } from './ui';

const words = {
  it: {
    title: 'Per agente · tutte le sessioni osservate', refresh: 'Aggiorna', loading: 'Leggo le osservazioni degli agenti…',
    scope: 'Storico osservato, indipendente dal periodo sopra. Lo storico mancante non è disponibile.',
    empty: 'Nessuna sessione attribuita a un agente. I dati compariranno dalle nuove chat con agente assegnato.',
    unavailable: 'non disponibile', sessions: 'sessioni', revisions: 'revisioni',
    actualUsd: 'Costo rilevato ($)', listPriceUsd: 'Equivalente di listino ($)', estimatedUsd: 'Stima calibrata ($)',
    costsNote: 'Misure separate: non si sommano. Il listino non è una fattura. I subtotali coprono solo le sessioni note; i costi inclusi nei totali di un antenato sono esclusi dai discendenti.',
    total: 'totale', subtotal: 'subtotale noto', known: 'note', missing: 'non disponibili',
    timing: 'Tempi osservati', complete: 'sessioni con tempi completi', incomplete: 'sessioni con tempi incompleti',
    median: 'mediana', partial: 'osservato nelle sessioni incomplete', elapsed: 'Tempo trascorso',
    execution: 'Esecuzione', 'user-wait': 'Attesa utente', 'permission-wait': 'Attesa permessi', queue: 'Coda', unknown: 'Non classificato',
    cohorts: 'Campioni confrontabili', cohortNote: 'Solo sessioni concluse con tempi completi e tipo di lavoro, motore, modello e impegno osservati. Confrontare solo gruppi con le stesse condizioni; nessuna classifica di velocità.',
    noCohorts: 'Campioni confrontabili non disponibili.', task: 'Tipo di lavoro', model: 'Motore / modello / impegno', samples: 'Campioni',
    executionMedian: 'Mediana esecuzione', elapsedMedian: 'Mediana trascorsa', agent: 'Agente / revisione',
    error: 'Impossibile aggiornare le osservazioni degli agenti',
  },
  en: {
    title: 'By agent · all observed sessions', refresh: 'Refresh', loading: 'Reading agent observations…',
    scope: 'Observed history, independent of the period above. Missing history is unavailable.',
    empty: 'No sessions attributed to an agent. Data will appear from new chats with an assigned agent.',
    unavailable: 'unavailable', sessions: 'sessions', revisions: 'revisions',
    actualUsd: 'Reported cost ($)', listPriceUsd: 'List-price equivalent ($)', estimatedUsd: 'Calibrated estimate ($)',
    costsNote: 'Separate measures: do not add them together. List price is not an invoice. Subtotals cover known sessions only; costs included in ancestor totals are withheld from descendants.',
    total: 'total', subtotal: 'known subtotal', known: 'known', missing: 'unavailable',
    timing: 'Observed timing', complete: 'sessions with complete timing', incomplete: 'sessions with incomplete timing',
    median: 'median', partial: 'observed in incomplete sessions', elapsed: 'Elapsed time',
    execution: 'Execution', 'user-wait': 'User wait', 'permission-wait': 'Permission wait', queue: 'Queue', unknown: 'Unclassified',
    cohorts: 'Comparable samples', cohortNote: 'Only completed sessions with complete timing and observed task type, engine, model and effort. Compare groups only under matching conditions; no speed ranking.',
    noCohorts: 'Comparable samples unavailable.', task: 'Task type', model: 'Engine / model / effort', samples: 'Samples',
    executionMedian: 'Execution median', elapsedMedian: 'Elapsed median', agent: 'Agent / revision',
    error: 'Unable to update agent observations',
  },
};
const timingKinds: AgentTimingKind[] = ['execution', 'user-wait', 'permission-wait', 'queue', 'unknown'];
const costKinds = ['actualUsd', 'listPriceUsd', 'estimatedUsd'] as const;
const normalize = (value: unknown) => value as AgentAnalyticsData;
const number = (value: number) => value.toLocaleString(locale(), { maximumFractionDigits: 3 });
const usd = (value: number | null) => value === null ? words[lang()].unavailable : formatCost(value);
const duration = (ms: number | null) => ms === null ? words[lang()].unavailable : `${number(ms / 1000)} s`;

function CostMeasure({ measure }: { measure: AgentMeasure }) {
  const w = words[lang()];
  return <><b>{usd(measure.total)}</b><p className="small muted">{w.total} · {measure.knownSessions} {w.known} / {measure.unknownSessions} {w.missing}</p>
    {measure.total === null && measure.knownSubtotal !== null && <p>{w.subtotal}: {usd(measure.knownSubtotal)}</p>}</>;
}

/** Pure view also used by server-render tests, preserving null vs zero and partial timing vs complete samples. */
export function AgentAnalyticsView({ data }: { data: AgentAnalyticsData }) {
  const w = words[lang()];
  return <>
    <p className="small muted">{w.costsNote}</p>
    {!data.agents.length && <p className="bx-empty">{w.empty}</p>}
    {data.agents.map(agent => <article className="bx-card" key={agent.agentId} data-testid="bx-agent-analytics-agent">
      <h3>{agent.name || agent.agentId}</h3>
      <p className="small muted">{agent.agentId} · {w.revisions}: {agent.revisions.join(', ')} · {agent.sessions} {w.sessions}</p>
      <div className="bx-kpis">{costKinds.map(key => <div className="bx-kpi" key={key}><span className="k">{w[key]}</span><CostMeasure measure={agent.costs[key]} /></div>)}</div>
      <details><summary>{w.timing}</summary>
        <p>{agent.timing.execution.knownSessions} {w.complete} · {agent.timing.execution.unknownSessions} {w.incomplete}</p>
        <ul className="bx-list">{timingKinds.map(kind => <li key={kind}><span className="t">{w[kind]}: {w.total} {duration(agent.timing[kind].total)} · {w.median} {duration(agent.timing[kind].medianMs)} · {w.partial}: {duration(agent.timing[kind].observedPartialMs > 0 ? agent.timing[kind].observedPartialMs : null)}</span></li>)}</ul>
        <p>{w.elapsed}: {w.median} {duration(agent.elapsed.medianMs)} · {agent.elapsed.knownSessions} {w.known} / {agent.elapsed.unknownSessions} {w.missing}</p>
      </details>
    </article>)}
    <details data-testid="bx-agent-analytics-cohorts"><summary>{w.cohorts} · {data.cohorts.length}</summary>
      <p className="small muted">{w.cohortNote}</p>
      {!data.cohorts.length ? <p>{w.noCohorts}</p> : <div className="bx-card tight" style={{ overflowX: 'auto' }}><table>
        <caption>{w.cohorts}</caption>
        <thead><tr>{[w.agent, w.task, w.model, w.samples, w.executionMedian, w.elapsedMedian].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{data.cohorts.map(cohort => <tr key={JSON.stringify([cohort.agentId, cohort.ownerRevision, cohort.taskType, cohort.engine, cohort.model, cohort.effortObserved])}>
          <th scope="row">{data.agents.find(agent => agent.agentId === cohort.agentId)?.name || cohort.agentId} ({cohort.agentId}) / {cohort.ownerRevision}</th>
          <td>{cohort.taskType}</td><td>{cohort.engine ?? w.unavailable} / {cohort.model} / {cohort.effortObserved}</td><td>{cohort.samples}</td>
          <td>{duration(cohort.medianExecutionMs)}</td><td>{duration(cohort.medianElapsedMs)}</td>
        </tr>)}</tbody>
      </table></div>}
    </details>
  </>;
}

export function AgentAnalytics() {
  const result = useBrain('/api/agents/analytics', normalize, { pollMs: 5000 });
  const w = words[lang()];
  return <Section title={w.title} note={w.scope} testId="bx-agent-analytics" actions={<button type="button" className="bx-btn s" onClick={() => result.reload(true)} disabled={result.loading}>{w.refresh}</button>}>
    {result.error && <p role="alert">{w.error}: {result.error}</p>}
    {result.loading && !result.data ? <Loading label={w.loading} /> : result.data ? <AgentAnalyticsView data={result.data} /> : null}
  </Section>;
}
