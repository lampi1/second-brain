// The notice under the top bar after a restart (ADR 0020; 2026-10-12: a promoted release was dropped by the launcher
// overnight and nobody was told): either the promoted version started, or it did not and the launcher went back to
// the previous one, with the reason. Shown until the user closes it; main remembers it was told (improve-seen.json),
// so the same fallback is not announced again at every start. Mounted by App.tsx.
import { dismissLaunch, useImprove } from '../store/improve';
import '../styles/improve.css';
import { go } from '../actions';
import { t } from '../i18n';
import { IconAlert, IconCheck, IconX } from './Icons';

export function LaunchBanner() {
  const l = useImprove(s => s?.launch ?? null);
  if (!l) return null;
  const fallback = l.outcome === 'fallback';
  return (
    <div className={`launch-banner ${fallback ? 'warn' : 'ok'}`} role={fallback ? 'alert' : 'status'} data-testid="launch-banner" data-outcome={l.outcome}>
      {fallback ? <IconAlert size={15} /> : <IconCheck size={15} />}
      <div className="launch-text">
        {fallback ? (
          <><b>{t('dialogs.launch.failedPrefix')}</b> <span className="mono">{l.wanted}</span> {t('dialogs.launch.failedReason', { reason: l.reason })} <span className="mono">{l.running}</span>.</>
        ) : (
          <><b>{t('dialogs.launch.startedPrefix')}</b> <span className="mono">{l.running}</span>.</>
        )}
      </div>
      <button type="button" className="btn btn-ghost btn-s" onClick={() => go({ page: 'migliora' })} data-testid="launch-open">{t('dialogs.launch.improveButton')}</button>
      <button type="button" className="icon-btn" aria-label={t('dialogs.launch.dismissLabel')} data-tip={t('dialogs.launch.dismissTip')} onClick={dismissLaunch} data-testid="launch-dismiss"><IconX size={13} /></button>
    </div>
  );
}
