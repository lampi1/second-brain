// The routine package (ADR 0156): «Esporta pacchetto» shows what the zip will hold (the files the steps cite, rules,
// skills, roles, scripts, the roles' memory with a switch) before main guard-scans and saves it; the import side lists
// what a package would write into this brain, each item with its text, new ones ticked, different ones kept unless the
// user ticks them. Used by Routine.tsx (export) and FlowImport.tsx (a .zip file).
import { useEffect, useState } from 'react';
import type { RoutineImportItem, RoutineImportPreview, RoutinePackageResult, RoutinePackageSummary } from '@shared/contract';
import { Modal } from './ui';
import { t } from '../i18n';
import { toast } from '../store/ui';
import { plain } from '../store/flows';

function Group({ label, items, empty, testid, tone }: { label: string; items: string[]; empty?: string; testid: string; tone?: 'warn' }) {
  if (!items.length && !empty) return null;
  return <div className="rp-group" data-testid={testid} data-tone={tone}>
    <span className="rt-label">{label} · {items.length}</span>
    {items.length ? <ul className="rp-list">{items.slice(0, 40).map(item => <li key={item}><code>{item}</code></li>)}{items.length > 40 && <li className="rt-muted">{t('rt.pkg.more', { n: items.length - 40 })}</li>}</ul> : <p className="rt-muted">{empty}</p>}
  </div>;
}

export function RoutineExport({ contextKey, flowId, version, onClose }: { contextKey: string; flowId: string; version: number; onClose: () => void }) {
  const [summary, setSummary] = useState<RoutinePackageSummary | null>(null), [error, setError] = useState<string | null>(null);
  const [memory, setMemory] = useState(true), [busy, setBusy] = useState(false), [result, setResult] = useState<Exclude<RoutinePackageResult, { ok: true }> | null>(null);
  useEffect(() => {
    let live = true;
    window.sb.invoke('flows:packagePreview', { contextKey, flowId, version }).then(v => { if (live) setSummary(v); }, e => { if (live) setError(plain(e)); });
    return () => { live = false; };
  }, [contextKey, flowId, version]);
  const save = async () => {
    if (busy) return;
    setBusy(true); setResult(null);
    try {
      const done = await window.sb.invoke('flows:packageExport', { contextKey, flowId, version, memory });
      if (done?.ok) { toast(t('rt.pkg.saved', { path: done.path }), 'info'); onClose(); }
      else if (done) setResult(done);
    } catch (e) { setError(plain(e)); }
    finally { setBusy(false); }
  };
  return <Modal isolateWorkspace onClose={onClose} label={t('rt.pkg.title')} title={t('rt.pkg.title')} subtitle={t('rt.pkg.hint')} testid="rt-package" size="m" closeButton
    footer={<><button type="button" className="btn btn-ghost btn-s" onClick={onClose}>{t('common.cancel')}</button><span className="sp" /><button type="button" className="btn btn-primary btn-s" disabled={busy || !summary} onClick={() => void save()} data-testid="rt-package-save">{t(busy ? 'rt.pkg.saving' : 'rt.pkg.save')}</button></>}>
    {!summary && !error && <p className="rt-muted" role="status">{t('rt.pkg.reading')}</p>}
    {error && <p className="flow-block" role="alert">{error}</p>}
    {summary && <div className="rp-body">
      <Group label={t('rt.pkg.routine')} items={['routine.json', 'ROUTINE.md', 'AGENTS.md']} testid="rt-package-routine" />
      <Group label={t('rt.pkg.cited')} items={summary.cited} empty={t('rt.pkg.citedNone')} testid="rt-package-cited" />
      {summary.missing.length > 0 && <Group label={t('rt.pkg.missing')} items={summary.missing} testid="rt-package-missing" tone="warn" />}
      <Group label={t('rt.pkg.roles')} items={summary.roles} testid="rt-package-roles" />
      <Group label={t('rt.pkg.skills')} items={summary.skills} testid="rt-package-skills" />
      <Group label={t('rt.pkg.scripts')} items={summary.scripts} testid="rt-package-scripts" />
      <Group label={t('rt.pkg.rules')} items={summary.rules} testid="rt-package-rules" />
      <label className="rp-memory" data-testid="rt-package-memory"><input type="checkbox" checked={memory} onChange={e => setMemory(e.target.checked)} disabled={!summary.memory.length} />
        <span><strong>{t('rt.pkg.memory')}</strong> <span className="rt-muted">{summary.memory.length ? t('rt.pkg.memoryOf', { roles: summary.memory.join(', ') }) : t('rt.pkg.memoryNone')}</span></span></label>
      {summary.skipped.length > 0 && <Group label={t('rt.pkg.skipped')} items={summary.skipped} testid="rt-package-skipped" />}
    </div>}
    {result && 'error' in result && <p className="flow-block" role="alert">{result.error}</p>}
    {result && 'findings' in result && <div role="alert" className="flow-block" data-testid="rt-package-findings"><p>{t('rt.pkg.findings')}</p><ul>{result.findings.slice(0, 12).map(f => <li key={`${f.file}:${f.line ?? 0}:${f.rule}`}><code>{f.file}{f.line ? `:${f.line}` : ''}</code> {f.rule}</li>)}</ul></div>}
  </Modal>;
}

