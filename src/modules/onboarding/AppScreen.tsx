// The app's account connectors (Azure DevOps, GitHub, Jira) as cards: what each is, whether it is connected and
// verified, what it is used for, one "Prova" (the read-only check), the sign-in as the fix when it is not connected,
// projects to find again, details with the disconnect. Reused by the setup interview (with its heading and Continua)
// and by Settings → Connettori (ConnectorsHub, `embedded`: cards only, beside the MCP servers, issue #91). Credentials
// never enter this component. Styles: renderer/styles/connectors-hub.css (the hub's card language, dark and light).
import { useEffect, useRef, useState } from 'react';
import type { ConnectorId, ConnectorPort, ConnectorState } from '../../shared/connectors';
import { t, locale } from '../../renderer/i18n';
import { HelpTip } from '../../renderer/components/HelpTip';
import '../../renderer/styles/connectors-hub.css';
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
const NAMES: Record<ConnectorId, string> = { github: 'GitHub', jira: 'Jira Cloud', azure: 'Azure DevOps' };
const MARKS: Record<ConnectorId, string> = { github: 'GH', jira: 'J', azure: 'Az' };
export function ConnectorCard({ value, busy, onLogin, onProbe, onSelect, onDisconnect }: { value: ConnectorState; busy: boolean; onLogin: () => void; onProbe: () => void; onSelect: (ids: string[]) => void; onDisconnect: () => void }) {
  const name = NAMES[value.provider], p = value.provider;
  const status = value.status === 'verified' ? 'ok' : value.status === 'failed' ? 'failed' : 'untested';
  return <article className="hub-card" aria-label={name} data-status={status} data-tone={p} data-testid={`hub-connector-${p}`}>
    <header className="hub-card-head">
      <span className="hub-mark" aria-hidden="true">{MARKS[p]}</span>
      <div className="hub-card-id"><h3>{name}</h3><p className="hub-kind">{t(`connector.kind.${p}`)}</p></div>
      <span role="status" className="hub-pill" data-status={status}><i aria-hidden="true" />{t(value.status === 'verified' ? 'connector.verified' : value.status === 'failed' ? 'connector.failed' : 'connector.pending')}</span>
    </header>
    <p className="hub-purpose">{t(`connector.use.${p}`)}</p>
    <dl className="hub-facts">
      <div><dt>{t('connector.account')}</dt><dd>{value.account ?? '—'}</dd></div>
      <div><dt>{t('connector.lastCheck')}</dt><dd>{value.checkedAt ? new Date(value.checkedAt).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : t('connector.never')}</dd></div>
      <div><dt>{t('connector.usedBy')}<HelpTip title={t('connector.usedBy')} label={`${t('connector.usedBy')} ${name}`}>{t(`connector.usedByTip.${p}`)}</HelpTip></dt><dd>{t(`connector.usedByValue.${p}`)}</dd></div>
    </dl>
    {value.status === 'failed' && <div className="hub-problem" role="note"><b>{t('connector.failed')}</b><p>{t('connector.failureHint')}</p></div>}
    {value.status === 'pending' && <div className="hub-hint" role="note"><p>{t(p === 'azure' ? 'connector.azureHint' : p === 'github' ? 'connector.githubHint' : 'connector.jiraHint')}</p></div>}
    {value.status === 'verified' && <fieldset className="hub-projects" disabled={busy}><legend>{t('connector.projects')}</legend>{value.projects.length ? value.projects.map(project => <label key={project.id} className="interview-choice"><input type="checkbox" checked={value.selected.includes(project.id)} onChange={event => onSelect(event.target.checked ? [...value.selected, project.id] : value.selected.filter(id => id !== project.id))}/>{project.name}</label>) : <p>{t('connector.empty')}</p>}</fieldset>}
    <footer className="hub-card-foot">
      <button className="btn btn-primary btn-m" type="button" disabled={busy} onClick={onProbe} aria-label={t('connector.probe', { name })}>{t('hub.test')}</button>
      {value.status !== 'verified' && <button className="btn btn-ghost btn-m" type="button" disabled={busy} onClick={onLogin}>{t('connector.login', { name })}</button>}
    </footer>
    <details className="hub-details"><summary>{t('connector.details')}</summary><p>{t(p === 'azure' ? 'connector.azureDetails' : p === 'github' ? 'connector.githubDetails' : 'connector.jiraDetails')}</p><p>{t(p === 'jira' ? 'connector.revokeJira' : 'connector.revoke')}</p><button className="btn btn-ghost btn-s" type="button" disabled={busy} onClick={onDisconnect}>{t('connector.disconnect', { name })}</button></details>
  </article>;
}
export function AppConnectorScreen({ connectionPort = port, onClose, embedded = false, onStates }: { connectionPort?: ConnectorPort; onClose?: () => void;
  /** Settings → Connettori: the cards only, in the hub's grid */ embedded?: boolean;
  /** the states shown, for the hub's totals */ onStates?: (states: ConnectorState[]) => void }) {
  const [values, setValues] = useState<ConnectorState[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const working = useRef(false), live = useRef(false);
  useEffect(() => { onStates?.(values); }, [values, onStates]);
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
  return <section className={`app-connectors ${embedded ? 'embedded' : ''}`} data-testid="app-connectors" aria-busy={busy} aria-label={embedded ? t('hub.accounts') : undefined}>
    {!embedded && <><h2>{t('connector.title')}</h2><p>{t('connector.intro')}</p><small>{t('connector.scope')}</small></>}
    <div className="hub-grid">{values.map(value => <ConnectorCard key={value.provider} value={value} busy={busy || pending} onLogin={() => login(value.provider)} onProbe={() => void run(() => connectionPort.probe(value.provider))} onSelect={ids => void run(() => connectionPort.select(value.provider, ids))} onDisconnect={() => void run(() => connectionPort.disconnect(value.provider))}/>)}</div>
    {!values.length && !error && <p role="status" className="hub-loading">{t('connector.loading')}</p>}{notice && <p role="status" className="hub-notice">{notice}</p>}{error && <p role="alert" className="hub-error">{error}</p>}
    {(signingIn || pending) && <button type="button" className="btn btn-ghost btn-m" onClick={cancel}>{t('connector.cancel')}</button>}
    {onClose && <button type="button" className="btn btn-primary" onClick={onClose}>{t(values.some(v => v.status === 'verified') ? 'connector.continue' : 'connector.later')}</button>}
  </section>;
}
