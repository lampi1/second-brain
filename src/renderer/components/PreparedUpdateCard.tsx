// UI adapter for a's single staged-update pipeline. Preparation is owned by main, before any confirmation.
// Apply must recheck the immutable marker/hash and chat checkpoint; this component never stages or restarts itself.
import { t as auditText } from '../i18n';
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
      title: auditText('cmp.preparedUpdate.confirmTitle'),
      body: auditText('cmp.preparedUpdate.body', { version: u.version }),
      items: [
        ...u.changes.slice(0, 4),
        auditText('cmp.preparedUpdate.saveFirst'),
        auditText('cmp.preparedUpdate.idleClosed'),
        auditText('cmp.preparedUpdate.previousKept'),
      ],
      confirmLabel: auditText('cmp.preparedUpdate.apply'),
      onConfirm: () => {
        if(!live.current||working.current)return;
        const current=latest.current;
        if(current.id!==u.id||current.version!==u.version||current.phase!=='ready'||current.blocked){setFailed(true);return;}
        working.current=true;setSubmitting(true); setFailed(false);
        void apply(u.id).catch(() => {if(live.current)setFailed(true);}).finally(() => {working.current=false;if(live.current)setSubmitting(false);});
      },
    });
  };
  const state = { preparing: auditText('cmp.preparedUpdate.phase.preparing'), ready: auditText('cmp.preparedUpdate.phase.ready'), applying: auditText('cmp.preparedUpdate.phase.applying'), applied: auditText('cmp.preparedUpdate.phase.applied'), failed: auditText('cmp.preparedUpdate.phase.failed'), restored: auditText('cmp.preparedUpdate.phase.restored') };
  return <section className="imp-card" data-testid="prepared-update">
    <h3>{state[u.phase]}</h3><p>{u.version}</p>
    <ul>{u.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
    {(u.blocked || failed) && <p role="status">{u.blocked || auditText('cmp.preparedUpdate.opFailed')}</p>}
    <button type="button" className="btn btn-primary" onClick={confirm} disabled={submitting || u.phase !== 'ready' || !!u.blocked}>{auditText('audit.PreparedUpdateCard.applyUpdate')}</button>
  </section>;
}
