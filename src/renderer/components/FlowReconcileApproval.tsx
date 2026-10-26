// Exact pending-write attestation in the existing questions modal; only user IPC can save and resume it.
import { useRef, useState } from 'react';
import type { FlowReconcileAsk } from '../lib/flow-ask';
import { sb } from '../sb';
import { plain, reloadFlows } from '../store/flows';
import { t, locale } from '../i18n';
import { DecisionCard } from './DecisionCard';
export function FlowReconcileApproval({ ask, onEscape }: { ask: FlowReconcileAsk; onEscape: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), sending = useRef(false);
  const pending = ask.run.pendingReconciliation;
  if (!pending) return null;
  const decide = async (answer: 'yes' | 'no') => {
    if (sending.current) return;
    sending.current = true; setBusy(true); setError('');
    try { await sb.invoke('flows:reconcileDecide', { contextKey: ask.contextKey, runId: ask.run.id, expectedRevision: ask.run.revision, answer }); await reloadFlows(); }
    catch (e) { setError(plain(e)); } finally { sending.current = false; setBusy(false); }
  };
  return <DecisionCard testBase="qwin-flow-reconcile" className="wq flow-review" busy={busy} laterButton={false} onLater={onEscape}
    rootProps={{ 'data-request-key': `${ask.chatId}/${ask.id}`, 'aria-label': ask.title }} head={<b>{ask.title} · {pending.op}</b>}
    voiceId={`${ask.chatId}/${ask.id}`} speakFrom={ask.title}
    speakDone={`${pending.op} · ${ask.run.subjectKey}. ${t(pending.outcome === 'applied' ? 'flows.resolution.done' : 'flows.resolution.not-done')}. ${pending.evidence}`}
    question={t('flows.reconcileProposedQuestion')} ifYes={t('flows.reconcileResumeHint')} ifNo={t('flows.reconcileDeclineHint')}
    yes={{ label: t('flows.yes'), recommended: true, onChoose: () => void decide('yes'), testid: 'flow-reconcile-yes' }}
    no={{ label: t('flows.no'), onChoose: () => void decide('no'), testid: 'flow-reconcile-no' }}>
    <p><strong>{t(pending.outcome === 'applied' ? 'flows.resolution.done' : 'flows.resolution.not-done')}</strong></p>
    <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{pending.evidence}</p>
    <p>{ask.run.subjectKey} · {pending.operationAt ? new Date(pending.operationAt).toLocaleString(locale()) : '—'}</p><details><summary>{t('flows.reconcileIdentity')}</summary><p>Run {ask.run.id} · {ask.run.steps[ask.run.currentStep]?.stepId}</p></details><code style={{ overflowWrap: 'anywhere' }}>{pending.requestHash}</code>
    {error && <p role="alert" className="flow-block">{error}</p>}
  </DecisionCard>;
}
