// The «Manutenzione» button (#150, ADR 0132; one click since ADR 0153). Always on the top bar (`bar`), on the
// Orchestrator's head (`compact`) and in Memoria's hero. One click and nothing else: the free cleanup runs at once, then
// an invisible research with the app's best choice works in the background; its findings arrive as cards in Memoria →
// Proposte (skills, rules, what to forget, «Apri issue»), app ideas also in Idee; the end notice says what it made
// (lib/maintenance-notice.ts). While it works the button breathes; when it ends it sparkles for a moment. The hero
// shows the last result and, while it works, «Ferma». Used by TopBar.tsx (bar), OrchestratorTile.tsx (compact) and
// MemoryPage.tsx. Styles: styles/memory.css (mm-maint-*).
import { t } from '../../i18n';
import { maintenanceSummary } from '../../lib/maintenance-notice';
import { useBrainModel } from '../../store/brain-model';
import { runMaintenanceNow, stopMaintenance, useMaintenance } from '../../store/maintenance';
import { toast } from '../../store/ui';
import { HelpTip } from '../HelpTip';
import { IconSparkle } from '../Icons';
import { IconButton } from '../ui';
import { when } from './MaintenancePanel';
import '../../styles/memory.css';

const usd = (n: number) => `${n.toFixed(2)} $`;

export function MaintenanceButton({ testId = 'bm-maint-now', compact = false, bar = false }: { testId?: string; compact?: boolean; bar?: boolean }) {
  const { state } = useBrainModel(!compact && !bar);
  const { status, justDone } = useMaintenance();
  const running = !!status?.running;
  const research = status?.research ?? null;
  const label = running ? t('mm.maint.running') : t('mm.maint.button');
  const tip = running
    ? research ? t('mm.one.tipResearch', { cost: usd(research.costUsd), cap: usd(research.capUsd) }) : t('mm.one.tipCleanup')
    : t('mm.one.tip');
  const click = async () => {
    if (running) return;
    const err = await runMaintenanceNow();
    toast(err ?? t('mm.one.started'), err ? 'err' : 'info');
  };
  const cls = `${running ? ' busy' : ''}${justDone ? ' done' : ''}`;
  return <div className={`mm-maint${compact ? ' compact' : ''}${bar ? ' bar' : ''}`} data-testid={testId} data-state={running ? 'running' : justDone ? 'done' : 'idle'}>
    {compact
      ? <IconButton label={label} onClick={() => void click()} testid={`${testId}-run`} className={`mm-maint-icon${cls}`}><IconSparkle size={14} /></IconButton>
      : bar
        ? <button type="button" className={`btn btn-ghost btn-m mm-maint-bar${cls}`} onClick={() => void click()} data-testid={`${testId}-run`} aria-label={label} aria-busy={running} data-tip={tip}>
          <IconSparkle size={14} /><span>{label}</span></button>
        : <>
          <button type="button" className={`btn btn-primary btn-m mm-maint-btn${cls}`} disabled={!state?.root || running} onClick={() => void click()} data-testid={`${testId}-run`} aria-busy={running}>
            <IconSparkle /> {label}
          </button>
          {running
            ? <>
              <span className="mm-maint-last" data-testid={`${testId}-live`}>{research ? t('mm.one.liveResearch', { cost: usd(research.costUsd), cap: usd(research.capUsd), n: research.proposals }) : t('mm.one.tipCleanup')}</span>
              {research && <button type="button" className="btn btn-ghost btn-s" onClick={() => void stopMaintenance()} data-testid={`${testId}-stop`}>{t('mm.one.stop')}</button>}
            </>
            : <span className="mm-maint-last" data-testid={`${testId}-last`}>{status?.last ? t('mm.one.last', { at: when(status.last.at), what: maintenanceSummary(status.last) }) : state?.lastRun ? t('bm.maint.last', { at: when(state.lastRun.at) }) : t('bm.maint.never')}</span>}
          <HelpTip title={t('mm.maint.helpTitle')} label={t('mm.maint.button')} wide guide="maintenance">
            <p>{t('mm.maint.help1')}</p><p>{t('mm.maint.help2')}</p><p>{t('mm.maint.help3')}</p>
          </HelpTip>
        </>}
  </div>;
}
