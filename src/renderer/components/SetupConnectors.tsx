// The tools step of the first-run setup wizard (FirstInterview.tsx): one row per tool (GitHub, Azure DevOps, Jira
// Cloud) whose state is always the outcome of a REAL check (owner, 2026-10-19: "non si capisce dopo essersi connessi a
// un connettore se si è connessi veramente o no"). "Collega" opens the tool's official sign-in, then the app's
// read-only probe runs at once and, while a sign-in window is still open, again by itself every few seconds (and when
// the owner comes back to the window): the row ends as "Connesso" with the account and what was checked, or as "Non
// connesso" with what to do. Same typed IPC as Settings (connectors:list/login/probe/select/cancelLogin), one call at a
// time (main refuses two at once); credentials never pass here. Flow: lib/setup-connectors.ts.
import { useEffect, useRef, useState } from 'react';
import type { ConnectorId, ConnectorPort, ConnectorState } from '@shared/connectors';
import { sb } from '../sb';
import { locale, t } from '../i18n';
import { IconAlert, IconCheck, IconRefresh, IconShield, IconSpinner } from './Icons';
import { POLL_MS, TOOL_IDS, connectTool, linkFromState, opensWindow, pollTool, toolBusy, verifyTool } from '../lib/setup-connectors';
import type { ToolLink } from '../lib/setup-connectors';

