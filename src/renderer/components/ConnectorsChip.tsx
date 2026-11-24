// Connectors and MCP servers on the top bar (ADR 0347): one chip with how many work (a red count when some need a fix),
// and on click a panel like the usage one: the app's accounts (Azure DevOps, GitHub, Jira) and the MCP servers the
// agents use, each with its state and the one action it needs: «Accedi» (account sign-in, or a remote server's OAuth
// login), «Prova» (test again). The full cards stay in Settings → Connettori («Gestisci»). Data: 'connectors:list' and
// the shared MCP state (lib/mcp-servers.ts, with the chip's pure count). Used by TopBar.tsx.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ConnectorId, ConnectorState } from '@shared/connectors';
import type { McpServersState } from '@shared/mcp-servers';
import { t } from '../i18n';
import { go } from '../actions';
import { toast } from '../store/ui';
import { accountStatus, chipSummary, monogram, serverStatus, useMcpServers, type ServerStatus } from '../lib/mcp-servers';
import { offersLogin } from './ConnectorsHub';
import { IconLink, IconRefresh } from './Icons';
import { Popover } from './ui';

const NAMES: Record<ConnectorId, string> = { github: 'GitHub', jira: 'Jira Cloud', azure: 'Azure DevOps' };
const MARKS: Record<ConnectorId, string> = { github: 'GH', jira: 'J', azure: 'Az' };

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : t('hub.error'));

function Row({ mark, name, sub, status, children, testid }: { mark: string; name: string; sub: string; status: ServerStatus; children?: ReactNode; testid: string }) {
  return (
    <div className="cc-row" data-status={status} data-testid={testid}>
      <span className="cc-mark" aria-hidden="true">{mark}</span>
      <span className="cc-text"><b>{name}</b><small><i className="cc-dot" aria-hidden="true" />{sub}</small></span>
      <span className="cc-actions">{children}</span>
    </div>
  );
}

export function ConnectorsChip() {
  const { state, set } = useMcpServers();
  const [accounts, setAccounts] = useState<ConnectorState[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const reload = useCallback(() => window.sb.invoke('connectors:list', undefined).then(setAccounts, () => {}), []);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { if (open) void reload(); }, [open, reload]);
  // a sign-in runs in main; while one is open, read the list again until it ends
  const signing = accounts.some(a => a.signingIn);
  useEffect(() => {
    if (!signing) return;
    const timer = setInterval(() => void reload(), 2000);
    return () => clearInterval(timer);
  }, [signing, reload]);

  const servers = state?.servers ?? [];
  const sum = chipSummary(accounts, servers);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(key);
    try { await fn(); } catch (e) { toast(errText(e), 'err'); } finally { setBusy(null); }
  };
  const mcp = (key: string, fn: () => Promise<McpServersState>) => run(key, async () => set(await fn()));
  const account = (key: string, fn: () => Promise<unknown>) => run(key, async () => { try { await fn(); } finally { await reload(); } });

  const label = sum.total ? t('appText.topBar.connectorsTip', { ok: sum.ok, total: sum.total }) + (sum.bad ? ` · ${t('appText.topBar.connectorsBad', { n: sum.bad })}` : '') : t('appText.topBar.connectorsNone');
  return (
    <>
      <button ref={ref} type="button" className="usagebar cc-chip" data-tone={sum.tone} onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="dialog" aria-label={label} data-tip={label} data-testid="topbar-connectors">
        <IconLink size={14} />
        <span className="connectors-label">{t('appText.topBar.connectors')}</span>
        {sum.total > 0 && <b className="ub-v" data-testid="topbar-connectors-count">{sum.ok}/{sum.total}</b>}
        {sum.bad > 0 && <span className="count-badge red" data-testid="topbar-connectors-bad">{sum.bad}</span>}
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} testid="connectors-pop" width={380} kind="dialog" label={t('appText.topBar.connectors')}>
        <div className="ub-pop cc-pop">
          <section className="ub-sec">
            <div className="ub-sec-head"><span>{t('hub.accounts')}</span></div>
            {accounts.map(a => {
              const st = accountStatus(a), name = NAMES[a.provider];
              return (
                <Row key={a.provider} mark={MARKS[a.provider]} name={name} status={st} testid={`cc-account-${a.provider}`}
                  sub={a.signingIn ? t('hub.logging') : a.status === 'verified' ? (a.account ?? t('connector.verified')) : t(a.status === 'failed' ? 'connector.failed' : 'connector.pending')}>
                  {a.status !== 'verified' && <button type="button" className="btn btn-primary btn-s" disabled={!!busy || signing} aria-label={t('connector.login', { name })} onClick={() => void account(`a-${a.provider}`, () => window.sb.invoke('connectors:login', { provider: a.provider }))} data-testid={`cc-login-${a.provider}`}>{t('hub.login')}</button>}
                  {(a.status !== 'pending' || a.account) && <button type="button" className="icon-btn" disabled={!!busy || signing} aria-label={t('connector.probe', { name })} data-tip={t('hub.test')} onClick={() => void account(`p-${a.provider}`, () => window.sb.invoke('connectors:probe', { provider: a.provider }))} data-testid={`cc-probe-${a.provider}`}><IconRefresh size={13} /></button>}
                </Row>
              );
            })}
            {!accounts.length && <p className="ub-note">{t('connector.loading')}</p>}
          </section>
          <section className="ub-sec">
            <div className="ub-sec-head"><span>{t('hub.servers')}</span></div>
            {servers.map(s => {
              const st = serverStatus(s), login = offersLogin(s) && !s.login;
              return (
                <Row key={s.id} mark={monogram(s.label)} name={s.label} status={st} testid={`cc-server-${s.id}`}
                  sub={busy === `t-${s.id}` ? t('hub.testing') : busy === `l-${s.id}` ? t('hub.logging') : s.login?.who ? `${t(`hub.status.${st}`)} · ${s.login.who}` : t(`hub.status.${st}`)}>
                  {login && <button type="button" className="btn btn-primary btn-s" disabled={!!busy} aria-label={t('hub.loginName', { name: s.label })} onClick={() => void mcp(`l-${s.id}`, () => window.sb.invoke('mcpservers:login', { id: s.id }))} data-testid={`cc-mcp-login-${s.id}`}>{t('hub.login')}</button>}
                  {st === 'missing' && <button type="button" className="btn btn-ghost btn-s" onClick={() => { setOpen(false); go({ page: 'impostazioni', arg: 'connectors' }); }}>{t('appText.topBar.connectorsToken')}</button>}
                  {s.enabled && st !== 'missing' && <button type="button" className="icon-btn" disabled={!!busy} aria-label={t('hub.testName', { name: s.label })} data-tip={t('hub.test')} onClick={() => void mcp(`t-${s.id}`, () => window.sb.invoke('mcpservers:test', { id: s.id }))} data-testid={`cc-mcp-test-${s.id}`}><IconRefresh size={13} /></button>}
                </Row>
              );
            })}
            {!servers.length && <p className="ub-note">{t('appText.topBar.connectorsNoServers')}</p>}
          </section>
          <section className="ub-sec cc-foot">
            <button type="button" className="btn btn-ghost btn-s" onClick={() => { setOpen(false); go({ page: 'impostazioni', arg: 'connectors' }); }} data-testid="cc-manage">{t('appText.topBar.connectorsManage')}</button>
          </section>
        </div>
      </Popover>
    </>
  );
}
