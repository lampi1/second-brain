// The "Manutenzione" button of the Brain pages (owner, 2026-10-19: "la manutenzione deve essere più visibile come
// pulsante in generale"): one clearly visible button in the head of every page whose things the maintenance jobs change
// (Skill, Regole, Memoria). A click runs every job now and opens a dialog that says, job by job, what it looked for and
// what it did (changes made, nothing to do, or why it stopped), then lists the changes of this pass, each with "Annulla".
// The full log stays in each page's maintenance panel. Under the button, the last pass. One maintenance for everything
// (#150): the same pass also groups the app's log warnings and errors (the "Log dell'app" row, each group with «Noto,
// ignora») and hands the result to the Orchestrator, which opens the issues; `compact` is the icon on the Orchestrator's
// head, reachable from every page. Used by SkillsPage.tsx, RulesPage.tsx, MemoryPage.tsx (PageHead actions) and
// OrchestratorTile.tsx (compact). Styles: styles/memory.css (mm-maint-*).
import { useRef, useState } from 'react';
import { MAINTENANCE_JOBS } from '@shared/brain-model';
import { t } from '../../i18n';
import { markLogGroup, runMaintenance, useBrainModel } from '../../store/brain-model';
import { HelpTip } from '../HelpTip';
import { IconSparkle } from '../Icons';
import { IconButton, Modal } from '../ui';
import { Change, when } from './MaintenancePanel';
import '../../styles/memory.css';

export function MaintenanceButton({ testId = 'bm-maint-now', compact = false }: { testId?: string; compact?: boolean }) {
  const { state, busy } = useBrainModel();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ran, setRan] = useState(false);
  // the changes there were before this pass: what is new afterwards is what this pass did (clock-free: the frozen demo
  // stamps every change with the same time)
  const before = useRef<Set<string>>(new Set());
  const run = async () => {
    before.current = new Set((state?.changes ?? []).map(c => c.id));
    setError(null); setRan(false); setOpen(true);
    const err = await runMaintenance();
    setError(err); setRan(true);
  };
  const fresh = ran ? (state?.changes ?? []).filter(c => !before.current.has(c.id)) : [];
  const jobs = ran && !error ? state?.lastRun?.jobs ?? [] : [];
  const logs = ran && !error ? state?.lastRun?.logs : undefined, handoff = ran && !error ? state?.lastRun?.handoff : undefined;
  const freshGroups = logs?.groups.filter(g => !g.known).length ?? 0;
  return <div className={`mm-maint${compact ? ' compact' : ''}`} data-testid={testId}>
    {compact
      ? <IconButton label={busy ? t('mm.maint.running') : t('mm.maint.button')} disabled={busy || !state?.root} onClick={() => void run()} testid={`${testId}-run`}><IconSparkle size={14} /></IconButton>
      : <>
        <button type="button" className="btn btn-primary btn-m mm-maint-btn" disabled={busy || !state?.root} onClick={() => void run()} data-testid={`${testId}-run`}>
          <IconSparkle /> {busy ? t('mm.maint.running') : t('mm.maint.button')}
        </button>
        <span className="mm-maint-last">{state?.lastRun ? t('bm.maint.last', { at: when(state.lastRun.at) }) : t('bm.maint.never')}</span>
        <HelpTip title={t('mm.maint.helpTitle')} label={t('mm.maint.button')} wide guide="maintenance">
          <p>{t('mm.maint.help1')}</p><p>{t('mm.maint.help2')}</p><p>{t('mm.maint.help3')}</p>
        </HelpTip>
      </>}
    {open && <Modal onClose={() => setOpen(false)} label={t('mm.maint.dialog')} testid={`${testId}-dialog`} className="mm-maint-modal">
      <div className="modal-head"><h2>{t('mm.maint.dialog')}</h2></div>
      <div className="modal-body">
        {error ? <p role="alert" className="mm-maint-error">{error}</p> : <>
          <p className="mm-maint-lead">{ran ? t('mm.maint.doneLead', { n: fresh.length }) : t('mm.maint.runningLead')}</p>
          <ul className="mm-jobs" aria-label={t('mm.maint.jobsLabel')} aria-busy={!ran}>
            {MAINTENANCE_JOBS.map(id => {
              const j = jobs.find(x => x.job === id);
              const status = !ran ? 'running' : j?.note ? 'note' : j?.changes ? 'changed' : 'clean';
              return <li key={id} className="mm-job" data-status={status} data-testid={`mm-job-${id}`}>
                <span className="mm-job-dot" aria-hidden="true" />
                <span className="mm-job-main"><b>{t(`bm.job.${id}`)}</b><small>{t(`mm.job.${id}`)}</small>{j?.note && <small className="mm-job-note">{j.note}</small>}</span>
                <span className="mm-job-result">{!ran ? t('mm.maint.wait') : j?.changes ? t('mm.maint.changes', { n: j.changes }) : j?.note ? t('mm.maint.stopped') : t('mm.maint.clean')}</span>
              </li>;
            })}
            <li className="mm-job" data-status={!ran ? 'running' : freshGroups ? 'note' : 'clean'} data-testid="mm-job-logs">
              <span className="mm-job-dot" aria-hidden="true" />
              <span className="mm-job-main"><b>{t('mm.job.logs.name')}</b><small>{t('mm.job.logs')}</small></span>
              <span className="mm-job-result">{!ran ? t('mm.maint.wait') : freshGroups ? t('mm.maint.groups', { n: freshGroups }) : t('mm.maint.noGroups')}</span>
            </li>
          </ul>
          {handoff && <p className={`mm-maint-handoff${handoff.sent ? '' : ' warn'}`} data-testid="mm-maint-handoff">{handoff.sent ? t('mm.maint.sent') : t('mm.maint.notSent', { why: handoff.why })}</p>}
          {logs && logs.groups.length > 0 && <>
            <h3 className="mm-maint-h">{t('mm.maint.logsTitle')}</h3>
            <ul className="mm-logs" aria-label={t('mm.maint.logsLabel')} data-testid="mm-logs">
              {logs.groups.map(g => <li key={g.key} className={`mm-log${g.known ? ' known' : ''}`} data-lvl={g.lvl} data-testid="mm-log">
                <span className="mm-log-main"><b>{g.scope} · {g.msg}</b>{g.cause && <small>{g.cause}</small>}</span>
                <span className="mm-log-n">×{g.count}</span>
                <button type="button" className="btn btn-s" disabled={busy} data-tip={g.known ? undefined : t('mm.maint.knownTip')} onClick={() => void markLogGroup(g.key, !g.known)} data-testid="mm-log-known">{g.known ? t('mm.maint.unknown') : t('mm.maint.known')}</button>
              </li>)}
            </ul>
          </>}
          {ran && fresh.length > 0 && <>
            <h3 className="mm-maint-h">{t('mm.maint.what')}</h3>
            <ul className="bm-changes" aria-label={t('bm.maint.listLabel')}>{fresh.map(c => <Change key={c.id} c={c} busy={busy} />)}</ul>
          </>}
          <p className="bm-note">{t('bm.maint.approvalNote')}</p>
        </>}
      </div>
      <div className="modal-foot"><button type="button" className="btn" onClick={() => setOpen(false)} data-testid={`${testId}-close`}>{t('mm.maint.close')}</button></div>
    </Modal>}
  </div>;
}
