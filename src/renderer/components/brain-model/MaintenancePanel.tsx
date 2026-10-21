// The maintenance panel of the Brain pages (ADR 0077): what the self-managing jobs changed, newest first, each with what,
// why, the evidence and "Annulla" (or why it can no longer be undone), the "Esegui ora" button and the last pass. No
// approval anywhere: the jobs apply their changes and the user can take any of them back. The migration report (former
// runbook and routine sections turned into skills) is a separate block for the Skill page. Used by SkillsPage.tsx,
// RulesPage.tsx and MemoryPage.tsx; Change also by LearningPage.tsx. Each change shows its evidence claim (ADR 0109): the
// hypothesis, where it is measured and what the data say so far, with the verdict. Styles: styles/brain-model.css.
import { useState } from 'react';
import type { BrainChange, MaintenanceJobId, MaintenanceRun, MigrationReport } from '@shared/brain-model';
import { locale, t } from '../../i18n';
import { brainModel, rollbackChange, runMaintenance, useBrainModel } from '../../store/brain-model';
import { toast } from '../../store/ui';
import { changesOf } from '../../lib/brain-model-view';
import { claimLine, scopeLine, verdictTone } from '../../lib/learning-view';

export const when = (ms: number | null | undefined): string => (ms ? new Date(ms).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' }) : '—');
const jobName = (job: BrainChange['job']) => t(`bm.job.${job}`);

/** The change's claim: verdict badge, hypothesis and scope, then the numbers (the Apprendimento page's line). */
function Claim({ c }: { c: NonNullable<BrainChange['claim']> }) {
  const agents = brainModel.use(s => s.state?.agents);
  const names = new Map((agents ?? []).map(a => [a.id, a.name]));
  return <div className="bm-claim" data-verdict={c.verdict} data-testid="bm-claim">
    <span className="bm-claim-head"><span className="bm-badge" data-tone={verdictTone(c.verdict)}>{t(`learn.v.${c.verdict}`)}</span>{t(`learn.hyp.${c.hypothesis}`)} · {scopeLine(c, names)}</span>
    <span className="bm-claim-nums">{claimLine(c)}</span>
  </div>;
}

export function Change({ c, busy }: { c: BrainChange; busy: boolean }) {
  const undo = async () => { const err = await rollbackChange(c.id); toast(err ?? t('bm.maint.undoneToast'), err ? 'err' : 'ok'); };
  return <li className="bm-change" data-undone={!!c.rolledBackAt} data-testid="bm-change">
    <div className="bm-change-main">
      <span className="bm-change-meta"><span className="bm-tag" data-kind={c.kind}>{t(`bm.kind.${c.kind}`)}</span>{jobName(c.job)} · {when(c.at)}</span>
      <p className="bm-change-what">{c.summary}</p>
      <p className="bm-change-why"><span className="sr-only">{t('bm.maint.why')}: </span>{c.reason}</p>
      {c.claim && <Claim c={c.claim} />}
      {c.evidence.length > 0 && <details className="bm-evidence"><summary>{t('bm.maint.evidence')} ({c.evidence.length})</summary><ul>{c.evidence.map(e => <li key={e}><code>{e}</code></li>)}</ul></details>}
    </div>
    {c.rolledBackAt ? <span className="bm-undone">{t('bm.maint.undone')}</span>
      : c.canRollback ? <button type="button" className="btn btn-ghost btn-s" disabled={busy} onClick={() => void undo()} data-testid="bm-undo">{t('bm.maint.undo')}</button>
        : <span className="bm-locked" title={t('bm.maint.locked')}>{t('bm.maint.locked')}</span>}
  </li>;
}

/** The change log of the given kinds, the run button and the last pass. `job` limits "Esegui ora" to one job. */
export function MaintenancePanel({ kinds, job, runLabel, testId = 'bm-maintenance' }: { kinds: BrainChange['kind'][]; job?: MaintenanceJobId; runLabel?: string; testId?: string }) {
  const { state, busy } = useBrainModel();
  const [limit, setLimit] = useState(8);
  const changes = changesOf(state?.changes ?? [], kinds);
  const run = async () => {
    const before = state?.changes.length ?? 0;
    const err = await runMaintenance(job);
    if (err) { toast(err, 'err'); return; }
    const after = brainModel.get().state?.changes.length ?? before;
    toast(t('bm.maint.done', { n: Math.max(0, after - before) }), 'ok');
  };
  return <section className="bm-panel bm-maint" aria-labelledby={`${testId}-h`} data-testid={testId}>
    <header className="bm-panel-head">
      <div><h3 id={`${testId}-h`}>{t('bm.maint.title')}</h3><p>{t('bm.maint.lead')}</p></div>
      <div className="bm-panel-actions">
        <small className="bm-last">{state?.lastRun ? t('bm.maint.last', { at: when(state.lastRun.at) }) : t('bm.maint.never')}</small>
        <button type="button" className="btn btn-primary btn-s" disabled={busy || !state?.root} onClick={() => void run()} data-testid="bm-run">{busy ? t('bm.maint.running') : runLabel ?? t('bm.maint.run')}</button>
      </div>
    </header>
    <p className="bm-note">{t('bm.maint.approvalNote')}</p>
    {changes.length ? <ul className="bm-changes" aria-label={t('bm.maint.listLabel')}>{changes.slice(0, limit).map(c => <Change key={c.id} c={c} busy={busy} />)}</ul>
      : <p className="bm-empty">{t('bm.maint.empty')}</p>}
    {changes.length > limit && <button type="button" className="link-btn bm-more" onClick={() => setLimit(n => n + 20)}>{t('bm.maint.more', { n: Math.min(20, changes.length - limit) })}</button>}
  </section>;
}

/** The procedures' report: every runbook or routines section and the skill it became. */
export function MigrationReportPanel({ report }: { report: MigrationReport }) {
  const count = (s: MigrationReport['items'][number]['status']) => report.items.filter(i => i.status === s).length;
  if (!report.items.length) return null;
  return <details className="bm-panel bm-migration" data-testid="bm-migration" open={report.items.length <= 12}>
    <summary><h3>{t('bm.mig.title')}</h3><p>{t('bm.mig.lead', { moved: count('moved'), existing: count('existing'), skipped: count('skipped'), at: when(report.at) })}</p></summary>
    <ul className="bm-mig-list">{report.items.map(i => <li key={i.source} data-status={i.status}>
      <span className="bm-mig-from" title={i.source}>{i.title}<small>{i.source}</small></span>
      <span aria-hidden="true" className="bm-mig-arrow">→</span>
      <span className="bm-mig-to">{i.skill ? <code>{i.skill}</code> : '—'}</span>
      <span className="bm-tag" data-status={i.status}>{t(`bm.mig.${i.status}`)}</span>
      {i.note && <small className="bm-mig-note">{i.note}</small>}
    </li>)}</ul>
  </details>;
}

export const lastRunChanges = (run: MaintenanceRun | null): number => run?.jobs.reduce((n, j) => n + j.changes, 0) ?? 0;
