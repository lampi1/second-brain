// The warning under the top bar after a restart that did not go as planned (ADR 0075; 2026-10-12: a promoted release
// was dropped by the launcher overnight and nobody was told): the new version did not start and the launcher went back
// to the previous one, with the reason. A start on the new version is no banner any more: the top bar's small chip says
// it (VersionChip.tsx, ADR 0366). Shown until the user closes it; main remembers it was told (launch-seen.json), so the
// same fallback is not announced again at every start. "Aggiornamenti" opens Settings on that card. Mounted by App.tsx.
import { dismissLaunch, useSource } from '../store/source';
import '../styles/update.css';
import { go } from '../actions';
import { t } from '../i18n';
import { IconAlert, IconX } from './Icons';

export function LaunchBanner() {
  const l = useSource(s => s?.launch ?? null);
  if (!l || l.outcome !== 'fallback') return null;
  return (
    <div className="launch-banner warn" role="alert" data-testid="launch-banner" data-outcome={l.outcome}>
      <IconAlert size={15} />
      <div className="launch-text">
        <b>{t('dialogs.launch.failedPrefix')}</b> <span className="mono">{l.wanted}</span> {t('dialogs.launch.failedReason', { reason: l.reason })} <span className="mono">{l.running}</span>.
      </div>
      <button type="button" className="btn btn-ghost btn-s" onClick={() => go({ page: 'impostazioni', arg: 'update' })} data-testid="launch-open">{t('dialogs.launch.updatesButton')}</button>
      <button type="button" className="icon-btn" aria-label={t('dialogs.launch.dismissLabel')} data-tip={t('dialogs.launch.dismissTip')} onClick={dismissLaunch} data-testid="launch-dismiss"><IconX size={13} /></button>
    </div>
  );
}
