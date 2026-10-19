// The Cursor Cloud Agents key in Settings → Motori → Cursor (ADR 0080, extends ADR 0046's key list): typed once,
// encrypted by main (engines/secrets.ts, id `cursor-cloud`), never shown again (only "salvata" and Elimina). Only the
// cloud agents use it (main/cloud/cursor.ts, sent to api.cursor.com); the Cursor chats keep the CLI's own login. Used by
// SettingsPage.tsx.
import { useEffect, useState } from 'react';
import type { SecretsStatus } from '@shared/contract';
import { t } from '../i18n';
import { toast } from '../store/ui';
import { holdUpdate } from '../lib/update-barrier';

const ID = 'cursor-cloud';

export function CloudKeySetting() {
  const [keys, setKeys] = useState<SecretsStatus | null>(null), [key, setKey] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => key ? holdUpdate(t('cloud.key')) : undefined, [key]);
  useEffect(() => { let live = true; void window.sb.invoke('secrets:status', undefined).then(r => { if (live) setKeys(r); }, () => {}); return () => { live = false; }; }, []);
  const run = async (fn: () => Promise<SecretsStatus>) => { if (busy) return; setBusy(true); try { setKeys(await fn()); } catch { toast(t('essential.error'), 'err'); } finally { setBusy(false); } };
  return <div className="st-key" data-testid="st-cloud-key">
    <label>{t('cloud.key')}<input className="st-input" type="password" autoComplete="off" spellCheck={false} value={key} disabled={!keys?.available || busy} onChange={e => setKey(e.target.value)} data-testid="st-cloud-key-input" /></label>
    <button type="button" className="btn btn-primary btn-m" disabled={!keys?.available || busy || !key.trim()} onClick={() => { const value = key.trim(); setKey(''); void run(() => window.sb.invoke('secrets:set', { engine: ID, key: value })); }}>{t('common.save')}</button>
    {keys?.keys[ID] && <><small className="st-desc">{t('essential.keySaved')}</small><button type="button" className="btn btn-danger btn-m" disabled={busy} onClick={() => void run(() => window.sb.invoke('secrets:delete', { engine: ID }))}>{t('essential.deleteKey')}</button></>}
    <small className="st-desc">{t('cloud.keyHint')}</small>
  </div>;
}
