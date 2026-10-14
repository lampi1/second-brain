// "Nuova Regia" confirm (Ctrl+Shift+R, the palette, the Regia's ⋯ menu): pick the engine among the registry's (the
// same one = "Ricomincia da capo", another = "Cambia motore"), choose whether the new Regia starts from a summary of
// the old one, confirm.
// The old Regia stays among the chats, closed, with its history (renewRegia in actions.ts does the work). Why one
// dialog for both: same mechanism, one place to learn. Used by App.tsx (modal 'regiaRenew').
import { useState } from 'react';
import type { Harness } from '@shared/contract';
import { useApp } from '../store/store';
import { closeModal, ui } from '../store/ui';
import { renewRegia } from '../actions';
import { engineName, useEngines } from '../lib/engines';
import { useEngineBlocks } from './ChatMenu';
import { HarnessMark } from './Icons';
import { Keys, Modal } from './ui';

export function RegiaRenewDialog() {
  const spec = ui.use(s => s.regiaRenew);
  const chat = useApp(s => (spec ? s.chats[spec.chatId] ?? null : null));
  const [to, setTo] = useState<Harness>(spec?.to ?? '');
  const [summary, setSummary] = useState(true);
  const [busy, setBusy] = useState(false);
  const engines = useEngines();
  const blockOf = useEngineBlocks();
  // a Cursor Regia restored after a restart has no exchanges until it is reopened: the summary would carry only now.md
  const loaded = useApp(s => !!spec && (s.items[spec.chatId] ?? []).some(i => i.kind === 'user' || i.kind === 'assistant'));
  if (!spec || !chat) return null;
  const same = to === chat.harness;
  const block = blockOf(to);
  const go = async () => {
    if (busy || block) return;
    setBusy(true);
    const ok = await renewRegia(chat.id, to, summary);
    setBusy(false);
    if (ok) closeModal();
  };
  const action = same ? 'Ricomincia da capo' : `Passa a ${engineName(to)}`;
  return (
    <Modal onClose={closeModal} label="Nuova Regia" testid="regia-renew" className="modal-renew">
      <form onSubmit={e => { e.preventDefault(); void go(); }}>
        <div className="modal-head">
          <HarnessMark harness={chat.harness} regia size={22} />
          <h2>Nuova Regia</h2><span className="sp" /><Keys combo="Invio" /><span className="modal-head-hint">conferma</span>
        </div>
        <div className="modal-body">
          <div className="harness-pick" role="radiogroup" aria-label="Motore della nuova Regia">
            {engines.map(({ id: h, name }) => (
              <button key={h} type="button" role="radio" aria-checked={to === h} className={`harness-card ${to === h ? 'on' : ''}`} disabled={!!blockOf(h)}
                onClick={() => setTo(h)} data-testid={`regia-renew-${h}`}>
                <HarnessMark harness={h} size={28} />
                <span><b>{name}</b><small>{blockOf(h) ?? (h === chat.harness ? 'ricomincia da capo' : 'cambia motore')}</small></span>
              </button>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={summary} onChange={e => setSummary(e.target.checked)} data-testid="regia-renew-summary" />
            <span>Porta un riassunto <small data-testid="regia-renew-summary-what">{loaded ? 'la nuova Regia parte dagli ultimi scambi di questa e da now.md' : 'questa Regia non ha scambi caricati: porta solo now.md e il link'}</small></span>
          </label>
          <p className="regia-note" data-testid="regia-renew-note">
            <HarnessMark harness={chat.harness} size={16} />
            <span>La Regia attuale <b>«{chat.title}»</b> resta tra le chat, chiusa, con la sua storia: la riapri quando vuoi.</span>
          </p>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost btn-m" onClick={closeModal} data-testid="regia-renew-cancel">Annulla <Keys combo="Esc" /></button>
          <button type="submit" className="btn btn-regia btn-m" autoFocus data-autofocus disabled={busy || !!block} data-testid="regia-renew-go">{busy ? 'Avvio…' : action}</button>
        </div>
      </form>
    </Modal>
  );
}
