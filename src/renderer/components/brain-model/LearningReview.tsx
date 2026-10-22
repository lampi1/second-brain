// User-controlled dataset replay and the skill candidates' drafts with their evidence (read only). A candidate is promoted
// or rejected only in Memoria → Proposte (ProposalsDeck.tsx, ADR 0123); eligibility and evidence come from main and are
// checked again there.
import { useEffect, useState } from 'react';
import type { EvaluationMeasure, LearningReviewState, ReplayComparison, ReplayRecord, SkillCandidateView } from '@shared/learning-review';
import { sb } from '../../sb';
import { t } from '../../i18n';
import { LearningEvidenceInspector } from './LearningEvidence';
import { ProposalsPointer } from './ProposalsPointer';

const PROBLEM_KEYS = ['missing-provenance', 'invalid-steps', 'missing-verified-example', 'missing-holdout-replay', 'already-promoted'] as const;
export const promotionProblemText = (code: string): string => PROBLEM_KEYS.includes(code as typeof PROBLEM_KEYS[number]) ? t(`lr.problem.${code as typeof PROBLEM_KEYS[number]}`) : t('lr.problem.unknown');

export const candidateCanPromote = (c: SkillCandidateView): boolean => !c.promoted && c.stepsReady && c.promotionProblems.length === 0 && c.verifiedExampleRunIds.length > 0 && c.eligibleReplayIds.length > 0;

/** A candidate's draft (editable until promoted) and its evidence; the promotion itself is decided only in Memoria →
 *  Proposte (ADR 0123), where main picks the verified example and the passed replay and checks them again. */
