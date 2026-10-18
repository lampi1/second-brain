// Approval queue and per-agent feedback, rendered from the typed lifecycle read model.
// Opening the editor is explicit; viewing suggestions never applies a definition or trial decision.
import { useEffect, useState } from 'react';
import type { AgentLifecycleClient, AgentLifecycleProposal, AgentLifecycleSnapshot } from '@shared/agent-lifecycle';
import type { Metric, VersionMetrics } from '@shared/agents';
import '../styles/agent-lifecycle.css';

const labels: Record<AgentLifecycleProposal['kind'], string> = {
  update: 'Aggiornamento', create: 'Nuovo agente', merge: 'Unione di ruoli', 'model-trial': 'Prova di modello',
  split: 'Separazione di un ruolo', keep: 'Mantieni versione', revert: 'Ripristina versione',
};
function metric(m: Metric | undefined, percent = false): string {
  if (!m || m.value === null) return 'Dato non disponibile';
  const value = percent ? `${Math.round(m.value * 100)}%` : m.value.toLocaleString('it-IT', { maximumFractionDigits: 2 });
  return `${value} · n=${m.n} · copertura ${m.coverage === null ? 'non disponibile' : `${Math.round(m.coverage * 100)}%`}`;
}
function Comparison({ before, after }: { before: VersionMetrics | null; after: VersionMetrics | null }) {
  return <div className="lifecycle-table-wrap"><table><caption>Confronto delle esecuzioni</caption><thead><tr><th>Metrica</th><th>Riferimento</th><th>Gruppo valutato</th></tr></thead>
    <tbody>{([
      ['Successo', before?.successRate, after?.successRate, true],
      ['Correzioni per esecuzione', before?.correctionsPerRun, after?.correctionsPerRun, false],
      ['Costo mediano ($)', before?.costPerRun.median, after?.costPerRun.median, false],
      ['Tempo mediano (ms)', before?.timeToDone.elapsed, after?.timeToDone.elapsed, false],
      ['Domande per esecuzione', before?.questionsPerRun, after?.questionsPerRun, false],
    ] as const).map(([label, b, a, percent]) => <tr key={label}><th scope="row">{label}</th><td>{metric(b, percent)}</td><td>{metric(a, percent)}</td></tr>)}</tbody></table></div>;
}
export function AgentLifecycleView({ snapshot, onReview }: { snapshot: AgentLifecycleSnapshot; onReview: (proposal: AgentLifecycleProposal) => void }) {
  return <section className="agent-lifecycle" aria-label="Ciclo degli agenti" data-testid="agent-lifecycle">
    <h3>Da approvare</h3><p>Le proposte non modificano gli agenti. Esamina i dati e apri l’editor per preparare una modifica.</p>
    {snapshot.problem && <p role="alert">{snapshot.problem}</p>}
    {!snapshot.proposals.length && !snapshot.problem && <p>Nessuna proposta in attesa.</p>}
    {snapshot.proposals.map(p => <article key={p.key}>
      <h4>{labels[p.kind]}</h4><p>{p.reason}</p>{p.agentIds.length > 0 && <p>Agenti: {p.agentIds.join(', ')}</p>}
      {p.metrics && <Comparison {...p.metrics} />}
      <details><summary>Evidenze ({p.evidence.length})</summary>{p.evidence.length ? <ul>{p.evidence.map((e, i) => <li key={i}>{e.kind}: <code>{e.ref}</code></li>)}</ul> : <p>Confronto calcolato sulle definizioni o sulle metriche riportate.</p>}</details>
      <button type="button" className="btn btn-ghost" disabled={!!snapshot.problem} onClick={() => onReview(p)}>Esamina proposta</button>
    </article>)}
    {snapshot.evaluations.length > 0 && <details><summary>Valutazioni delle versioni</summary>{snapshot.evaluations.map(e => <article key={`${e.agentId}/${e.version}`}>
      <h4>{e.agentId} · v{e.version}</h4><p>{e.result.reason}</p>
      <p>Richieste comparabili: {e.result.comparable} · altre: {e.result.otherRuns} · classificazione sconosciuta: {e.result.unknownRouting}</p>
      <Comparison before={e.result.before} after={e.result.after} />
      {e.result.other && <details><summary>Altre richieste (escluse dalla decisione)</summary><Comparison before={null} after={e.result.other} /></details>}
    </article>)}</details>}
    {snapshot.feedback.length > 0 && <details><summary>Feedback ({snapshot.feedback.length})</summary>{[...snapshot.feedback].reverse().map(f => <article key={f.id}>
      <h4>{f.runId} · v{f.version}</h4><p>Valutazione dell’Orchestrator, non conferma dell’utente.</p>
      <p>Ha funzionato: {f.worked || 'Non indicato'}</p><p>Da migliorare: {f.failed || 'Non indicato'}</p>
      {f.gapKey && <p>Lacuna: {f.gapKey}</p>}
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
  return <div>{error ? <p role="alert">Ciclo degli agenti non disponibile.</p> : snapshot ? <AgentLifecycleView snapshot={snapshot} onReview={onReview} /> : <p role="status">Caricamento delle proposte…</p>}
    <button type="button" className="btn btn-ghost" onClick={() => refresh(n => n + 1)}>Aggiorna proposte</button></div>;
}
