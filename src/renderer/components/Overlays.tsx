// Small overlays: the confirm dialog (only for what cannot be undone, e.g. Ferma tutto with several chats running),
// the keyboard shortcuts sheet (Ctrl+/), and calm toasts (at most two, bottom-left over the Regia column so they
// never sit on a browser view; an "Annulla" action for undoable things). Used by App.tsx.
import { getKeymap } from '../lib/keys';
import { closeModal, dismissToast, ui } from '../store/ui';
import { t } from '../i18n';
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
        <button type="button" className="btn btn-ghost btn-m" onClick={closeModal} data-testid="confirm-cancel">{t('dialogs.confirm.cancelButton')} <Keys combo="Esc" /></button>
        <button type="button" className={`btn ${c.danger ? 'btn-danger-solid' : 'btn-primary'} btn-m`} autoFocus onClick={() => { closeModal(); c.onConfirm(); }} data-testid="confirm-ok">{c.confirmLabel}</button>
      </div>
    </Modal>
  );
}

export function ShortcutsDialog() {
  return (
    <Modal onClose={closeModal} label={t('dialogs.shortcuts.title')} testid="shortcuts" className="modal-shortcuts">
      <div className="modal-head"><h2>{t('dialogs.shortcuts.title')}</h2><span className="sp" /><Keys combo="Esc" /></div>
      <div className="modal-body">
        <dl className="keymap">
          {getKeymap().map(k => <div key={k.keys} className="keymap-row"><dt><Keys combo={k.keys.replace(/ · /g, ' ')} /></dt><dd>{k.what}</dd></div>)}
        </dl>
        <p className="menu-note">{t('dialogs.shortcuts.note')} <Keys combo="Ctrl+K" />.</p>
      </div>
    </Modal>
  );
}

export function Toasts() {
  const toasts = ui.use(s => s.toasts);
  const closeLabel = t('dialogs.toast.closeLabel');
  return (
    <div className="toasts" aria-live="polite" data-testid="toasts">
      {toasts.map(toast => (
        <div key={toast.id} className={`toast toast-${toast.tone}`} role={toast.tone === 'err' ? 'alert' : 'status'} data-testid="toast">
          {toast.tone === 'ok' ? <IconCheck size={14} /> : toast.tone === 'err' || toast.tone === 'warn' ? <IconAlert size={14} /> : <IconInfo size={14} />}
          <span className="toast-text">{toast.text}</span>
          {toast.action && (
            <button type="button" className="toast-action" onClick={() => { toast.action?.run(); dismissToast(toast.id); }} data-testid="toast-action">
              <IconUndo size={13} />{toast.action.label}
            </button>
          )}
          <button type="button" className="toast-x" aria-label={closeLabel} onClick={() => dismissToast(toast.id)} data-testid="toast-close"><IconX size={12} /></button>
          {toast.action && <span className="toast-timer" style={{ animationDuration: `${toast.ttl}ms` }} aria-hidden="true" />}
        </div>
      ))}
    </div>
  );
}
