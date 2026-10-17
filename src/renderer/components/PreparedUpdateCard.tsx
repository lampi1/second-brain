// UI adapter for a's single staged-update pipeline. Preparation is owned by main, before any confirmation.
// Apply must recheck the immutable marker/hash and chat checkpoint; this component never stages or restarts itself.
import { useEffect,useRef,useState } from 'react';
import { askConfirm,ui } from '../store/ui';

export interface PreparedUpdateView {
  id: string;
  version: string;
  changes: string[];
  phase: 'preparing' | 'ready' | 'applying' | 'applied' | 'failed' | 'restored';
  /** Main-provided prerequisite/checkpoint problem. A prepared package alone does not permit interrupting chats. */
  blocked: string | null;
}
export function PreparedUpdateCard({ update: u, apply }: { update: PreparedUpdateView; apply: (id: string) => Promise<void> }) {
  const latest=useRef(u),working=useRef(false),live=useRef(true);latest.current=u;
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const confirm = () => {
    if (u.phase !== 'ready' || u.blocked || working.current || ui.get().modal) return;
    askConfirm({
      title: 'Applicare l’aggiornamento preparato?',
      body: `La versione ${u.version} è stata preparata e verificata.`,
      items: [
        ...u.changes.slice(0, 4),
        'Prima di riavviare vengono salvati lo stato delle chat e i dati. Se il salvataggio non riesce, l’aggiornamento si ferma.',
        'Le sessioni inattive verranno chiuse; chat e bozze saranno conservate.',
        'La versione precedente resta disponibile per il ripristino.',
      ],
      confirmLabel: 'Applica e riavvia',
      onConfirm: () => {
        if(!live.current||working.current)return;
        const current=latest.current;
        if(current.id!==u.id||current.version!==u.version||current.phase!=='ready'||current.blocked){setFailed(true);return;}
        working.current=true;setSubmitting(true); setFailed(false);
        void apply(u.id).catch(() => {if(live.current)setFailed(true);}).finally(() => {working.current=false;if(live.current)setSubmitting(false);});
      },
    });
  };
  const state = { preparing: 'Preparazione e verifiche in background…', ready: 'Aggiornamento preparato', applying: 'Salvataggio e applicazione…', applied: 'Aggiornamento applicato', failed: 'Aggiornamento non completato', restored: 'Versione precedente ripristinata' };
  return <section className="imp-card" data-testid="prepared-update">
    <h3>{state[u.phase]}</h3><p>{u.version}</p>
    <ul>{u.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
    {(u.blocked || failed) && <p role="status">{u.blocked || 'Non è stato possibile completare l’operazione. Rileggi lo stato prima di riprovare.'}</p>}
    <button type="button" className="btn btn-primary" onClick={confirm} disabled={submitting || u.phase !== 'ready' || !!u.blocked}>Applica aggiornamento</button>
  </section>;
}
