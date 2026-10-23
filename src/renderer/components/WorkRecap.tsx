// Read-only routine PR/QA recap from the Task service; the cockpit offers its existing refresh without a model turn.
import type { TasksState } from '@shared/contract';
import { workRecap } from '@shared/work-recap';

export function WorkRecap({ tasks, refresh, now = Date.now() }: { tasks: TasksState | null; refresh: () => void; now?: number }) {
  const recap = workRecap(tasks, now);
  const stamp = (at: number | null) => at ? new Date(at).toLocaleString() : 'mai letti';
  const fresh = { missing: 'data non disponibile', stale: 'dati oltre un’ora', current: 'ultimo controllo disponibile', error: 'aggiornamento fallito' };
  return <details className="work-routine" data-testid="work-routine">
    <summary>PR e QA · {recap.prs.length} PR · riepilogo senza modello · QA: {fresh[recap.qaFreshness]}</summary>
    <div className="work-routine-heading"><p>PR: {stamp(recap.readAt)} · {fresh[recap.freshness]}<br />QA: {stamp(recap.qaAt)} · {fresh[recap.qaFreshness]}</p>
      <button type="button" className="btn btn-ghost btn-s" onClick={refresh} disabled={tasks?.running}>{tasks?.running ? 'Lettura in corso' : 'Aggiorna PR e QA'}</button></div>
    {tasks?.error && <p role="status">{tasks.error.message}</p>}
    {tasks?.qaError && <p role="status">QA non aggiornate: {tasks.qaError}. Restano gli ultimi dati riusciti.</p>}
    {!recap.prs.length && <p>{recap.readAt ? 'Nessuna PR attiva nell’ultima lettura.' : 'Leggi i dati DevOps per vedere le PR e le verifiche disponibili.'}</p>}
    {recap.prs.map(({ pr, risks, qaKnown }) => <article key={`${pr.project}/${pr.repo}/${pr.id}`} className="work-routine-pr">
      <strong>#{pr.id} · {pr.title}</strong><small>{pr.repo} → {pr.target}{pr.draft ? ' · bozza' : ''}{pr.autoComplete ? ' · auto-complete attivo' : ''}</small>
      {risks.length > 0 && <p className="work-routine-risk">{risks.join(' · ')}</p>}
      <p>Build: {pr.build?.result ?? pr.build?.status ?? 'non disponibile'} · Review richieste: {pr.reviewers.filter(r => r.required && r.vote === 0).length}</p>
      {!qaKnown && <p>QA non disponibili: nessun esito verificabile.</p>}
      {qaKnown && !risks.length && <p>Nessun problema segnalato nei dati disponibili.</p>}
    </article>)}
    <small>Questo riepilogo non approva merge o produzione. Per interpretare i dati usa «Fai il punto».</small>
  </details>;
}