export function CandidateReview({ candidate: c, refresh, replays = [], root }: { candidate: SkillCandidateView; refresh: () => Promise<void>; replays?: ReplayRecord[]; root: string }) {
  const [text, setText] = useState(c.text), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const dirty = text !== c.text;
  const save = async () => {
    if (busy) return; setBusy(true); setError('');
    try { await sb.invoke('learning:saveCandidate', { expectedRoot: root, name: c.name, text, expectedDigest: c.digest }); await refresh(); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const proof = replays.filter(r => c.eligibleReplayIds.includes(r.id));
  return <details className="lr-record" data-testid={`candidate-${c.name}`}>
    <summary><b>{c.name}</b> · {c.promoted ? t('lr.promoted') : candidateCanPromote(c) ? t('lr.ready') : t('lr.needsEvidence')}</summary>
    <p>{t('lr.candidateLead')}</p>
    <label>{t('lr.draft')}<textarea className="lr-draft" rows={10} value={text} maxLength={24000} disabled={busy || c.promoted} onChange={e => setText(e.target.value)} /></label>
    <p>{t('lr.draftLimit')} {text.length}/24000</p>
    <div className="lr-buttons"><button className="btn btn-s" disabled={busy || !dirty || !text.trim() || c.promoted} onClick={() => void save()}>{t('lr.saveDraft')}</button>{dirty && <span>{t('lr.draftChanged')}</span>}</div>
    <dl className="lr-evidence"><dt>{t('lr.version')}</dt><dd>{c.digest}</dd><dt>{t('lr.sourceRuns')}</dt><dd>{c.sourceRunIds.length ? c.sourceRunIds.join(', ') : t('lr.none')}</dd>
      <dt>{t('lr.verifiedExample')}</dt><dd>{c.verifiedExampleRunIds.length ? c.verifiedExampleRunIds.join(', ') : t('lr.none')}</dd>
      <dt>{t('lr.passedReplay')}</dt><dd>{c.eligibleReplayIds.length ? c.eligibleReplayIds.join(', ') : t('lr.none')}</dd></dl>
    {[...new Set([...c.sourceRunIds, ...c.verifiedExampleRunIds])].map(id => <LearningEvidenceInspector key={`run:${id}`} root={root} runId={id} />)}
    {proof.flatMap(r => r.cases).map(x => x.runId ? <LearningEvidenceInspector key={`case:${x.runId}`} root={root} runId={x.runId} /> : <p key={x.caseId}>{t('lr.evidenceUnavailable')}</p>)}
    {c.promotionProblems.length > 0 && <ul className="lr-problems">{c.promotionProblems.map(p => <li key={p}>{promotionProblemText(p)}</li>)}</ul>}
    {!c.promoted && <ProposalsPointer compact />}
    {error && <p role="alert">{error}</p>}
  </details>;
}

const measure = (m: EvaluationMeasure) => m.value === null ? `${t('lr.unknown')} (${m.n}/${m.total})` : `${Math.round(m.value * 1000) / 1000} (${m.n}/${m.total})`;
export function ComparisonTable({ comparison: c }: { comparison: ReplayComparison }) {
  const rows: [string, EvaluationMeasure, EvaluationMeasure][] = [
    [t('lr.quality'), c.before.quality, c.after.quality], [t('lr.turns'), c.before.turns, c.after.turns],
    [t('lr.cost'), c.before.costUsd, c.after.costUsd], [t('lr.elapsed'), c.before.elapsedMs, c.after.elapsedMs],
    ...(['input', 'output', 'cacheRead', 'cacheWrite'] as const).map(k => [t(`lr.tokens.${k}`), c.before.tokens[k], c.after.tokens[k]] as [string, EvaluationMeasure, EvaluationMeasure]),
  ];
  return <div data-testid="learning-comparison"><p>{t('lr.comparisonMethod')}</p><p>{t('lr.comparisonNote')} {c.pairedCases}</p>
    {c.comparable && <table className="bm-table"><thead><tr><th>{t('lr.metric')}</th><th>{t('lr.before')}</th><th>{t('lr.after')}</th></tr></thead><tbody>{rows.map(([label, before, after]) => <tr key={label}><th scope="row">{label}</th><td>{measure(before)}</td><td>{measure(after)}</td></tr>)}</tbody></table>}
  </div>;
}

export function LearningReview({ root }: { root: string }) {
  const [state, setState] = useState<LearningReviewState | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [dataset, setDataset] = useState(''), [candidate, setCandidate] = useState(''), [split, setSplit] = useState<'tuning' | 'holdout'>('tuning');
  const [before, setBefore] = useState(''), [after, setAfter] = useState(''), [comparison, setComparison] = useState<ReplayComparison | null>(null);
  const refresh = async () => { setState(await sb.invoke('learning:state', undefined)); };
  useEffect(() => { let active = true; void sb.invoke('learning:state', undefined).then(s => { if (active) setState(s); }).catch(e => { if (active) setError(String(e)); }); return () => { active = false; }; }, []);
  const running = state?.replays.some(r => r.status === 'running' || r.status === 'awaiting-review');
  useEffect(() => { if (!running) return; const timer = setInterval(() => { void refresh().catch(e => setError(String(e))); }, 3000); return () => clearInterval(timer); }, [running]);
  const act = async (run: () => Promise<unknown>) => { if (busy) return; setBusy(true); setError(''); try { await run(); await refresh(); } catch (e) { setError(String(e)); } finally { setBusy(false); } };
  const importFile = async (file?: File) => { if (!file) return; await act(async () => { if (file.size > 1_000_000) throw new Error(t('lr.fileTooLarge')); const raw: unknown = JSON.parse(await file.text()); await sb.invoke('learning:import', { expectedRoot: root, dataset: raw }); }); };
  const selected = state?.datasets.find(d => d.id === dataset);
  return <section className="bm-panel lr-panel" data-testid="learning-review">
    <header><h3>{t('lr.learningTitle')}</h3><p>{t('lr.learningLead')}</p></header>
    {error && <p role="alert">{error}</p>}
    {!state ? (!error && <p>{t('lr.loading')}</p>) : <>
      <details><summary>{t('lr.importTitle')}</summary><p>{t('lr.importLead')}</p>
        <label>{t('lr.importFile')}<input type="file" accept="application/json,.json" disabled={busy} onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ''; }} data-testid="learning-import" /></label>
        <p>{t('lr.syntheticWarning')}</p>
      </details>
      <p data-testid="learning-replay-cost">{t('lr.replayCost')}</p>
      <div className="lr-toolbar">
        <label>{t('lr.dataset')}<select value={dataset} onChange={e => setDataset(e.target.value)}><option value="">{t('lr.select')}</option>{state.datasets.map(d => <option key={d.id} value={d.id}>{d.name} · {d.origin}</option>)}</select></label>
        <label>{t('lr.candidate')}<select value={candidate} onChange={e => setCandidate(e.target.value)}><option value="">{t('lr.baseline')}</option>{state.candidates.filter(c => !c.promoted).map(c => <option key={c.name}>{c.name}</option>)}</select></label>
        <label>{t('lr.split')}<select value={split} onChange={e => setSplit(e.target.value as 'tuning' | 'holdout')}><option value="tuning">{t('lr.tuning')}</option><option value="holdout">{t('lr.holdout')}</option></select></label>
        <button className="btn btn-s" disabled={busy || !state.replayAvailable || !selected?.cases.some(c => c.split === split)} onClick={() => void act(() => sb.invoke('learning:replay', { expectedRoot: root, datasetId: dataset, split, ...(candidate ? { candidateName: candidate } : {}) }))}>{t('lr.replay')}</button>
        <button className="btn btn-ghost btn-s" disabled={busy} onClick={() => void act(refresh)}>{t('lr.refresh')}</button>
      </div>
      {!state.replayAvailable && <p>{t('lr.replayUnavailable')}</p>}
      {selected && <details><summary>{t('lr.inspectDataset')} · {selected.cases.length}</summary><p>{selected.digest}</p>{selected.origin === 'synthetic' && <p>{t('lr.syntheticWarning')}</p>}<ul>{selected.cases.map(c => <li key={c.id}><b>{c.id} · {c.family} · {c.split}</b><p>{c.input}</p><ul>{c.criteria.map((v, i) => <li key={i}>{v}</li>)}</ul></li>)}</ul></details>}
      <h4>{t('lr.replays')}</h4>
      {!state.replays.length ? <p className="bm-empty">{t('lr.replaysEmpty')}</p> : state.replays.map(r => <details key={r.id} className="lr-record"><summary>{r.id} · {r.candidate?.name ?? t('lr.baseline')} · {r.split} · {t(`lr.replayStatus.${r.status}`)}</summary><p>{r.datasetId} · {r.datasetDigest}</p><ul>{r.cases.map(c => <li key={c.caseId}>{c.caseId} · {c.passed === null ? t('lr.unknown') : c.passed ? t('lr.passed') : t('lr.failed')}{c.runId && <LearningEvidenceInspector root={root} runId={c.runId} />}{c.error && <p role="alert">{c.error}</p>}</li>)}</ul></details>)}
      {state.replays.length > 1 && <details><summary>{t('lr.compare')}</summary><div className="lr-toolbar">{([['before', before, setBefore], ['after', after, setAfter]] as const).map(([key, value, set]) => <label key={key}>{t(`lr.${key}`)}<select value={value} onChange={e => { set(e.target.value); setComparison(null); }}><option value="">{t('lr.select')}</option>{state.replays.map(r => <option key={r.id}>{r.id}</option>)}</select></label>)}<button className="btn btn-s" disabled={busy || !before || !after || before === after} onClick={() => void act(async () => setComparison(await sb.invoke('learning:compare', { beforeId: before, afterId: after })))}>{t('lr.compare')}</button></div>{comparison && <ComparisonTable comparison={comparison} />}</details>}
      <h4>{t('lr.candidates')}</h4>{state.candidates.length ? state.candidates.map(c => <CandidateReview key={`${c.name}:${c.digest}:${c.promoted}`} candidate={c} root={root} replays={state.replays} refresh={refresh} />) : <p className="bm-empty">{t('lr.candidatesEmpty')}</p>}
    </>}
  </section>;
}