/** Ticked by default: what the brain lacks and the routine itself uses (cited files, skills, scripts); another rule of
 *  the exporter's brain only on the user's tick, and a different file never (theirs stays unless they pick it). */
export const pickedByDefault = (item: RoutineImportItem): boolean => item.status === 'new' && item.kind !== 'rule';
const KIND = { cited: 'rt.pkg.kind.cited', rule: 'rt.pkg.kind.rule', skill: 'rt.pkg.kind.skill', script: 'rt.pkg.kind.script', query: 'rt.pkg.kind.query' } as const satisfies Record<RoutineImportItem['kind'], string>;
const STATUS = { new: 'rt.pkg.new', same: 'rt.pkg.same', different: 'rt.pkg.different', elsewhere: 'rt.pkg.elsewhere' } as const satisfies Record<RoutineImportItem['status'], string>;

export function PackageImportList({ preview, picked, onPick, memory, onMemory }: { preview: RoutineImportPreview; picked: Set<string>; onPick: (key: string, on: boolean) => void; memory: boolean; onMemory: (on: boolean) => void }) {
  return <div className="rp-body" data-testid="flow-import-package">
    <p><strong>{preview.title}</strong> <span className="rt-muted">· v{preview.version} · {t('rt.pkg.steps', { n: preview.steps })}{preview.exportedAt ? ` · ${preview.exportedAt}` : ''}</span></p>
    <p className="rt-muted">{t('rt.pkg.importHint')}</p>
    {preview.items.length > 0 && <ul className="rp-items">{preview.items.map(item => {
      const fixed = item.status === 'same' || item.status === 'elsewhere';
      return <li key={item.key} data-status={item.status} data-testid={`flow-import-item-${item.kind}`}>
        <label><input type="checkbox" disabled={fixed} checked={!fixed && picked.has(item.key)} onChange={e => onPick(item.key, e.target.checked)} />
          <span className="rp-kind">{t(KIND[item.kind])}</span><code>{item.label}</code><span className={`rp-status rp-${item.status}`}>{t(STATUS[item.status])}</span></label>
        <details><summary>{t('rt.pkg.show')}</summary>{item.files && item.files.length > 1 && <p className="rt-muted">{item.files.join(', ')}</p>}<pre className="rp-text">{item.text}</pre></details>
      </li>;
    })}</ul>}
    {preview.memory.length > 0 && <label className="rp-memory" data-testid="flow-import-memory"><input type="checkbox" checked={memory} onChange={e => onMemory(e.target.checked)} />
      <span><strong>{t('rt.pkg.memoryImport')}</strong> <span className="rt-muted">{preview.memory.map(m => `${m.role} (${m.lines})`).join(', ')}</span><br /><span className="rt-muted">{t('rt.pkg.memoryImportHint')}</span></span></label>}
  </div>;
}

/** An ArrayBuffer as base64, in chunks (a large zip would overflow String.fromCharCode's arguments). */
export function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer); let out = '';
  for (let at = 0; at < bytes.length; at += 0x8000) out += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(out);
}
