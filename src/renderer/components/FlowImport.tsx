// Bounded portable import creates a proposal in the displayed brain; activation stays in the existing decision modal.
import { useRef, useState } from 'react';
import { Modal } from './ui';
import { importFlowDefinition } from '../store/flows';
import { t } from '../i18n';
const MAX_BYTES = 1024 * 1024;
export function FlowImport({ contextKey, onClose }: { contextKey: string; onClose: () => void }) {
  const [content, setContent] = useState(''), [error, setError] = useState(false), [busy, setBusy] = useState(false);
  const readTicket = useRef(0);
  async function read(file: File | undefined) {
    const ticket = ++readTicket.current;
    setError(false); setContent('');
    if (!file) return;
    if (file.size > MAX_BYTES) { setError(true); return; }
    try { const text = await file.text(); if (ticket === readTicket.current) setContent(text); }
    catch { if (ticket === readTicket.current) setError(true); }
  }
  async function submit() {
    if (busy || !content.trim()) return;
    setBusy(true); setError(false);
    const ok = await importFlowDefinition(contextKey, content);
    if (ok) onClose(); else { setError(true); setBusy(false); }
  }
  return <Modal isolateWorkspace onClose={onClose} label={t('flows.import')} title={t('flows.import')} subtitle={t('flows.importHint')} testid="flow-import" size="m" closeButton
    footer={<><button type="button" className="btn btn-ghost btn-s" onClick={onClose}>{t('common.cancel')}</button><span className="sp" /><button type="button" className="btn btn-primary btn-s" disabled={busy || !content.trim()} onClick={() => void submit()} data-testid="flow-import-submit">{t(busy ? 'flows.importing' : 'flows.importDraft')}</button></>}>
    <label className="flow-import-label" htmlFor="flow-import-file">{t('flows.importFile')}</label>
    <input id="flow-import-file" type="file" accept=".json,.md,application/json,text/markdown" disabled={busy} onChange={event => void read(event.target.files?.[0])} />
    <label className="flow-import-label" htmlFor="flow-import-json">{t('flows.importPaste')}</label>
    <textarea id="flow-import-json" className="flow-import-json" value={content} disabled={busy} spellCheck={false} maxLength={MAX_BYTES} onChange={event => { ++readTicket.current; setContent(event.target.value); setError(false); }} />
    <p className="flows-muted">{t('flows.importLimit')}</p>
    {error && <p className="flow-block" role="alert">{t('flows.importFailed')}</p>}
  </Modal>;
}
