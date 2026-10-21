// Inspect retained deliverables and their independent reviews before claiming the candidate evidence was read.
import { useState } from 'react';
import type { LearningEvidence, LearningEvidenceRun } from '@shared/learning-review';
import { sb } from '../../sb';
import { t } from '../../i18n';

export function EvidenceRun({ run }: { run: LearningEvidenceRun }) {
  const result = run.report?.canonical;
  return <article className="lr-evidence-run">
    <h5>{run.agentId} · {run.runId}</h5><p>{run.goal}</p>
    {run.reviewOf && <p>{t('lr.reviewOf')} {run.reviewOf}</p>}
    <p>{t('lr.verdict')}: {run.outcome ? `${t(`lr.verdict.${run.outcome.verdict}`)} · ${t(`lr.basis.${run.outcome.basis}`)}` : run.report?.verdict ? t(`lr.verdict.${run.report.verdict}`) : t('lr.unknown')}</p>
    {run.outcome?.note && <p>{run.outcome.note}</p>}
    {run.report && <p>{t('lr.verification')}: {t(`lr.verified.${run.report.verified}`)}</p>}
    {result ? <><h5>{t('lr.deliverable')}</h5><p>{result.summary}</p><pre className="lr-output">{result.output}</pre><h5>{t('lr.criteria')}</h5><ul>{result.doneWhen.map((c, i) => <li key={i}>{c.met ? t('lr.passed') : t('lr.failed')} · {c.criterion}</li>)}</ul></> : <><p>{t('lr.fullUnavailable')}</p>{run.report?.summary && <p>{run.report.summary}</p>}</>}
  </article>;
}

export function LearningEvidenceInspector({ runId, root, onRead }: { runId: string; root: string; onRead?: (id: string) => void }) {
  const [evidence, setEvidence] = useState<LearningEvidence | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true); setError('');
    try { const next = await sb.invoke('learning:evidence', { runId, expectedRoot: root }); setEvidence(next); if (next.run.report?.canonical) onRead?.(runId); }
    catch { setError(t('lr.evidenceUnavailable')); } finally { setBusy(false); }
  };
  return <div className="lr-proof" data-testid={`learning-evidence-${runId}`}>
    <button type="button" className="btn btn-ghost btn-s" disabled={busy} onClick={() => void load()}>{t('lr.inspectEvidence')} · {runId}</button>
    {error && <p role="alert">{error}</p>}
    {evidence && <details open><summary>{t('lr.retainedEvidence')}</summary><EvidenceRun run={evidence.run} /><h5>{t('lr.independentReviews')}</h5>{evidence.reviews.length ? evidence.reviews.map(r => <EvidenceRun key={r.runId} run={r} />) : <p>{t('lr.noIndependentReviews')}</p>}</details>}
  </div>;
}
