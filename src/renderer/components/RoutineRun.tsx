// The live view of one routine run (ADR 0175): what the run is doing now comes from the shared `progressFrom(events)`,
// the same reducer the terminal `routine watch` line uses, so the app and the terminal never disagree. Shows the
// current step, the last action, the newest screenshot, a red card when a person is needed (with the DevOps comment
// link), writes whose effect could not be verified, the steps with their files, report.md and the resume command.
// Pure (props in, markup out): the Routine page polls the run and passes it here; unit tests render it directly.
import { progressFrom } from '../../../packages/routine-runtime/src/events';
import type { RoutineRunDetail } from '@shared/routines';
import { t } from '../i18n';

const time = (ts?: number) => ts ? new Date(ts).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
const base = (p: string) => p.split(/[\\/]/).pop() ?? p;

export const statusLabel = (status: string): string => {
  switch (status) {
    case 'running': return t('rs.status.running');
    case 'waiting-human': return t('rs.status.waiting');
    case 'needs-human': return t('rs.status.needsHuman');
    case 'done': return t('rs.status.done');
    case 'failed': return t('rs.status.failed');
    case 'cancelled': return t('rs.status.cancelled');
    case 'pending': return t('rs.status.pending');
    default: return status;
  }
};
export const statusTone = (status: string): string =>
  status === 'waiting-human' || status === 'needs-human' || status === 'failed' ? 'red' : status === 'done' ? 'green' : status === 'running' ? 'blue' : 'grey';

export interface RoutineRunViewProps {
  run: RoutineRunDetail;
  onOpenFile: (path: string) => void;
  onCopy: (text: string) => void;
  onCancel?: () => void;
}

export function RoutineRunView({ run, onOpenFile, onCopy, onCancel }: RoutineRunViewProps) {
  const p = progressFrom(run.events);
  const status = p.status || run.status;
  return <section className="rs-run" data-testid="routine-run-view" data-status={status}>
    <header className="rs-run-head">
      <span className="rs-badge" data-tone={statusTone(status)}>{statusLabel(status)}</span>
      <span className="rs-badge" data-tone="grey">{run.source === 'app' ? t('rs.source.app') : t('rs.source.terminal')}</span>
      {run.workItem !== undefined && (run.workItemUrl
        ? <a className="rs-link" href={run.workItemUrl} target="_blank" rel="noopener noreferrer">{t('rs.workItem', { id: run.workItem })}</a>
        : <span>{t('rs.workItem', { id: run.workItem })}</span>)}
      <span className="rs-muted">{time(run.createdAt)}</span>
      <span className="rs-sp" />
      {run.reportPath && <button type="button" className="btn btn-primary btn-s" onClick={() => onOpenFile(run.reportPath!)} data-testid="run-report">{t('rs.report')}</button>}
      {run.cancellable && onCancel && <button type="button" className="btn btn-ghost btn-s" onClick={onCancel} data-testid="run-cancel">{t('rs.cancel')}</button>}
    </header>

    {p.step && <div className="rs-now" data-testid="run-current-step">
      <strong>{t('rs.stepOf', { n: p.step.n, total: p.step.total })}</strong> {p.step.title}
      {p.lastAction && <p className="rs-action" data-testid="run-last-action">{p.lastAction}</p>}
    </div>}

    {p.waiting && <div className="rs-waiting" role="alert" data-testid="run-waiting">
      <strong>{t('rs.waiting')}</strong>
      <p>{p.waiting.question}</p>
      {p.waiting.url && <a className="rs-link" href={p.waiting.url} target="_blank" rel="noopener noreferrer">{t('rs.waitingLink')}</a>}
      <p className="rs-muted">{t('rs.waitingHint')}</p>
    </div>}
    {p.dbUnavailable && <p className="rs-warn">{t('rs.dbUnavailable', { note: p.dbUnavailable })}</p>}
    {p.notVerified?.length ? <div className="rs-warn" data-testid="run-not-verified">
      <strong>{t('rs.notVerified')}</strong>
      <ul>{p.notVerified.map((w, i) => <li key={i}>{w}</li>)}</ul>
    </div> : null}
    {(p.error ?? run.error) && <p className="rs-error" role="alert">{p.error ?? run.error}</p>}

    {run.lastShot && <button type="button" className="rs-shot" onClick={() => onOpenFile(run.lastShot!.path)} title={base(run.lastShot.path)}>
      <img src={run.lastShot.dataUrl} alt={t('rs.lastShot')} />
    </button>}

    <ol className="rs-steps">
      {run.steps.map(s => <li key={s.n} className="rs-step" data-status={s.status}>
        <div className="rs-step-head">
          <span className="rs-badge" data-tone={statusTone(s.status)}>{statusLabel(s.status)}</span>
          <strong>{s.n}. {s.title}</strong>
          {s.attempts > 1 && <span className="rs-muted">{t('rs.attempts', { n: s.attempts })}</span>}
          {s.testDb && <span className="rs-muted">{t(s.testDb === 'available' ? 'rs.db.available' : s.testDb === 'refused' ? 'rs.db.refused' : 'rs.db.unavailable')}</span>}
        </div>
        {s.summary && <p>{s.summary}</p>}
        {s.error && <p className="rs-error">{s.error}</p>}
        {s.writes.length > 0 && <p className="rs-muted">{t('rs.writes', { list: s.writes.join(', ') })}</p>}
        {s.failedWrites.length > 0 && <p className="rs-warn">{t('rs.failedWrites', { list: s.failedWrites.join(', ') })}</p>}
        {(s.screenshots.length > 0 || s.evidence.length > 0) && <div className="rs-files">
          {[...s.screenshots, ...s.evidence].map(f => <button key={f} type="button" className="btn btn-ghost btn-xs" onClick={() => onOpenFile(f)}>{base(f)}</button>)}
        </div>}
      </li>)}
    </ol>

    {status !== 'done' && status !== 'cancelled' && <div className="rs-cmd">
      <span className="rs-muted">{t('rs.resume')}</span>
      <code>{run.resume}</code>
      <button type="button" className="btn btn-ghost btn-xs" onClick={() => onCopy(run.resume)}>{t('rs.copy')}</button>
    </div>}
    <p className="rs-muted rs-dir">{run.dir}</p>
  </section>;
}
