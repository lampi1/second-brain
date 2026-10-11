// Small overlays: the confirm dialog (only for what cannot be undone, e.g. Ferma tutto with several chats running),
// the keyboard shortcuts sheet (Ctrl+/), and calm toasts (at most two, bottom-left over the Regia column so they
// never sit on a browser view; an "Annulla" action for undoable things). Used by App.tsx.
import { KEYMAP } from '../lib/keys';
import { closeModal, dismissToast, ui } from '../store/ui';
import { IconAlert, IconCheck, IconInfo, IconUndo, IconX } from './Icons';
import { Keys, Modal } from './ui';

export function ConfirmDialog() {
  const c = ui.use(s => s.confirm);
  if (!c) return null;
  return (
    <Modal onClose={closeModal} label={c.title} testid="confirm" className="modal-confirm">
      <div className="modal-head"><h2>{c.title}</h2></div>
      <div className="modal-body">
        <p className="confirm-body">{c.body}</p>
        {c.items && <ul className="confirm-items">{c.items.map(i => <li key={i}>{i}</li>)}</ul>}
      </div>
      <div className="modal-foot">
        <button type="button" className="btn btn-ghost btn-m" onClick={closeModal} data-testid="confirm-cancel">Annulla <Keys combo="Esc" /></button>
        <button type="button" className={`btn ${c.danger ? 'btn-danger-solid' : 'btn-primary'} btn-m`} autoFocus onClick={() => { closeModal(); c.onConfirm(); }} data-testid="confirm-ok">{c.confirmLabel}</button>
      </div>
    </Modal>
  );
}

export function ShortcutsDialog() {
  return (
    <Modal onClose={closeModal} label="Scorciatoie da tastiera" testid="shortcuts" className="modal-shortcuts">
      <div className="modal-head"><h2>Scorciatoie da tastiera</h2><span className="sp" /><Keys combo="Esc" /></div>
      <div className="modal-body">
        <dl className="keymap">
          {KEYMAP.map(k => <div key={k.keys} className="keymap-row"><dt><Keys combo={k.keys.replace(/ · /g, ' ')} /></dt><dd>{k.what}</dd></div>)}
        </dl>
        <p className="menu-note">Tutto è anche nella ricerca: <Keys combo="Ctrl+K" />.</p>
      </div>
    </Modal>
  );
}

export function Toasts() {
  const toasts = ui.use(s => s.toasts);
  return (
    <div className="toasts" aria-live="polite" data-testid="toasts">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.tone}`} role={t.tone === 'err' ? 'alert' : 'status'} data-testid="toast">
          {t.tone === 'ok' ? <IconCheck size={14} /> : t.tone === 'err' || t.tone === 'warn' ? <IconAlert size={14} /> : <IconInfo size={14} />}
          <span className="toast-text">{t.text}</span>
          {t.action && (
            <button type="button" className="toast-action" onClick={() => { t.action?.run(); dismissToast(t.id); }} data-testid="toast-action">
              <IconUndo size={13} />{t.action.label}
            </button>
          )}
          <button type="button" className="toast-x" aria-label="Chiudi avviso" onClick={() => dismissToast(t.id)} data-testid="toast-close"><IconX size={12} /></button>
          {t.action && <span className="toast-timer" style={{ animationDuration: `${t.ttl}ms` }} aria-hidden="true" />}
        </div>
      ))}
    </div>
  );
}
