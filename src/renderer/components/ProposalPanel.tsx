// Review panel for isolated app proposals. The integrator supplies typed renderer-only IPC callbacks.
// The explicit PR button shares an exact, reviewed commit; requesting or refreshing a proposal never publishes.
import { useRef, useState } from 'react';
import type { AppProposal, ProposalPublication } from '@shared/improve-proposals';

export interface ProposalPanelProps {
  proposals: AppProposal[];
  publishBlocked: string | null;
  createBlocked: string | null;
  onCreate: () => Promise<void>;
  onRefresh: (id: string) => Promise<void>;
  onResume: (id: string) => Promise<void>;
  onPublish: (request: ProposalPublication) => Promise<void>;
}

export function ProposalPanel({ proposals, publishBlocked, createBlocked, onCreate, onRefresh, onResume, onPublish }: ProposalPanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const running = useRef(false);
  const perform = async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current=true;
    setBusy(true); setError(false);
    try { await action(); } catch { setError(true); } finally { running.current=false;setBusy(false); }
  };
  return <section className="imp-card" aria-label="Prepara una modifica" data-testid="app-proposals">
    <header className="imp-card-head"><h3>La tua app, come serve a te</h3></header>
    <p>Descrivi alla chat cosa vuoi cambiare. La modifica viene preparata in una copia separata, poi puoi vedere le differenze e le verifiche.</p>
    <button type="button" className="btn btn-primary" disabled={busy||!!createBlocked} onClick={() => {if(!createBlocked)void perform(onCreate);}} data-testid="proposal-create">{busy ? 'Preparazione…' : 'Prepara una modifica'}</button>
    {createBlocked&&<p role="status">{createBlocked}</p>}
    {error && <p role="alert">Operazione non completata. Le modifiche locali sono conservate: riprova.</p>}
    {publishBlocked && <p role="status">Condivisione non disponibile: {publishBlocked}</p>}
    {proposals.map(p => <ProposalReview key={p.id} proposal={p} busy={busy} publishBlocked={!!publishBlocked} resume={() => perform(() => onResume(p.id))} refresh={() => perform(() => onRefresh(p.id))} publish={request => perform(() => onPublish(request))} />)}
  </section>;
}

function ProposalReview({ proposal: p, busy, publishBlocked, resume, refresh, publish }: { proposal: AppProposal; busy: boolean; publishBlocked: boolean; resume: () => Promise<void>; refresh: () => Promise<void>; publish: (request: ProposalPublication) => Promise<void> }) {
  const [ack, setAck] = useState<{head:string|null;diff:string|null}|null>(null);
  const read = !!ack && ack.head===p.head && ack.diff===p.diff;
  const working = p.phase === 'checking' || p.phase === 'publishing';
  const labels = { pending: 'Da eseguire', passed: 'Superata', failed: 'Da risolvere' };
  return <article data-testid={`proposal-${p.id}`} aria-busy={working}>
    <h4>{p.url ? 'Modifica condivisa' : p.phase === 'ready' ? 'Pronta da rivedere' : working ? 'Operazione in corso…' : 'Modifica in preparazione'}</h4>
    <ul aria-label="Verifiche">
      <li>Funzionamento: {labels[p.quality.state]}</li><li>Dati riservati: {labels[p.privacy.state]}</li><li>Revisioni di correttezza, sicurezza e usabilità: {labels[p.reviews.state]}</li>
    </ul>
    {p.problem && <p role="status">{p.problem}</p>}
    {p.diff !== null && <details data-testid="proposal-diff"><summary>Cosa cambierebbe ({p.files.length} file)</summary><ul>{p.files.map(f => <li key={f}>{f}</li>)}</ul><pre className="imp-log">{p.diff}</pre></details>}
    {!p.url && <>
      <button type="button" className="btn btn-ghost" disabled={busy || working} onClick={() => void resume()}>Apri la chat della modifica</button>
      <button type="button" className="btn btn-ghost" disabled={busy || working} onClick={() => void refresh()}>Rileggi modifiche e verifiche</button>
      {p.phase === 'ready' && <label className="check"><input type="checkbox" checked={read} onChange={e => setAck(e.target.checked?{head:p.head,diff:p.diff}:null)} />Ho rivisto le differenze. Voglio condividere questi file sul repository GitHub.</label>}
      <button type="button" className="btn btn-primary" data-testid="proposal-pr" disabled={publishBlocked || busy || working || !read || p.phase !== 'ready' || !p.head} onClick={() => { if (!publishBlocked && p.head) void publish({ id: p.id, reviewedHead: p.head }); }}>Apri PR su GitHub</button>
      <p>Il pulsante invia la modifica al repository e apre una richiesta di revisione (PR). L’app in uso viene aggiornata con un’azione separata.</p>
    </>}
    {p.url && <p role="status">{p.publication === 'closed' ? 'PR chiusa' : p.publication === 'merged' ? 'PR unita' : 'PR aperta'}: <a href={p.url} target="_blank" rel="noreferrer">Rivedi la modifica su GitHub</a></p>}
  </article>;
}
