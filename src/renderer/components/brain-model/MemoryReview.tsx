// Explicit memory review on the Memoria page: provenance and historical snapshots precede user-only decisions.
import { useEffect, useState } from 'react';
import type { MemoryReviewRecord } from '@shared/learning-review';
import { sb } from '../../sb';
import { t } from '../../i18n';

export function MemoryEvidence({ record: r }: { record: MemoryReviewRecord }) {
  return <dl className="lr-evidence">
    <dt>{t('lr.scope')}</dt><dd>{Object.entries(r.scope).map(([k, v]) => `${k}: ${v}`).join(' · ')}</dd>
    <dt>{t('lr.source')}</dt><dd>{r.sourceRunId} · {r.sourceEventId}</dd>
    <dt>{t('lr.observed')}</dt><dd><time dateTime={r.observedAt}>{r.observedAt}</time></dd>
    <dt>{t('lr.validity')}</dt><dd>{r.validFrom} → {r.validTo ?? t('lr.current')}</dd>
    {r.verification && <><dt>{t('lr.evidence')}</dt><dd>{r.verification.evidence}<small>{r.verification.sourceRunId} · {r.verification.sourceEventId}</small></dd></>}
    {r.supersedes && <><dt>{t('lr.supersedes')}</dt><dd>{r.supersedes}</dd></>}
  </dl>;
}

export function MemoryReviewCard({ record, historical, onRefresh, root }: { root: string; record: MemoryReviewRecord; historical: boolean; onRefresh: () => Promise<void> }) {
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [deleting, setDeleting] = useState(false);
  const act = async (op: 'confirm' | 'reject' | 'retract' | 'delete') => {
    if (busy || historical) return;
    setBusy(true); setError('');
    try {
      if (op === 'confirm') await sb.invoke('memory:confirm', { expectedRoot: root, id: record.memoryId, evidence: reason.trim() });
      else if (op === 'delete') await sb.invoke('memory:delete', { expectedRoot: root, id: record.memoryId });
      else await sb.invoke('memory:retract', { expectedRoot: root, id: record.memoryId, reason: op === 'reject' ? `${t('lr.rejected')}: ${reason.trim()}` : reason.trim() });
      await onRefresh(); setReason(''); setDeleting(false);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  return <article className="lr-record" data-testid={`memory-review-${record.memoryId}`}>
    <header><h4>{record.subject} · {record.predicate}</h4><span className="bm-tag">{t(`lr.status.${record.status}`)}</span></header>
    <p>{record.value}</p><MemoryEvidence record={record} />
    {!!record.transitions?.length && <details><summary>{t('lr.history')}</summary><ul>{record.transitions.map((x, i) => <li key={i}>{x.at} · {t(`lr.status.${x.status}`)}{x.reason && ` · ${x.reason}`}</li>)}</ul></details>}
    {!historical && <div className="lr-actions">
      {record.status !== 'retracted' && <label>{record.status === 'proposed' ? t('lr.evidenceInput') : t('lr.reason')}<input className="sk-input" value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} /></label>}
      <div className="lr-buttons">
        {record.status === 'proposed' && <><button className="btn btn-s" disabled={busy || !reason.trim()} onClick={() => void act('confirm')}>{t('lr.confirm')}</button><button className="btn btn-ghost btn-s" disabled={busy || !reason.trim()} onClick={() => void act('reject')}>{t('lr.reject')}</button></>}
        {record.status !== 'retracted' && record.status !== 'proposed' && <button className="btn btn-ghost btn-s" disabled={busy || !reason.trim()} onClick={() => void act('retract')}>{t('lr.retract')}</button>}
        {!deleting ? <button className="btn btn-ghost btn-s" disabled={busy} onClick={() => setDeleting(true)}>{t('lr.delete')}</button> : <><span>{t('lr.deleteWarning')}</span><button className="btn btn-s" disabled={busy} onClick={() => void act('delete')}>{t('lr.deleteConfirm')}</button><button className="btn btn-ghost btn-s" disabled={busy} onClick={() => setDeleting(false)}>{t('lr.cancel')}</button></>}
      </div>
    </div>}
    {error && <p role="alert">{error}</p>}
  </article>;
}

export function MemoryReview({ root }: { root: string }) {
  const [records, setRecords] = useState<MemoryReviewRecord[]>([]), [asOf, setAsOf] = useState(''), [snapshot, setSnapshot] = useState('');
  const [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const refresh = async () => { setRecords(await sb.invoke('memory:reviewList', snapshot ? { asOf: snapshot } : undefined)); };
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    void sb.invoke('memory:reviewList', snapshot ? { asOf: snapshot } : undefined).then(rows => { if (active) setRecords(rows); }).catch(e => { if (active) setError(String(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [snapshot]);
  return <section className="bm-panel lr-panel" data-testid="memory-review">
    <header><h3>{t('lr.memoryTitle')}</h3><p>{t('lr.memoryLead')}</p></header>
    <form className="lr-toolbar" onSubmit={e => { e.preventDefault(); setSnapshot(asOf ? new Date(asOf).toISOString() : ''); }}>
      <label>{t('lr.asOf')}<input type="datetime-local" value={asOf} onChange={e => setAsOf(e.target.value)} /></label>
      <button className="btn btn-s">{t('lr.show')}</button><button type="button" className="btn btn-ghost btn-s" disabled={loading} onClick={() => { setError(''); void refresh().catch(e => setError(String(e))); }}>{t('lr.refresh')}</button>{snapshot && <button type="button" className="btn btn-ghost btn-s" onClick={() => { setAsOf(''); setSnapshot(''); }}>{t('lr.today')}</button>}
    </form>
    {snapshot && <p role="status">{t('lr.historical')} {snapshot}</p>}
    {error && <p role="alert">{error}</p>}
    {loading ? <p>{t('lr.loading')}</p> : records.length ? <div className="lr-records">{records.map(r => <MemoryReviewCard key={`${snapshot}:${r.memoryId}`} record={r} root={root} historical={!!snapshot} onRefresh={refresh} />)}</div> : <p className="bm-empty">{t('lr.memoryEmpty')}</p>}
  </section>;
}