const port: ConnectorPort = {
  list: () => sb.invoke('connectors:list', undefined),
  login: provider => sb.invoke('connectors:login', { provider }),
  cancelLogin: () => sb.invoke('connectors:cancelLogin', undefined),
  probe: provider => sb.invoke('connectors:probe', { provider }),
  select: (provider, projects) => sb.invoke('connectors:select', { provider, projects }),
  disconnect: provider => sb.invoke('connectors:disconnect', { provider }),
};
const NAME: Record<ConnectorId, string> = { github: 'GitHub', azure: 'Azure DevOps', jira: 'Jira Cloud' };
const MARK: Record<ConnectorId, string> = { github: 'GH', azure: 'Az', jira: 'J' };
const TONE: Record<ToolLink['phase'], 'ok' | 'wait' | 'off' | 'warn' | 'bad'> = { idle: 'off', signingIn: 'wait', waiting: 'wait', verifying: 'wait', connected: 'ok', failed: 'bad', error: 'bad' };
const time = (at: string | null | undefined) => at ? new Date(at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : '';

export function SetupConnectors({ connectionPort = port }: { connectionPort?: ConnectorPort }) {
  const [states, setStates] = useState<ConnectorState[]>([]);
  const [links, setLinks] = useState<Partial<Record<ConnectorId, ToolLink>>>({});
  const [loadError, setLoadError] = useState(false);
  const live = useRef(true), chain = useRef<Promise<unknown>>(Promise.resolve()), tries = useRef<Partial<Record<ConnectorId, number>>>({});
  const set = (id: ConnectorId, link: ToolLink) => { if (live.current) setLinks(l => ({ ...l, [id]: link })); };
  // one call at a time: main refuses a second while one runs ("Operazione già in corso")
  const serial = <T,>(task: () => Promise<T>): Promise<T> => { const next = chain.current.then(task, task); chain.current = next.catch(() => {}); return next; };
  const refresh = () => serial(() => connectionPort.list()).then(list => { if (!live.current) return; setStates(list); setLoadError(false); }, () => { if (live.current) setLoadError(true); });
  useEffect(() => {
    live.current = true;
    void serial(() => connectionPort.list()).then(list => {
      if (!live.current) return;
      setStates(list); setLinks(Object.fromEntries(list.map(s => [s.provider, linkFromState(s)])));
    }, () => { if (live.current) setLoadError(true); });
    return () => { live.current = false; };
  }, [connectionPort]);

  const connect = (id: ConnectorId) => {
    set(id, { phase: 'signingIn' }); tries.current[id] = 0;
    void serial(() => connectTool(connectionPort, id)).then(link => { set(id, link); void refresh(); });
  };
  const verify = (id: ConnectorId) => {
    set(id, { ...links[id], phase: 'verifying', error: null });
    void serial(() => verifyTool(connectionPort, id)).then(link => { set(id, link); void refresh(); });
  };
  const cancel = (id: ConnectorId) => { void connectionPort.cancelLogin().then(() => set(id, { phase: 'idle' }), () => set(id, { phase: 'error', error: t('connector.cancelError') })); };
  const select = (id: ConnectorId, ids: string[]) => { void serial(() => connectionPort.select(id, ids)).then(() => refresh(), () => set(id, { ...links[id]!, error: t('connector.error') })); };

  // a sign-in in its own window: checked again by itself every few seconds, and as soon as the owner comes back here
  const waiting = TOOL_IDS.filter(id => links[id]?.phase === 'waiting');
  const pollRef = useRef((_id: ConnectorId) => {});
  pollRef.current = (id: ConnectorId) => {
    const attempt = tries.current[id] ?? 0; tries.current[id] = attempt + 1;
    // applied only while the row still waits (a click on Verifica or Collega meanwhile wins)
    void serial(() => pollTool(connectionPort, id, attempt)).then(link => {
      if (!live.current) return;
      setLinks(l => l[id]?.phase === 'waiting' ? { ...l, [id]: link } : l);
      if (link.phase !== 'waiting') void refresh();
    });
  };
  useEffect(() => {
    if (!waiting.length) return;
    const tick = () => { for (const id of waiting) pollRef.current(id); };
    const timer = setInterval(tick, POLL_MS);
    window.addEventListener('focus', tick);
    return () => { clearInterval(timer); window.removeEventListener('focus', tick); };
  }, [waiting.join(',')]);

  return <div className="sw-tools" data-testid="setup-connectors">
    <ul className="sw-tool-list">{TOOL_IDS.map(id => {
      const link = links[id] ?? { phase: 'idle' as const }, state = states.find(s => s.provider === id), name = NAME[id], busy = toolBusy(link);
      const status = t(`setup.tools.status.${link.phase}`);
      return <li key={id} className={`sw-tool is-${TONE[link.phase]}`} data-testid={`setup-tool-${id}`} data-phase={link.phase} aria-label={name}>
        <span className="sw-tool-mark" aria-hidden="true">{MARK[id]}</span>
        <div className="sw-tool-main">
          <div className="sw-tool-head"><b>{name}</b><span className={`sw-pill sw-pill-${TONE[link.phase]}`} role="status" data-testid={`setup-tool-${id}-status`}>{busy || link.phase === 'waiting' ? <IconSpinner size={12}/> : link.phase === 'connected' ? <IconCheck size={12}/> : link.phase === 'failed' || link.phase === 'error' ? <IconAlert size={12}/> : <i aria-hidden="true"/>}{status}</span></div>
          {link.phase === 'idle' && <p className="sw-tool-hint">{t(`setup.tools.hint.${id}`)}</p>}
          {link.phase === 'signingIn' && <p className="sw-tool-hint">{t(opensWindow(id) ? 'setup.tools.opening' : 'setup.tools.jiraEntry', { name })}</p>}
          {(link.phase === 'waiting' || (link.phase === 'verifying' && !link.account)) && <div className="sw-callout" data-testid={`setup-tool-${id}-waiting`}><p>{t('setup.tools.waiting', { name })}</p></div>}
          {link.phase === 'connected' && <div className="sw-tool-ok" data-testid={`setup-tool-${id}-ok`}>
            <p><IconCheck size={14}/><span>{t('setup.tools.connectedAs', { account: link.account ?? '' })}</span></p>
            <small>{t('setup.tools.checked', { at: time(link.checkedAt), n: link.projects ?? 0 })}</small>
          </div>}
          {(link.phase === 'failed' || link.phase === 'error') && <div className="sw-tool-bad" role="alert" data-testid={`setup-tool-${id}-bad`}>
            <p><IconAlert size={14}/><span>{link.phase === 'error' && link.error ? t('setup.tools.notStarted', { reason: link.error }) : t('setup.tools.failed', { at: time(link.checkedAt) })}</span></p>
            <small>{t(`setup.tools.todo.${id}`)}</small>
          </div>}
          {link.phase === 'connected' && state && state.projects.length > 0 && <details className="sw-tool-projects"><summary>{t('setup.tools.projects', { n: state.selected.length, total: state.projects.length })}</summary>
            <div className="sw-tool-project-list">{state.projects.map(p => <label key={p.id} className="sw-check"><input type="checkbox" checked={state.selected.includes(p.id)} onChange={e => select(id, e.target.checked ? [...state.selected, p.id] : state.selected.filter(x => x !== p.id))}/>{p.name}</label>)}</div>
          </details>}
        </div>
        <div className="sw-tool-actions">
          {(link.phase === 'idle' || link.phase === 'failed' || link.phase === 'error') && <button type="button" className="btn btn-m btn-primary" onClick={() => connect(id)} aria-label={t('setup.tools.connectAria', { name })} data-testid={`setup-tool-${id}-connect`}>{link.phase === 'idle' ? t('setup.tools.connect') : t('setup.tools.retry')}</button>}
          {link.phase === 'signingIn' && !opensWindow(id) && <button type="button" className="btn btn-m btn-ghost" onClick={() => cancel(id)}>{t('connector.cancel')}</button>}
          {(link.phase === 'waiting' || link.phase === 'connected' || link.phase === 'failed') && <button type="button" className="btn btn-m btn-ghost" disabled={busy} onClick={() => verify(id)} aria-label={t('setup.tools.verifyAria', { name })} data-testid={`setup-tool-${id}-verify`}><IconRefresh size={13}/>{link.phase === 'waiting' ? t('setup.tools.verifyNow') : t('setup.tools.verifyAgain')}</button>}
          {link.phase === 'verifying' && <button type="button" className="btn btn-m btn-ghost" disabled><IconSpinner size={13}/>{t('setup.tools.verifying')}</button>}
        </div>
      </li>;
    })}</ul>
    {loadError && <p className="sw-error" role="alert">{t('connector.loadError')}</p>}
    <p className="sw-note"><IconShield size={15}/><span>{t('setup.tools.trust')}</span></p>
  </div>;
}
