// Small overlays: the confirm dialog (only for what cannot be undone, e.g. Ferma tutto with several chats running),
// the keyboard shortcuts sheet (Ctrl+/), and calm toasts (floating under the top bar, out of the layout flow so they
// never move the page, #169; an undo action for undoable things), drawn as the app's one notice card (Notice.tsx). Used by App.tsx.
import { getKeymap } from '../lib/keys';
import { closeModal, dismissToast, expireToasts, ui } from '../store/ui';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { registerOverlay, schedule } from '../lib/viewports';
import { t } from '../i18n';
import { Notice } from './Notice';
import { Keys, Modal } from './ui';

export function ConfirmDialog() {
  const c = ui.use(s => s.confirm);
  if (!c) return null;
  return (
    <Modal onClose={closeModal} label={c.title} testid="confirm" className="modal-confirm" size="s" title={c.title}
      footer={<>
        <button type="button" className="btn btn-ghost btn-m" onClick={closeModal} data-testid="confirm-cancel">{t('dialogs.confirm.cancelButton')} <Keys combo="Esc" /></button>
        <button type="button" className={`btn ${c.danger ? 'btn-danger-solid' : 'btn-primary'} btn-m`} autoFocus onClick={() => { closeModal(); c.onConfirm(); }} data-testid="confirm-ok">{c.confirmLabel}</button>
      </>}>
      <p className="confirm-body">{c.body}</p>
      {c.items && <ul className="confirm-items">{c.items.map(i => <li key={i}>{i}</li>)}</ul>}
    </Modal>
  );
}

export function ShortcutsDialog() {
  return (
    <Modal onClose={closeModal} label={t('dialogs.shortcuts.title')} testid="shortcuts" className="modal-shortcuts" size="m" title={t('dialogs.shortcuts.title')} closeButton>
      <dl className="keymap">
        {getKeymap().map(k => <div key={k.keys} className="keymap-row"><dt><Keys combo={k.keys.replace(/ · /g, ' ')} /></dt><dd>{k.what}</dd></div>)}
      </dl>
      <p className="menu-note">{t('dialogs.shortcuts.note')} <Keys combo="Ctrl+K" />.</p>
    </Modal>
  );
}

export function Toasts() {
  const toasts = ui.use(s => s.toasts);
  useEffect(()=>{expireToasts();window.addEventListener('focus',expireToasts);document.addEventListener('visibilitychange',expireToasts);return()=>{window.removeEventListener('focus',expireToasts);document.removeEventListener('visibilitychange',expireToasts);};},[]);
  const closeLabel = t('dialogs.toast.closeLabel');
  // it floats over the page (#169): a browser view under a toast steps aside while it shows
  const area = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => (area.current ? registerOverlay(area.current) : undefined), []);
  useLayoutEffect(() => { schedule(); }, [toasts]);
  return (
    <div ref={area} className="toasts" aria-live="polite" data-testid="toasts">
      {toasts.map(toast => (
        <Notice key={toast.id} className="toast" testid="toast" tone={toast.tone} title={toast.labelKey ? t(toast.labelKey) : toast.text}
          label={toast.label} detail={toast.detail} chips={toast.chips} ttl={toast.ttl} closeLabel={closeLabel} closeTestid="toast-close"
          onClose={() => dismissToast(toast.id)}
          action={toast.action && { label: toast.action.label, testid: 'toast-action', onClick: () => { toast.action?.run(); dismissToast(toast.id); } }} />
      ))}
    </div>
  );
}
