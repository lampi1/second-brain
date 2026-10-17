// Always-visible effort status in agent/Regia headers, with a progressive control for the next turn.
// Provider effective value, submitted parameter and requested choice are kept distinct. No inferred medium/default.
import { useRef, useState } from 'react';
import type { ChatSummary } from '@shared/contract';
import { engineCan } from '../lib/engines';
import { EFFORTS, effortLabel } from '../lib/format';
import { effortSummary } from '../lib/effort-status';
import { setChat } from '../store/store';
import { Popover } from './ui';
import '../styles/effort.css';

export function EffortControl({ chat }: { chat: ChatSummary }) {
  const ref = useRef<HTMLButtonElement>(null), [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const close = () => { setOpen(false); ref.current?.focus(); };
  const status = chat.effortStatus ?? { supported: engineCan(chat.harness, 'effort'), requested: chat.effort, submitted: null, effective: null, pending: false, effectiveSource: 'unknown' as const, sessionDefault: null };
  const summary = effortSummary(status);
  if(!summary.compactBadge)return null; // Missing provider data remains available in details; it is not repeated in every header.
  return <span className="effort-control" data-testid={`effort-${chat.id}`}>
    <button ref={ref} type="button" className="link-btn effort-badge" onClick={() => setOpen(v => !v)} aria-expanded={open} aria-label={`Ragionamento. ${summary.badge}. Scelta: ${summary.requested}${summary.pending ? `. ${summary.pending}` : ''}`} title={`Scelta: ${summary.requested}. Parametro inviato: ${summary.submitted}. Il parametro inviato non prova il valore effettivo.`}>{summary.compactBadge}</button>
    <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={330} testid={`effort-pop-${chat.id}`}>
      <div className="effort-details"><b>Ragionamento dell’agente</b><dl><dt>Attivo, riportato dal provider</dt><dd>{summary.active}</dd><dt>Scelta richiesta</dt><dd>{summary.requested}</dd><dt>Parametro inviato al turno</dt><dd>{summary.submitted}</dd><dt>Default di sessione riportato</dt><dd>{summary.sessionDefault}</dd></dl>
        <p>{status.pending ? 'La modifica è richiesta per il prossimo turno; quello in corso mantiene il proprio valore.' : 'Il parametro inviato non è una conferma del valore attivo. Se il motore non lo riporta, resta sconosciuto.'}</p>
        {status.supported ? <><p>Scelta per i prossimi turni</p>{EFFORTS.map(effort => <button type="button" key={effort} className="menu-item" role="menuitemradio" aria-checked={status.requested === effort} disabled={busy} onClick={() => { if (busy) return; setBusy(true); void setChat(chat.id, { effort }).finally(() => { setBusy(false); close(); }); }}>{effortLabel(effort)}</button>)}</> : <p>Questo motore non supporta il controllo del ragionamento.</p>}
        <button type="button" role="menuitem" className="menu-item" onClick={close}>Chiudi</button>
      </div>
    </Popover>
  </span>;
}
