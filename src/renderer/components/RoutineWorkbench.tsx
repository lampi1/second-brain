// Readiness and evidence comparisons in a compact native modal; detailed explanations stay with the Orchestrator.
import { useEffect, useState } from 'react';
import type { FlowRun, FlowSnapshot } from '@shared/flows';
import type { RoutineEvalSuite, RoutineWorkbenchRequest, RoutineWorkbenchResult } from '@shared/routine-workbench';
import { sb } from '../sb';
import { plain } from '../store/flows';
import { t } from '../i18n';
import { Modal } from './ui';
export function RoutineWorkbench({ snapshot, flowId, version, run, onClose, onDiscuss }: { snapshot: FlowSnapshot; flowId: string; version: number; run?: FlowRun; onClose: () => void; onDiscuss: () => void }) {
  const [data, setData] = useState<RoutineWorkbenchResult>({}), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const call = async (request: RoutineWorkbenchRequest) => {
    setBusy(true); setError('');
    try { const result = await sb.invoke('routine:workbench', { contextKey: snapshot.contextKey, request }); setData(old => ({ ...old, ...result })); }
    catch (e) { setError(plain(e)); } finally { setBusy(false); }
  };
  useEffect(() => { let valid = true; setBusy(true);
    void Promise.all([
      sb.invoke('routine:workbench', { contextKey: snapshot.contextKey, request: { op: 'readiness', flowId, version, ...(run ? { inputs: run.inputs } : {}) } }),
      sb.invoke('routine:workbench', { contextKey: snapshot.contextKey, request: { op: 'compare', flowId } }),
      sb.invoke('routine:workbench', { contextKey: snapshot.contextKey, request: { op: 'suites', flowId } }),
    ]).then(results => { if (valid) setData(Object.assign({}, ...results)); }).catch(e => { if (valid) setError(plain(e)); }).finally(() => { if (valid) setBusy(false); });
    return () => { valid = false; };
  }, [snapshot.contextKey, flowId, version, run?.id]);
  const exportSummary = () => {
    // This portable, read-only snapshot contains aggregate observations; no inputs, prompts, credentials or control URL.
    const value = { schema: 1, exportedAt: new Date().toISOString(), comparison: data.comparison, evaluation: data.evaluation };
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })), link = document.createElement('a'); link.href = url; link.download = `routine-observations-v${version}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const checks = data.readiness?.checks ?? [], failures = checks.filter(c => c.state === 'fail'), unknown = checks.filter(c => c.state === 'unknown');
  return <Modal isolateWorkspace onClose={onClose} closeButton size="m" style={{ width: 'min(900px, calc(100vw - 40px))' }} label={t('rt.workbench.title')} title={t('rt.workbench.title')} subtitle={`${flowId} · v${version}`} testid="routine-workbench"
    footer={<><button type="button" className="btn btn-ghost btn-s" onClick={exportSummary} disabled={busy || !data.comparison}>{t('rt.workbench.export')}</button><span className="sp" /><button type="button" className="btn btn-primary btn-s" onClick={onDiscuss}>{t('rt.workbench.discuss')}</button></>}>
    {error && <p className="flow-block" role="alert">{error}</p>}{busy && <p role="status">{t('rt.components.busy')}</p>}
    {data.readiness && <section><h3>{t('rt.workbench.readiness')}</h3><p>{t('rt.workbench.counts', { failed: failures.length, unknown: unknown.length })}</p>
      <p className="rt-muted">{t('rt.workbench.noGuarantee')}</p>
      <details open={failures.length > 0}><summary>{t('rt.workbench.checks')}</summary>{checks.map((c, i) => <p key={i} className={c.state === 'fail' ? 'flow-block' : 'rt-muted'}><strong>{c.state === 'pass' ? '✓' : c.state === 'fail' ? '!' : c.state === 'unknown' ? '?' : '◈'} {c.stepId ?? flowId}</strong> · {c.detail}</p>)}</details></section>}
    {data.comparison && <section><h3>{t('rt.workbench.versions')}</h3><div className="routine-stats-scroll"><table className="routine-stats"><thead><tr>{(['version', 'runs', 'completed', 'blocked', 'retries', 'evidence'] as const).map(id => <th key={id}>{t(`rt.workbench.${id}`)}</th>)}</tr></thead><tbody>
      {data.comparison.versions.map(v => <tr key={v.version}><td>v{v.version}</td><td>{v.runs}</td><td>{v.completed}</td><td>{v.blocked}</td><td>{v.retries}</td><td>{v.completeEvidence}/{v.completed}</td></tr>)}
    </tbody></table></div><p className="rt-muted">{t('rt.workbench.comparisonHint')}</p><details><summary>{t('rt.workbench.coverage')}</summary>{data.comparison.caveats.map(c => <p key={c}>{c}</p>)}</details></section>}
    <section><h3>{t('rt.workbench.evaluate')}</h3><p className="rt-muted">{t('rt.workbench.evalHint')}</p>
      {data.suites?.map(s => <button type="button" className="btn btn-ghost btn-s" key={s.id} disabled={busy} onClick={() => void call({ op: 'evaluate', suiteId: s.id, version })}>{s.id} · {s.cases.length}</button>)}
      <details><summary>{t('rt.workbench.importCases')}</summary><input type="file" accept=".json" aria-label={t('rt.workbench.importCases')} disabled={busy} onChange={e => {
        const file = e.target.files?.[0]; if (!file) return; if (file.size > 128 * 1024) { setError(t('rt.workbench.tooLarge')); return; }
        void file.text().then(content => { const suite = JSON.parse(content) as Omit<RoutineEvalSuite, 'digest' | 'createdAt'>; if (suite.flowId !== flowId) throw new Error(t('rt.workbench.wrongRoutine')); return call({ op: 'suite-save', suite }); }).catch(e => setError(plain(e)));
      }} /><p><code>{'{id, flowId, cases:[{id, subjectKey, expected, evidence:[{stepId,label}], split}]}'}</code></p></details>
      {data.evaluation && <div data-testid="routine-evaluation">{data.evaluation.cases.map(c => <p key={c.id}><strong>{c.id} · {c.state}</strong> · {c.split}{c.reasons.length ? ` — ${c.reasons.join('; ')}` : ''}</p>)}<p className="rt-muted">{t('rt.workbench.evidenceHint')}</p></div>}
    </section>
  </Modal>;
}
