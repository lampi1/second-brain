// Human-only decisions on automatic agent drafts; displays the exact before/after and expected effect before saving.
import { useEffect, useState } from 'react';
import type { AgentProposal } from '@shared/agent-authoring';
import { sb } from '../sb';
import { refreshAgents } from '../store/agents';

export function AgentProposals() {
  const [items, setItems] = useState<AgentProposal[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const refresh = () => sb.invoke('agents:proposals', undefined).then(setItems, e => setError(String(e)));
  useEffect(() => { void refresh(); }, []);
  const decide = async (id: string, accept: boolean) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await sb.invoke('agents:proposalDecide', { id, accept }); await refresh(); await refreshAgents(); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  return <section aria-label="Proposte Agenti">
    <h3>Proposte Agenti</h3><button type="button" disabled={busy} onClick={() => void refresh()}>Aggiorna proposte</button>
    {error && <p role="alert">{error}</p>}
    {items.filter(p => p.state === 'pending').map(p => <article key={p.id}>
      <h4>{p.draft.name}</h4><p>{p.reason}</p><p>Effetto atteso: {p.expectedEffect}</p>
      <details><summary>Confronta definizioni</summary>{p.before && <><h5>Prima</h5><pre>{JSON.stringify(p.before, null, 2)}</pre></>}<h5>Proposta</h5><pre>{JSON.stringify(p.draft, null, 2)}</pre><h5>Evidenze</h5><pre>{JSON.stringify(p.evidence, null, 2)}</pre></details>
      <button type="button" disabled={busy} onClick={() => void decide(p.id, true)}>{p.kind === 'suggestion' ? 'Crea Agente' : 'Accetta modifica'}</button>
      <button type="button" disabled={busy} onClick={() => void decide(p.id, false)}>Rifiuta</button>
    </article>)}
  </section>;
}
