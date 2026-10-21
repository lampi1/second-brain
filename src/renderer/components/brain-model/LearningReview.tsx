// User-controlled dataset replay and candidate promotion. Eligibility and evidence are supplied and rechecked by main.
import { useEffect, useState } from 'react';
import type { EvaluationMeasure, LearningReviewState, ReplayComparison, ReplayRecord, SkillCandidateView } from '@shared/learning-review';
import { sb } from '../../sb';
import { t } from '../../i18n';
import { LearningEvidenceInspector } from './LearningEvidence';

const PROBLEM_KEYS = ['missing-provenance', 'invalid-steps', 'missing-verified-example', 'missing-holdout-replay', 'already-promoted'] as const;
export const promotionProblemText = (code: string): string => PROBLEM_KEYS.includes(code as typeof PROBLEM_KEYS[number]) ? t(`lr.problem.${code as typeof PROBLEM_KEYS[number]}`) : t('lr.problem.unknown');

export const candidateCanPromote = (c: SkillCandidateView): boolean => !c.promoted && c.stepsReady && c.promotionProblems.length === 0 && c.verifiedExampleRunIds.length > 0 && c.eligibleReplayIds.length > 0;

export function CandidateReview({ candidate: c, refresh, replays = [], root }: { candidate: SkillCandidateView; refresh: () => Promise<void>; replays?: ReplayRecord[]; root: string }) {
  const [text, setText] = useState(c.text), [inspected, setInspected] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [replay, setReplay] = useState(''), [example, setExample] = useState('');
  const [readIds, setReadIds] = useState<string[]>([]);
  const selectedReplay = replays.find(r => r.id === replay);
  const proofIds = [example, ...(selectedReplay?.cases.map(c => c.runId ?? '') ?? [])];
  const proofRead = !!example && !!selectedReplay?.cases.length && proofIds.every(id => !!id && readIds.includes(id));
  const markRead = (id: string) => setReadIds(ids => ids.includes(id) ? ids : [...ids, id]);
  const dirty = text !== c.text;
  const act = async (promote: boolean) => {
    if (busy) return; setBusy(true); setError('');
    try {
      if (promote) await sb.invoke('learning:promote', { expectedRoot: root, name: c.name, expectedDigest: c.digest, replayId: replay, exampleRunId: example });
      else await sb.invoke('learning:saveCandidate', { expectedRoot: root, name: c.name, text, expectedDigest: c.digest });
      await refresh(); setInspected(false);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  return <details className="lr-record" data-testid={`candidate-${c.name}`}>
    <summary><b>{c.name}</b> · {c.promoted ? t('lr.promoted') : candidateCanPromote(c) ? t('lr.ready') : t('lr.needsEvidence')}</summary>
    <p>{t('lr.candidateLead')}</p>
    <label>{t('lr.draft')}<textarea className="lr-draft" rows={10} value={text} maxLength={24000} disabled={busy || c.promoted} onChange={e => { setText(e.target.value); setInspected(false); }} /></label>
    <p>{t('lr.draftLimit')} {text.length}/24000</p>
    <div className="lr-buttons"><button className="btn btn-s" disabled={busy || !dirty || !text.trim() || c.promoted} onClick={() => void act(false)}>{t('lr.saveDraft')}</button>{dirty && <span>{t('lr.draftChanged')}</span>}</div>
    <dl className="lr-evidence"><dt>{t('lr.version')}</dt><dd>{c.digest}</dd><dt>{t('lr.sourceRuns')}</dt><dd>{c.sourceRunIds.length ? c.sourceRunIds.join(', ') : t('lr.none')}</dd></dl>
    {c.sourceRunIds.map(id => <LearningEvidenceInspector key={`source:${id}`} root={root} runId={id} onRead={markRead} />)}
    {c.promotionProblems.length > 0 && <ul className="lr-problems">{c.promotionProblems.map(p => <li key={p}>{promotionProblemText(p)}</li>)}</ul>}
    {!c.promoted && <div className="lr-actions">
      <label>{t('lr.verifiedExample')}<select value={example} onChange={e => { setExample(e.target.value); setInspected(false); }}><option value="">{t('lr.select')}</option>{c.verifiedExampleRunIds.map(id => <option key={id}>{id}</option>)}</select></label>
      <label>{t('lr.passedReplay')}<select value={replay} onChange={e => { setReplay(e.target.value); setInspected(false); }}><option value="">{t('lr.select')}</option>{c.eligibleReplayIds.map(id => <option key={id}>{id}</option>)}</select></label>
      {example && <LearningEvidenceInspector key={example} root={root} runId={example} onRead={markRead} />}
      {selectedReplay?.cases.map(c => c.runId ? <LearningEvidenceInspector key={c.runId} root={root} runId={c.runId} onRead={markRead} /> : <p key={c.caseId}>{t('lr.evidenceUnavailable')}</p>)}
      {!proofRead && <p>{t('lr.readEvidenceFirst')}</p>}
      <label className="lr-check"><input type="checkbox" checked={inspected} disabled={dirty || !proofRead} onChange={e => setInspected(e.target.checked)} />{t('lr.inspected')}</label>
      <button className="btn btn-s" disabled={busy || dirty || !proofRead || !inspected || !candidateCanPromote(c) || !c.eligibleReplayIds.includes(replay) || !c.verifiedExampleRunIds.includes(example)} onClick={() => void act(true)}>{t('lr.promote')}</button>
    </div>}
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
