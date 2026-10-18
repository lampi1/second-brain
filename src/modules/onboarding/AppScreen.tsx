// Real app connector setup, reused after AI-first setup and in Settings. Credentials never enter this component.
import { useEffect, useRef, useState } from 'react';
import type { ConnectorId, ConnectorPort, ConnectorState } from '../../shared/connectors';
import { t, locale } from '../../renderer/i18n';
import './app-connectors.css';
// Resolve the client bridge only when an effect/action needs it, so Settings and card SSR stay importable in Node.
const bridge = () => import('../../renderer/sb');
const port: ConnectorPort = {
  list: async () => (await bridge()).sb.invoke('connectors:list', undefined),
  login: async provider => (await bridge()).sb.invoke('connectors:login', { provider }),
  cancelLogin: async () => (await bridge()).sb.invoke('connectors:cancelLogin', undefined),
  probe: async provider => (await bridge()).sb.invoke('connectors:probe', { provider }),
  select: async (provider, projects) => (await bridge()).sb.invoke('connectors:select', { provider, projects }),
  disconnect: async provider => (await bridge()).sb.invoke('connectors:disconnect', { provider }),
};
export function ConnectorCard({ value, busy, onLogin, onProbe, onSelect, onDisconnect }: { value: ConnectorState; busy: boolean; onLogin: () => void; onProbe: () => void; onSelect: (ids: string[]) => void; onDisconnect: () => void }) {
  const name = { github: 'GitHub', jira: 'Jira Cloud', azure: 'Azure DevOps' }[value.provider];
  return <article className="app-connector-card" aria-label={name}>
    <header><span className="app-connector-icon" aria-hidden="true">{value.provider === 'github' ? 'GH' : value.provider === 'jira' ? 'J' : 'Az'}</span><h3>{name}</h3><span role="status" data-status={value.status}>{t(value.status === 'verified' ? 'connector.verified' : value.status === 'failed' ? 'connector.failed' : 'connector.pending')}</span></header>
    <p>{t(value.provider === 'azure' ? 'connector.azureHint' : value.provider === 'github' ? 'connector.githubHint' : 'connector.jiraHint')}</p>
    {value.account && <p>{value.account}</p>}{value.status === 'failed' && <p>{t('connector.failureHint')}</p>}
    {value.checkedAt && <small>{t('connector.checked', {at:new Date(value.checkedAt).toLocaleString(locale())})}</small>}
    <div className="app-connector-actions"><button className="btn btn-primary" type="button" disabled={busy} onClick={onLogin}>{t('connector.login',{name})}</button><button className="btn" type="button" disabled={busy} onClick={onProbe}>{t('connector.probe',{name})}</button></div>
    {value.status === 'verified' && <fieldset disabled={busy}><legend>{t('connector.projects')}</legend>{value.projects.length ? value.projects.map(project => <label key={project.id} className="interview-choice"><input type="checkbox" checked={value.selected.includes(project.id)} onChange={event => onSelect(event.target.checked ? [...value.selected, project.id] : value.selected.filter(id => id !== project.id))}/>{project.name}</label>) : <p>{t('connector.empty')}</p>}</fieldset>}
    <details><summary>{t('connector.details')}</summary><p>{t(value.provider === 'azure' ? 'connector.azureDetails' : value.provider === 'github' ? 'connector.githubDetails' : 'connector.jiraDetails')}</p><p>{t(value.provider === 'jira' ? 'connector.revokeJira' : 'connector.revoke')}</p><button className="btn btn-ghost" type="button" disabled={busy} onClick={onDisconnect}>{t('connector.disconnect',{name})}</button></details>
  </article>;
}
export function AppConnectorScreen({ connectionPort = port, onClose }: { connectionPort?: ConnectorPort; onClose?: () => void }) {
  const [values, setValues] = useState<ConnectorState[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const working = useRef(false), live = useRef(false);
  useEffect(() => {
    live.current = true; let active = true;
    void connectionPort.list().then(value => { if (active) setValues(value); }, () => { if (active) setError(t('connector.loadError')); });
    // closing the screen (wizard step, Settings, popover) never cancels a sign-in in progress: it ends in main on its own,
    // and a reopened screen sees it in the list (signingIn) and offers the cancel again
    return () => { active = false; live.current = false; };
  }, [connectionPort]);
  const run = async (action: () => Promise<unknown>) => {
    if (working.current) return;
    working.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); const value = await connectionPort.list(); if (live.current) setValues(value); }
    catch { if (live.current) setError(t('connector.error')); }
    finally { working.current = false; if (live.current) setBusy(false); }
  };
  const login = (provider: ConnectorId) => void run(async () => { setSigningIn(true); setNotice(t('connector.notice')); try { await connectionPort.login(provider); } finally { if (live.current) setSigningIn(false); } });
  // a sign-in started before this screen opened: main refuses other actions until it ends, so wait for it or cancel it
  const pending = values.some(v => v.signingIn);
  useEffect(() => {
    if (!pending || signingIn) return;
    const timer = setInterval(() => void connectionPort.list().then(value => { if (live.current) setValues(value); }, () => {}), 2000);
    return () => clearInterval(timer);
  }, [pending, signingIn, connectionPort]);
  const cancel = () => void connectionPort.cancelLogin().then(() => connectionPort.list()).then(value => { if (live.current) setValues(value); }, () => { if (live.current) setError(t('connector.cancelError')); });
  return <section className="app-connectors" data-testid="app-connectors" aria-busy={busy}>
    <h2>{t('connector.title')}</h2><p>{t('connector.intro')}</p><small>{t('connector.scope')}</small>
    <div className="app-connector-list">{values.map(value => <ConnectorCard key={value.provider} value={value} busy={busy || pending} onLogin={() => login(value.provider)} onProbe={() => void run(() => connectionPort.probe(value.provider))} onSelect={ids => void run(() => connectionPort.select(value.provider, ids))} onDisconnect={() => void run(() => connectionPort.disconnect(value.provider))}/>)}</div>
    {!values.length && !error && <p role="status">{t('connector.loading')}</p>}{notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
    {(signingIn || pending) && <button type="button" className="btn" onClick={cancel}>{t('connector.cancel')}</button>}
    {onClose && <button type="button" className="btn btn-primary" onClick={onClose}>{t(values.some(v => v.status === 'verified') ? 'connector.continue' : 'connector.later')}</button>}
  </section>;
}
