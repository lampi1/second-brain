// User-only encrypted site login editor inside Credenziali; passwords are write-only and never kept in drafts.
import { useEffect, useState } from 'react';
import type { SiteCredentials as State } from '@shared/contract';
import { sb } from '../sb';
import { t } from '../i18n';
export function RoutineSiteLogins() {
  const [state, setState] = useState<State | null>(null), [id, setId] = useState<string>();
  const [origin, setOrigin] = useState(''), [user, setUser] = useState(''), [password, setPassword] = useState('');
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { let live = true; void sb.invoke('credentials:sites', undefined).then(s => { if (live) setState(s); }, () => { if (live) setError(t('flows.siteError')); }); return () => { live = false; }; }, []);
  const refresh = async () => setState(await sb.invoke('credentials:sites', undefined));
  const clear = () => { setEditing(false); setId(undefined); setPassword(''); setUser(''); setOrigin(''); };
  const save = async () => {
    setBusy(true); setError('');
    try { await sb.invoke('credentials:saveSite', { ...(id ? { id } : {}), origin, user, password }); clear(); await refresh(); }
    catch { setError(t('flows.siteError')); setPassword(''); }
    finally { setBusy(false); }
  };
  const remove = async (key: string) => {
    setBusy(true); setError('');
    try { await sb.invoke('credentials:removeSite', { id: key }); if (key === id) clear(); await refresh(); }
    catch { setError(t('flows.siteError')); } finally { setBusy(false); }
  };
  return <section className="cred-group" data-testid="site-credentials" aria-label={t('flows.siteTitle')}>
    <h3 className="cred-group-title">{t('flows.siteTitle')}</h3><p className="flows-muted">{t('flows.siteHint')}</p>
    {state?.unavailable && <p role="status">{t('flows.siteUnavailable')}</p>}
    {error && <p role="alert">{error}</p>}
    {state?.entries.map(e => <div className="cred-entry" key={e.id}><div className="cred-site-identity"><b>{e.site}</b><span>{e.user}</span></div><div className="cred-row">
      <button className="btn btn-ghost btn-s" aria-label={`${t('flows.siteEdit')} ${e.user} · ${e.site}`} disabled={busy || !!state.unavailable || !state.origins.includes(e.site)} onClick={() => { setId(e.id); setOrigin(e.site); setUser(e.user); setPassword(''); setEditing(true); }}>{t('flows.siteEdit')}</button>
      <button className="btn btn-ghost btn-s" aria-label={`${t('flows.siteDelete')} ${e.user} · ${e.site}`} disabled={busy} onClick={() => void remove(e.id)}>{t('flows.siteDelete')}</button>
    </div>{!state.origins.includes(e.site) && <p className="flows-muted">{t('flows.siteRetired')}</p>}</div>)}
    {!editing && <button className="btn btn-primary btn-s site-credential-add" data-testid="site-add" disabled={busy || !state?.origins.length || !!state.unavailable} onClick={() => { setOrigin(state!.origins[0]!); setEditing(true); }}>{t('flows.siteAdd')}</button>}
    {state && !state.origins.length && <p>{t('flows.siteNoOrigins')}</p>}
    {editing && <form className="site-credential-form" autoComplete="off" onSubmit={e => { e.preventDefault(); void save(); }}>
      <label>{t('flows.siteOrigin')}<select value={origin} onChange={e => setOrigin(e.target.value)} required disabled={busy} data-testid="site-origin">{state?.origins.map(o => <option key={o}>{o}</option>)}</select></label>
      <label>{t('flows.siteUser')}<input value={user} onChange={e => setUser(e.target.value)} required maxLength={1000} disabled={busy} autoComplete="off" data-testid="site-user" /></label>
      <label>{t('flows.sitePassword')}<input type="password" value={password} onChange={e => setPassword(e.target.value)} required maxLength={1000} disabled={busy} autoComplete="new-password" data-testid="site-password" /></label>
      <div className="cred-row"><button type="submit" className="btn btn-primary btn-s" disabled={busy || !!state?.unavailable || !state?.origins.includes(origin)} data-testid="site-save">{t('flows.siteSave')}</button><button type="button" className="btn btn-ghost btn-s" disabled={busy} onClick={clear}>{t('flows.siteCancel')}</button></div>
    </form>}
  </section>;
}
