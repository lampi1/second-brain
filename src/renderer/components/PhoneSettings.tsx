// Settings → Telefono (ADR 0219): the private Telegram bot that brings the phone's messages to the Orchestrator. The bot
// token is write-only (typed once, sent to main on phone:set-token, never shown or read back), the on/off switch, the
// pairing code with its countdown ('Codice scaduto' and 'Nuovo codice' once it runs out; no pairing in a dev
// instance), quiet hours, the state with its error line, the dropped counter, the last phone actions and the user's own
// setup checklist. Reads lib/phone.ts (window.sbPhone, the live status). Mounted by SettingsPage.tsx.
import { useEffect, useState } from 'react';
import type { PhoneSettingsPatch, PhoneStatus } from '@shared/contract/phone';
import { Switch } from './SettingsPage';
import { Select } from './Select';
import { PHONE_HOURS, PHONE_QUIET_DEFAULT, pairLeft, pairView, phoneApi, phoneStatus, startPhone } from '../lib/phone';
import { errText } from '../lib/ipc-error';
import { toast } from '../store/ui';
import { t } from '../i18n';

const CHECKS = ['botfather', 'joingroups', 'twofa', 'previews'] as const;

export function PhoneSettings() {
  useEffect(() => { startPhone(); }, []);
  const status = phoneStatus.use(s => s);
  const api = phoneApi();
  const [token, setToken] = useState(''), [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const pairing = status?.pairing ?? null;
  const ticking = !!pairing && pairing.expiresAt > now;
  useEffect(() => {
    if (!ticking) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ticking]);
  if (!api) return <p className="st-desc" data-testid="st-phone-unavailable">{t('phone.unavailable')}</p>;
  if (!status) return null;

  const run = async (step: () => Promise<PhoneStatus>, done?: string) => {
    setBusy(true);
    try { phoneStatus.set(await step()); if (done) toast(done, 'ok'); return true; }
    catch (e) { toast(errText(e), 'err'); return false; }
    finally { setBusy(false); }
  };
  const update = (patch: PhoneSettingsPatch) => void run(() => api.update(patch));
  const saveToken = async () => { if (await run(() => api.setToken(token), t('phone.tokenSaved'))) setToken(''); };
  const devOnly = status.state === 'dev-disabled';
  const pv = pairView(status, now);
  const quiet = status.quietHours;
  const stateLine = status.state === 'error' && status.error ? `${t(`phone.state.${status.state}`)}: ${status.error}` : t(`phone.state.${status.state}`);

  return <>
    {devOnly && <div className="st-row-block"><p className="st-desc" data-testid="st-phone-dev-only">{t('phone.devOnly')}</p></div>}
    <div className="st-row" data-testid="st-phone-state">
      <div className="st-text"><span className="st-title">{t('phone.stateTitle')}</span>
        <p className="st-desc" data-testid="st-phone-state-line" data-state={status.state}>{stateLine}</p></div>
    </div>
    <div className="st-row" data-testid="st-phone-token">
      <div className="st-text"><span className="st-title">{t('phone.tokenTitle')}</span><p className="st-desc">{t('phone.tokenHint')}</p></div>
      <div className="st-ctl">
        {status.hasToken
          ? <><span className="st-desc" data-testid="st-phone-token-saved">{t('phone.tokenSaved')}</span>
            <button type="button" className="btn btn-ghost btn-s" disabled={busy} onClick={() => void run(() => api.clearToken(), t('phone.tokenCleared'))} data-testid="st-phone-token-clear">{t('phone.tokenClear')}</button></>
          : <form className="st-phone-token" onSubmit={e => { e.preventDefault(); if (token.trim()) void saveToken(); }}>
            <input type="password" className="st-input mono" autoComplete="off" spellCheck={false} value={token} placeholder={t('phone.tokenPlaceholder')}
              onChange={e => setToken(e.target.value)} aria-label={t('phone.tokenTitle')} data-testid="st-phone-token-input" />
            <button type="submit" className="btn btn-primary btn-s" disabled={busy || !token.trim()} data-testid="st-phone-token-save">{t('phone.tokenSave')}</button>
          </form>}
      </div>
    </div>
    <div className="st-row" data-testid="st-phone-on">
      <div className="st-text"><span className="st-title">{t('phone.onTitle')}</span><p className="st-desc">{t('phone.onHint')}</p></div>
      <div className="st-ctl"><Switch on={status.enabled} onChange={on => update({ enabled: on })} label={status.enabled ? t('phone.off') : t('phone.on')} testid="st-phone-on-switch" /></div>
    </div>
    <div className="st-row" data-testid="st-phone-pair">
      <div className="st-text"><span className="st-title">{t('phone.pairTitle')}</span>
        <p className="st-desc">{pv.line === 'expired'
          ? <span data-testid="st-phone-pair-expired">{t('phone.pairExpired')}</span>
          : pairing
          ? <span data-testid="st-phone-pair-code"><b>{t('phone.pairCode', { code: pairing.code })}</b> · {t('phone.pairSend', { code: pairing.code })} · {t('phone.pairLeft', { left: pairLeft(pairing.expiresAt, now) })}</span>
          : status.paired ? t('phone.paired') : `${t('phone.notPaired')}. ${t('phone.pairHint')}`}</p></div>
      <div className="st-ctl">
        {pv.button === 'unpair'
          ? <button type="button" className="btn btn-ghost btn-s" disabled={busy} onClick={() => void run(() => api.unpair())} data-testid="st-phone-unpair">{t('phone.unpair')}</button>
          : pv.button && <button type="button" className="btn btn-primary btn-s" disabled={busy || !status.hasToken} onClick={() => void run(() => api.startPairing())} data-testid="st-phone-pair-start">{pv.button === 'new' ? t('phone.pairNew') : t('phone.pairStart')}</button>}
      </div>
    </div>
    <div className="st-row" data-testid="st-phone-quiet">
      <div className="st-text"><span className="st-title">{t('phone.quietTitle')}</span><p className="st-desc">{t('phone.quietHint')}</p></div>
      <div className="st-ctl st-phone-quiet">
        <Switch on={!!quiet} onChange={on => update({ quietHours: on ? { ...PHONE_QUIET_DEFAULT } : null })} label={t('phone.quietOn')} testid="st-phone-quiet-on" />
        {quiet && <>
          <span>{t('phone.quietFrom')}</span>
          <Select value={String(quiet.from)} aria-label={t('phone.quietFrom')} data-testid="st-phone-quiet-from"
            onChange={e => { const from = Number(e.target.value); if (from !== quiet.to) update({ quietHours: { from, to: quiet.to } }); }}>
            {PHONE_HOURS.map(h => <option key={h} value={h}>{`${h}:00`}</option>)}
          </Select>
          <span>{t('phone.quietTo')}</span>
          <Select value={String(quiet.to)} aria-label={t('phone.quietTo')} data-testid="st-phone-quiet-to"
            onChange={e => { const to = Number(e.target.value); if (to !== quiet.from) update({ quietHours: { from: quiet.from, to } }); }}>
            {PHONE_HOURS.map(h => <option key={h} value={h}>{`${h}:00`}</option>)}
          </Select>
        </>}
      </div>
    </div>
    <div className="st-row" data-testid="st-phone-dropped">
      <div className="st-text"><span className="st-title">{t('phone.droppedTitle')}</span><p className="st-desc">{t('phone.dropped', { n: status.dropped })}</p></div>
    </div>
    <div className="st-row-block" data-testid="st-phone-recent">
      <span className="st-title">{t('phone.recentTitle')}</span>
      {status.recent.length === 0
        ? <p className="st-desc">{t('phone.recentEmpty')}</p>
        : <ul className="st-phone-recent">{status.recent.slice(0, 20).map((a, i) =>
          <li key={`${a.at}-${i}`}><time>{new Date(a.at).toLocaleString()}</time> · <b>{t(`phone.kind.${a.kind}`)}</b> · {a.label}</li>)}</ul>}
    </div>
    <div className="st-row-block"><p className="st-desc" data-testid="st-phone-boundary">{t('phone.boundary')}</p></div>
    <div className="st-row-block" data-testid="st-phone-checklist">
      <span className="st-title">{t('phone.checkTitle')}</span>
      <ol className="st-phone-checks">{CHECKS.map(c => <li key={c}>{t(`phone.check.${c}`)}</li>)}</ol>
      <p className="st-desc">{t('phone.tradeoff')}</p>
    </div>
  </>;
}
