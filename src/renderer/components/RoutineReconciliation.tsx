// User-only, per-operation reconciliation with explicit evidence; no remote action or hidden blanket acknowledgement.
// Every pending write shows its op, time and hash and can always be marked, even when its original request was never
// recorded (main/flows/runtime.ts reconcileScope keeps the scope it was written under).
import { useEffect, useState } from 'react';
import type { ReconcileWrites, ReconciliationView, WriteResolution } from '@shared/flow-reconciliation';
import { sb } from '../sb';
import { plain, reloadFlows } from '../store/flows';
import { Modal } from './ui';
import { t, locale } from '../i18n';
export function RoutineReconciliation({ contextKey, runId, onClose }: { contextKey: string; runId: string; onClose: () => void }) {
  const [view, setView] = useState<ReconciliationView | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, { outcome: WriteResolution | ''; note: string }>>({});
  useEffect(() => { let active = true; void sb.invoke('flows:writeReconciliation', { contextKey, runId }).then(v => { if (active) setView(v); }).catch(e => { if (active) setError(plain(e)); }); return () => { active = false; }; }, [contextKey, runId]);
  const chosen = Object.entries(decisions).filter(([, d]) => d.outcome);
  const valid = !!view?.canReconcile && chosen.length > 0 && chosen.every(([, d]) => d.note.trim().length >= 8);
  const save = async () => {
    if (!view || !valid || busy) return;
    setBusy(true); setError('');
    try {
      const input: ReconcileWrites = { runId, expectedRevision: view.revision, digest: view.digest, decisions: chosen.map(([id, d]) => ({ id, outcome: d.outcome as WriteResolution, note: d.note.trim() })) };
      setView(await sb.invoke('flows:reconcileWrites', { contextKey, ...input })); setDecisions({}); void reloadFlows();
    } catch (e) { setError(plain(e)); } finally { setBusy(false); }
  };
  return <Modal label={t('flows.reconcileTitle')} title={t('flows.reconcileTitle')} onClose={onClose} size="m" bodyClassName="routine-reconciliation" testid="routine-reconciliation">
    <p>{t('flows.reconcileHint')}</p><p className="flows-muted">Run <code>{runId}</code></p>
    {view?.workItem && <p><a href={view.workItem.url} target="_blank" rel="noreferrer">{view.workItem.organization} · #{view.workItem.id}</a></p>}
    {view?.blockedReason && <p className="flow-block" role="status">{view.blockedReason}</p>}
    {view && !view.operations.length && <p>{t('flows.reconcileEmpty')}</p>}
    {view?.operations.map(op => <section className="flow-target" key={op.id} data-testid="reconcile-operation">
      <p><strong>{op.op}</strong> · {op.state} · <span>{op.at ? new Date(op.at).toLocaleString(locale()) : '—'}</span></p>
      <div aria-label={t('flows.reconcileIdentity')}>{t('flows.reconcileHash')} <code style={{ overflowWrap: 'anywhere' }} data-testid="reconcile-hash">{op.id}</code><p>{op.request ? `Work item #${op.request.workItemId} · PR #${op.request.pullRequestId} · ${op.request.projectId} / ${op.request.repositoryId}` : op.target ?? t('flows.reconcileLegacy')}</p></div>
      {op.reason && <p className="flows-muted">{op.reason}</p>}
      {op.reconciliation && <p>{t('flows.reconciled')}: {t(`flows.resolution.${op.reconciliation.outcome}`)} — {op.reconciliation.note}</p>}
      {op.eligible && <>
        <label>{t('flows.reconcileOutcome')} <select className="st-input" disabled={busy} value={decisions[op.id]?.outcome ?? ''} onChange={e => setDecisions(v => ({ ...v, [op.id]: { note: v[op.id]?.note ?? '', outcome: e.target.value as WriteResolution | '' } }))}>
          <option value="">{t('flows.reconcileUnselected')}</option>{(['not-done', 'reverted', 'done'] as const).map(value => <option key={value} value={value}>{t(`flows.resolution.${value}`)}</option>)}
        </select></label>
        {decisions[op.id]?.outcome && <label>{t('flows.reconcileEvidence')}<textarea className="st-input" rows={2} maxLength={2000} value={decisions[op.id]?.note ?? ''} disabled={busy} onChange={e => setDecisions(v => ({ ...v, [op.id]: { outcome: v[op.id]?.outcome ?? '', note: e.target.value } }))} /></label>}
      </>}
    </section>)}
    {error && <p className="flow-block" role="alert">{error}</p>}
    <p>{chosen.length ? t('flows.reconcileQuestion', { n: chosen.length }) : t('flows.reconcilePick')}</p>
    <div className="flow-actions"><button type="button" className="btn btn-primary" data-testid="reconcile-confirm" disabled={!valid || busy} onClick={() => void save()}>{t('flows.yes')}</button><button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('flows.no')}</button></div>
  </Modal>;
}
