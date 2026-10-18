// Approval queue and per-agent feedback, rendered from the typed lifecycle read model.
// Opening the editor is explicit; viewing suggestions never applies a definition or trial decision.
import { useEffect, useState } from 'react';
import type { AgentLifecycleClient, AgentLifecycleProposal, AgentLifecycleSnapshot } from '@shared/agent-lifecycle';
import type { Metric, VersionMetrics } from '@shared/agents';
import { locale, t } from '../i18n';
import '../styles/agent-lifecycle.css';

function metric(m: Metric | undefined, percent = false): string {
  if (!m || m.value === null) return t('lifecycle.metricMissing');
  const value = percent ? `${Math.round(m.value * 100)}%` : m.value.toLocaleString(locale(), { maximumFractionDigits: 2 });
  return t('lifecycle.metric', { value, n: m.n, coverage: m.coverage === null ? t('lifecycle.coverageMissing') : `${Math.round(m.coverage * 100)}%` });
}
function Comparison({ before, after }: { before: VersionMetrics | null; after: VersionMetrics | null }) {
  return <div className="lifecycle-table-wrap"><table><caption>{t('lifecycle.compare')}</caption><thead><tr><th>{t('lifecycle.metricCol')}</th><th>{t('lifecycle.baseline')}</th><th>{t('lifecycle.evaluated')}</th></tr></thead>
    <tbody>{([
      [t('lifecycle.success'), before?.successRate, after?.successRate, true],
      [t('lifecycle.corrections'), before?.correctionsPerRun, after?.correctionsPerRun, false],
      [t('lifecycle.cost'), before?.costPerRun.median, after?.costPerRun.median, false],
      [t('lifecycle.time'), before?.timeToDone.elapsed, after?.timeToDone.elapsed, false],
      [t('lifecycle.questions'), before?.questionsPerRun, after?.questionsPerRun, false],
    ] as const).map(([label, b, a, percent]) => <tr key={label}><th scope="row">{label}</th><td>{metric(b, percent)}</td><td>{metric(a, percent)}</td></tr>)}</tbody></table></div>;
}
export function AgentLifecycleView({ snapshot, onReview }: { snapshot: AgentLifecycleSnapshot; onReview: (proposal: AgentLifecycleProposal) => void }) {
  return <section className="agent-lifecycle" aria-label={t('lifecycle.aria')} data-testid="agent-lifecycle">
    <h3>{t('lifecycle.title')}</h3><p>{t('lifecycle.intro')}</p>
    {snapshot.problem && <p role="alert">{snapshot.problem}</p>}
    {!snapshot.proposals.length && !snapshot.problem && <p>{t('lifecycle.empty')}</p>}
    {snapshot.proposals.map(p => <article key={p.key}>
      <h4>{t(`lifecycle.kind.${p.kind}`)}</h4><p>{p.reason}</p>{p.agentIds.length > 0 && <p>{t('lifecycle.agents', { ids: p.agentIds.join(', ') })}</p>}
      {p.metrics && <Comparison {...p.metrics} />}
      <details><summary>{t('lifecycle.evidence', { n: p.evidence.length })}</summary>{p.evidence.length ? <ul>{p.evidence.map((e, i) => <li key={i}>{e.kind}: <code>{e.ref}</code></li>)}</ul> : <p>{t('lifecycle.evidenceNone')}</p>}</details>
      <button type="button" className="btn btn-ghost" disabled={!!snapshot.problem} onClick={() => onReview(p)}>{t('lifecycle.review')}</button>
    </article>)}
    {snapshot.evaluations.length > 0 && <details><summary>{t('lifecycle.evaluations')}</summary>{snapshot.evaluations.map(e => <article key={`${e.agentId}/${e.version}`}>
      <h4>{e.agentId} · v{e.version}</h4><p>{e.result.reason}</p>
      <p>{t('lifecycle.cohorts', { comparable: e.result.comparable, other: e.result.otherRuns, unknown: e.result.unknownRouting })}</p>
      <Comparison before={e.result.before} after={e.result.after} />
      {e.result.other && <details><summary>{t('lifecycle.otherRuns')}</summary><Comparison before={null} after={e.result.other} /></details>}
    </article>)}</details>}
    {snapshot.feedback.length > 0 && <details><summary>{t('lifecycle.feedback', { n: snapshot.feedback.length })}</summary>{[...snapshot.feedback].reverse().map(f => <article key={f.id}>
      <h4>{f.runId}{f.version !== undefined && ` · v${f.version}`}</h4>
      <p>{f.outcome.basis === 'reviewed-evidence' ? t('lifecycle.basisReviewed') : t('lifecycle.basisOpinion')}</p>
      {f.outcome.note && <p>{f.outcome.note}</p>}
      <p>{t('lifecycle.worked', { text: f.worked || t('lifecycle.notGiven') })}</p><p>{t('lifecycle.failed', { text: f.failed || t('lifecycle.notGiven') })}</p>
      {f.gapKey && <p>{t('lifecycle.gap', { key: f.gapKey })}</p>}
      <ul>{f.evidence.map((e, i) => <li key={i}>{e.kind}: <code>{e.ref}</code></li>)}</ul>
    </article>)}</details>}
  </section>;
}
export function AgentLifecyclePanel({ api, agentId, onReview }: { api: AgentLifecycleClient; agentId?: string; onReview: (proposal: AgentLifecycleProposal) => void }) {
  const [snapshot, setSnapshot] = useState<AgentLifecycleSnapshot | null>(null), [error, setError] = useState(false), [revision, refresh] = useState(0);
  useEffect(() => {
    let alive = true; setSnapshot(null); setError(false);
    void api.read(agentId ? { agentId } : {}).then(value => { if (alive) setSnapshot(value); }, () => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [api, agentId, revision]);
  return <div>{error ? <p role="alert">{t('lifecycle.unavailable')}</p> : snapshot ? <AgentLifecycleView snapshot={snapshot} onReview={onReview} /> : <p role="status">{t('lifecycle.loading')}</p>}
    <button type="button" className="btn btn-ghost" onClick={() => refresh(n => n + 1)}>{t('lifecycle.reload')}</button></div>;
}
