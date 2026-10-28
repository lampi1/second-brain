// Explicitly opened legacy history (ADR 0179). Pending settlements are historical facts, never questions or actions.
// Nothing loads until the archive is expanded; closing it drops the snapshot. Original evidence remains readable.
import { useEffect, useState } from 'react';
import type { FlowSnapshot } from '@shared/flows';
import { sb } from '../sb';
import { t } from '../i18n';
import { openFileViewer } from '../actions';

export function LegacyRoutineHistory() {
  const [open, setOpen] = useState(false), [archive, setArchive] = useState<FlowSnapshot | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    if (open) void sb.invoke('routines:archive', undefined).then(value => { if (alive) setArchive(value); }).catch(() => { if (alive) setError(t('rs.archiveError')); });
    else setArchive(null);
    return () => { alive = false; };
  }, [open]);
  return <details className="rs-card" onToggle={e => setOpen(e.currentTarget.open)} data-testid="routine-archive">
    <summary>{t('rs.archive')}</summary>
    {open && <>
      <p className="rs-muted">{t('rs.archived')}</p>
      {(error || archive?.storageError) && <p role="alert">{error || archive?.storageError}</p>}
      {archive?.runs.map(run => <details key={run.id} className="rs-card">
        <summary>{run.title ?? run.flowId} · {run.status} · {new Date(run.createdAt).toLocaleString()}</summary>
        <p>{run.id} · v{run.flowVersion}</p>
        {run.settlementError && <p>{run.settlementError}</p>}
        {run.disposition?.error && <p>{run.disposition.error}</p>}
        <ol>{run.steps.map((step, i) => <li key={`${step.stepId}/${i}`}>
          <strong>{step.stepId}</strong> · {step.status}
          {step.reason && <p>{step.reason}</p>}{step.receipt && <pre className="rs-archive-evidence">{JSON.stringify(step.receipt, null, 2)}</pre>}
        </li>)}</ol>
        {run.outputs?.map(output => <details key={output.id}><summary>{output.id}</summary><pre className="rs-archive-evidence">{output.content}</pre></details>)}
        {run.dossierPath && <button type="button" className="btn btn-ghost btn-s" onClick={() => openFileViewer(run.dossierPath!)}>{t('rs.report')}</button>}
        <details><summary>{t('rs.evidence')}</summary><pre className="rs-archive-evidence">{JSON.stringify(run, null, 2)}</pre></details>
      </details>)}
    </>}
  </details>;
}
