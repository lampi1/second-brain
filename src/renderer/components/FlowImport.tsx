// Bounded portable import creates a proposal in the displayed brain; activation stays in the existing decision modal.
// A routine package (.zip, ADR 0156) shows what it would write into the brain first (RoutinePackage.tsx).
import { useRef, useState } from 'react';
import type { RoutineImportPreview } from '@shared/contract';
import { Modal } from './ui';
import { importFlowDefinition, importRoutinePackage, plain } from '../store/flows';
import { toast } from '../store/ui';
import { PackageImportList, pickedByDefault, toBase64 } from './RoutinePackage';
import { t } from '../i18n';
const MAX_BYTES = 1024 * 1024, MAX_ZIP = 20 * 1024 * 1024;
export function FlowImport({ contextKey, onClose }: { contextKey: string; onClose: () => void }) {
  const [content, setContent] = useState(''), [error, setError] = useState<string | boolean>(false), [busy, setBusy] = useState(false);
  const [pkg, setPkg] = useState<{ data: string; preview: RoutineImportPreview } | null>(null), [picked, setPicked] = useState<Set<string>>(new Set()), [memory, setMemory] = useState(true);
  const readTicket = useRef(0);
  async function read(file: File | undefined) {
    const ticket = ++readTicket.current;
    setError(false); setContent(''); setPkg(null);
    if (!file) return;
    if (/\.zip$/i.test(file.name)) {
      if (file.size > MAX_ZIP) { setError(t('rt.pkg.tooBig')); return; }
      try {
        const data = toBase64(await file.arrayBuffer());
        const preview = await window.sb.invoke('flows:packageInspect', { contextKey, data });
        if (ticket !== readTicket.current) return;
        setPkg({ data, preview }); setPicked(new Set(preview.items.filter(pickedByDefault).map(i => i.key))); setMemory(true);
      } catch (e) { if (ticket === readTicket.current) setError(plain(e)); }
      return;
    }
    if (file.size > MAX_BYTES) { setError(true); return; }
    try { const text = await file.text(); if (ticket === readTicket.current) setContent(text); }
    catch { if (ticket === readTicket.current) setError(true); }
  }
  async function submit() {
    if (busy || (!content.trim() && !pkg)) return;
    setBusy(true); setError(false);
    if (pkg) {
      const done = await importRoutinePackage(contextKey, { data: pkg.data, digest: pkg.preview.digest, keys: [...picked], memory: memory && pkg.preview.memory.length > 0 });
      if (typeof done === 'string') { setError(done); setBusy(false); return; }
      toast(t('rt.pkg.imported', { files: done.written, facts: done.remembered }) + (done.failed.length ? ` ${t('rt.pkg.importFailedSome', { list: done.failed.slice(0, 5).join(', ') })}` : ''), done.failed.length ? 'err' : 'info');
      onClose(); return;
    }
    const ok = await importFlowDefinition(contextKey, content);
    if (ok) onClose(); else { setError(true); setBusy(false); }
  }
  return <Modal isolateWorkspace onClose={onClose} label={t('flows.import')} title={t('flows.import')} subtitle={t('flows.importHint')} testid="flow-import" size="m" closeButton
    footer={<><button type="button" className="btn btn-ghost btn-s" onClick={onClose}>{t('common.cancel')}</button><span className="sp" /><button type="button" className="btn btn-primary btn-s" disabled={busy || (!content.trim() && !pkg)} onClick={() => void submit()} data-testid="flow-import-submit">{t(busy ? 'flows.importing' : pkg ? 'rt.pkg.importDo' : 'flows.importDraft')}</button></>}>
    <label className="flow-import-label" htmlFor="flow-import-file">{t('flows.importFile')}</label>
    <input id="flow-import-file" type="file" accept=".zip,.json,.md,application/zip,application/json,text/markdown" disabled={busy} onChange={event => void read(event.target.files?.[0])} data-testid="flow-import-file" />
    {pkg ? <PackageImportList preview={pkg.preview} picked={picked} memory={memory} onMemory={setMemory} onPick={(key, on) => setPicked(prev => { const next = new Set(prev); if (on) next.add(key); else next.delete(key); return next; })} />
      : <><label className="flow-import-label" htmlFor="flow-import-json">{t('flows.importPaste')}</label>
        <textarea id="flow-import-json" className="flow-import-json" value={content} disabled={busy} spellCheck={false} maxLength={MAX_BYTES} onChange={event => { ++readTicket.current; setContent(event.target.value); setError(false); }} />
        <p className="flows-muted">{t('flows.importLimit')}</p></>}
    {error && <p className="flow-block" role="alert">{typeof error === 'string' ? error : t('flows.importFailed')}</p>}
  </Modal>;
}
