// Settings → Aggiornamenti (ADR 0075): the version in use, what GitHub's main has that this copy does not, and the
// "Aggiorna" button that downloads it, builds it and restarts the app on it at once, without the test suite.
// Checks GitHub (git fetch only) when the card opens. Below it, only when there is something to show, the staged
// updater's prepared package (UpdatePanel) and a recovery paused after an update (UpdateRecoveryPanel), which lived in
// the retired "Migliora l'app" section (ADR 0079). Used by SettingsPage.tsx.
import { useEffect } from 'react';
import { t } from '../i18n';
import { askUpdateNow, checkSource, useSource } from '../store/source';
import { UpdatePanel } from './UpdatePanel';
import { UpdateRecoveryPanel } from './UpdateRecoveryPanel';
import '../styles/update.css';

export function AppUpdateSettings() {
  const state = useSource(s => s);
  useEffect(() => { checkSource(); }, []);
  const src = state?.source;
  const busy = !src || src.state === 'checking' || src.state === 'updating' || src.state === 'restarting';
  const version = !state ? '…' : state.running === 'dev' ? t('update.dev') : state.running;
  return <div className="st-update" data-testid="st-update">
    <div className="st-row">
      <div className="st-text">
        <label className="st-title">{t('update.version')}</label>
        <p className="st-desc" role="status" data-testid="st-update-status" data-state={src?.state ?? 'idle'}>{version}{src?.message ? ` · ${src.message}` : ''}</p>
      </div>
      <div className="st-inline">
        <button type="button" className="btn btn-ghost btn-m" disabled={busy} onClick={() => checkSource()} data-testid="st-update-check">{t('update.check')}</button>
        <button type="button" className="btn btn-primary btn-m" disabled={busy || !src?.canUpdate} onClick={() => askUpdateNow(!!state?.stable)} data-testid="st-update-now">{t('update.button')}</button>
      </div>
    </div>
    {!!src?.commits.length && <div className="st-row st-row-block">
      <b className="st-title">{t('update.new')}</b>
      <ul className="st-update-list" data-testid="st-update-commits">{src.commits.slice(0, 8).map(c => <li key={c}><code>{c.slice(0, 7)}</code> {c.slice(8)}</li>)}</ul>
    </div>}
    <UpdateRecoveryPanel />
    <UpdatePanel />
  </div>;
}
