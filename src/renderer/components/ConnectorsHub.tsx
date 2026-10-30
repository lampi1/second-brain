// Settings → Connettori (issue #91, ADR 0086): one section for everything the app connects to, as cards in a grid like
// the Agenti page. On top three totals with a "?" each (how they are counted); then the app's account
// connectors (Azure DevOps, GitHub, Jira: AppConnectorScreen embedded) and the MCP servers the agents use: each card
// says what it is (local command or remote address), whether it works (its last "Prova"), what it is used for, how
// many tools it has (reading and writing) and how many roles may use it, with the error and its fix when it fails and
// the token field (write-only: typed once, then only its mask) when it needs one. A tool is added from the catalog
// (ToolCatalog.tsx: account and server together, tested at once, ADR 0119); the technical form (command, args, env,
// headers) and "Importa da Claude e Cursor" (their configs read once, read only, imported without any secret) live in
// Settings → Avanzate (McpAdvanced, below). «Aggiungi server MCP» (McpAddPanel.tsx, ADR 0207): paste JSON, a command or
// a URL, or pick a popular server; each card's «Chi lo usa» chips turn it on or off for the Orchestrator, each role and
// Flash. Clean install: a friendly empty state saying what will appear. Styles: styles/connectors-hub.css.
import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import type { ConnectorState } from '@shared/connectors';
import type { McpImportCandidate, McpServerView, McpServersState } from '@shared/mcp-servers';
import { slotKey } from '@shared/mcp-servers';
import { AppConnectorScreen } from '../../modules/onboarding/AppScreen';
import { HelpTip } from './HelpTip';
import { ToolCatalog } from './ToolCatalog';
import { IconPlus, IconRefresh } from './Icons';
import { locale, t } from '../i18n';
import { toast } from '../store/ui';
import { holdUpdate } from '../lib/update-barrier';
import { defOf, emptyForm, formOf, hubTotals, monogram, onMcpDraft, rolesWith, runsAs, serverStatus, takeMcpDraft, useMcpServers, type ServerForm } from '../lib/mcp-servers';
import { MCP_ACCESS_ROLES, type McpServerDef } from '@shared/mcp-servers';
import { McpAddPanel, ServerRoles } from './McpAddPanel';
import '../styles/connectors-hub.css';

const STATUS_KEY = { ok: 'hub.status.ok', untested: 'hub.status.untested', missing: 'hub.status.missing', failed: 'hub.status.failed', off: 'hub.status.off' } as const;

/** The three totals over the cards (each with how it is counted). */
export function HubTotalsRow({ servers, connectors }: { servers: readonly McpServerView[]; connectors: readonly ConnectorState[] }) {
  const n = hubTotals(servers, connectors);
  return <dl className="hub-totals" data-testid="hub-totals">
    <div data-tone="green"><dt>{t('hub.total.working')}<HelpTip title={t('hub.total.working')} label={t('hub.total.working')}>{t('hub.total.workingTip')}</HelpTip></dt><dd><b>{n.working}</b><small>{t('hub.total.of', { n: n.total })}</small></dd></div>
    <div data-tone={n.toFix ? 'red' : 'muted'}><dt>{t('hub.total.toFix')}<HelpTip title={t('hub.total.toFix')} label={t('hub.total.toFix')}>{t('hub.total.toFixTip')}</HelpTip></dt><dd><b>{n.toFix}</b><small>{n.toFix ? t('hub.total.toFixHint') : t('hub.total.allGood')}</small></dd></div>
    <div data-tone="blue"><dt>{t('hub.total.tools')}<HelpTip title={t('hub.total.tools')} label={t('hub.total.tools')} example={t('hub.total.toolsEx')} testid="hub-total-tools-help">{t('hub.total.toolsTip')}</HelpTip></dt><dd><b>{n.tools}</b><small>{t('hub.total.reading', { r: n.reading, w: n.tools - n.reading })}</small></dd></div>
  </dl>;
}

function TokenRow({ server, slot, available, onSaved }: { server: McpServerView; slot: McpServerView['secrets'][number]; available: boolean; onSaved: (s: McpServersState) => void }) {
  const key = slotKey(slot), mask = server.secretMasks[key] ?? null;
  const [value, setValue] = useState(''), [editing, setEditing] = useState(mask === null), [busy, setBusy] = useState(false);
  const id = useId();
  useEffect(() => (value ? holdUpdate(t('hub.token')) : undefined), [value]);
  useEffect(() => { setEditing(mask === null); }, [mask]);
  const run = async (fn: () => Promise<McpServersState>) => { setBusy(true); try { onSaved(await fn()); } catch (e) { toast(e instanceof Error ? e.message : t('hub.error'), 'err'); } finally { setBusy(false); } };
  return <div className="hub-token" data-testid={`hub-token-${server.id}`}>
    <span className="hub-token-label"><label htmlFor={id}>{t('hub.tokenFor', { name: slot.name })}</label><HelpTip title={t('hub.token')} label={`${t('hub.token')} ${server.label}`}>{t(slot.where === 'env' ? 'hub.tokenTipEnv' : 'hub.tokenTipHeader', { name: slot.name })}</HelpTip></span>
    {!editing && mask ? <div className="hub-token-line"><code>{mask}</code><button type="button" className="btn btn-ghost btn-s" onClick={() => setEditing(true)}>{t('hub.replace')}</button><button type="button" className="btn btn-ghost btn-s" disabled={busy} onClick={() => void run(() => window.sb.invoke('mcpservers:deleteSecret', { id: server.id, slot: key }))}>{t('hub.deleteToken')}</button></div>
      : <div className="hub-token-line"><input id={id} className="st-input" type="password" autoComplete="off" spellCheck={false} value={value} placeholder={t('hub.tokenPlaceholder')} disabled={!available || busy} onChange={e => setValue(e.target.value)} />
        <button type="button" className="btn btn-primary btn-s" disabled={!available || busy || !value.trim()} onClick={() => { const v = value.trim(); setValue(''); void run(() => window.sb.invoke('mcpservers:setSecret', { id: server.id, slot: key, value: v })); }}>{t('hub.saveToken')}</button></div>}
    {!available && <small className="hub-muted">{t('hub.noKeyring')}</small>}
  </div>;
}

/** One MCP server's card. */
export function ServerCard({ server, state, onEdit, onState, testing, onTest }: { server: McpServerView; state: McpServersState; onEdit?: () => void; onState: (s: McpServersState) => void; testing: boolean; onTest: () => void }) {
  const status = serverStatus(server), test = server.lastTest, tools = test?.tools ?? [];
  const reading = tools.filter(x => x.readOnly).length, roles = rolesWith(state, server.id).length;
  return <article className="hub-card" aria-label={server.label} data-status={status} data-tone={server.transport} data-testid={`hub-server-${server.id}`}>
    <header className="hub-card-head">
      <span className="hub-mark" aria-hidden="true">{monogram(server.label)}</span>
      <div className="hub-card-id"><h3>{server.label}</h3><p className="hub-kind">{t(server.transport === 'stdio' ? 'hub.kind.stdio' : 'hub.kind.http')}{server.importedFrom && <> · {t('hub.importedFrom', { from: server.importedFrom === 'claude' ? 'Claude' : server.importedFrom === 'cursor' ? 'Cursor' : 'Codex' })}</>}</p></div>
      <span role="status" className="hub-pill" data-status={status}><i aria-hidden="true" />{testing ? t('hub.testing') : t(STATUS_KEY[status])}</span>
    </header>
    <p className={`hub-purpose ${server.purpose ? '' : 'hub-muted'}`}>{server.purpose || t('hub.noPurpose')}</p>
    <code className="hub-runs" title={runsAs(server)}>{runsAs(server)}</code>
    <dl className="hub-facts">
      <div><dt>{t('hub.tools')}<HelpTip title={t('hub.tools')} label={`${t('hub.tools')} ${server.label}`}>{t('hub.toolsTip')}</HelpTip></dt><dd>{test && (test.ok || tools.length) ? <>{tools.length}<small>{t('hub.toolsSplit', { r: reading, w: tools.length - reading })}</small></> : '—'}</dd></div>
      <div><dt>{t('hub.agents')}<HelpTip title={t('hub.agents')} label={`${t('hub.agents')} ${server.label}`}>{t('hub.agentsTip')}</HelpTip></dt><dd>{server.enabled ? t('hub.agentsValue', { n: roles, total: MCP_ACCESS_ROLES.length }) : t('hub.status.off')}</dd></div>
      <div><dt>{t('hub.lastTest')}</dt><dd>{test ? <>{new Date(test.at).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{test.ok && test.ms > 0 && <small>{t('hub.ms', { ms: test.ms })}</small>}</> : t('connector.never')}</dd></div>
    </dl>
    <div className="hub-who"><span>{t('mcpadd.who')}</span><ServerRoles server={server.id} state={state} onState={onState} /></div>
    {test && !test.ok && test.error && <div className="hub-problem" role="note" data-testid={`hub-problem-${server.id}`}><b>{test.error.message}</b><p><span>{t('hub.fix')}</span> {test.error.fix}</p></div>}
    {status === 'untested' && <div className="hub-hint" role="note"><p>{t('hub.untestedHint')}</p></div>}
    {server.secrets.map(slot => <TokenRow key={slotKey(slot)} server={server} slot={slot} available={state.secretsAvailable} onSaved={onState} />)}
    {tools.length > 0 && <details className="hub-details hub-tools"><summary>{t('hub.toolList', { n: tools.length })}</summary><ul>{tools.map(x => <li key={x.name} data-ro={x.readOnly}><i aria-hidden="true" /><code>{x.name}</code><span>{x.readOnly ? t('hub.read') : t('hub.write')}</span>{x.description && <small>{x.description}</small>}</li>)}</ul></details>}
    <footer className="hub-card-foot">
      <button type="button" className="btn btn-primary btn-m" disabled={testing} onClick={onTest} aria-label={t('hub.testName', { name: server.label })}>{t('hub.test')}</button>
      {onEdit && <button type="button" className="btn btn-ghost btn-m" onClick={onEdit} aria-label={t('hub.editName', { name: server.label })}>{t('hub.edit')}</button>}
    </footer>
  </article>;
}

/** A form field: its label (never wrapping the "?", which is a button of its own) and its control. */
function Field({ label, tip, children }: { label: string; tip?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return <div className="hub-field"><span><label htmlFor={id}>{label}</label>{tip && <HelpTip title={label} label={label}>{tip}</HelpTip>}</span>{children(id)}</div>;
}

/** The add/edit form, in place of a card (full width). */
export function ServerEditor({ server, onDone }: { server: McpServerView | null; onDone: (s?: McpServersState) => void }) {
  const [f, setF] = useState<ServerForm>(() => (server ? formOf(server) : emptyForm()));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const set = <K extends keyof ServerForm>(k: K, v: ServerForm[K]) => setF(x => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true); setError('');
    try { onDone(await window.sb.invoke('mcpservers:save', { def: defOf(f, server ?? undefined), ...(server ? { previousId: server.id } : {}) })); }
    catch (e) { setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : t('hub.error')); }
    finally { setBusy(false); }
  };
  const remove = async () => { if (!server) return; setBusy(true); try { onDone(await window.sb.invoke('mcpservers:remove', { id: server.id })); } catch { setError(t('hub.error')); } finally { setBusy(false); } };
  const field = (k: keyof ServerForm, label: string, opts: { area?: boolean; placeholder?: string; tip?: string; mono?: boolean } = {}) => <Field key={k} label={label} tip={opts.tip}>
    {id => opts.area ? <textarea id={id} className={`st-input ${opts.mono ? 'mono' : ''}`} rows={3} value={String(f[k])} placeholder={opts.placeholder} spellCheck={false} onChange={e => set(k, e.target.value as never)} />
      : <input id={id} className={`st-input ${opts.mono ? 'mono' : ''}`} value={String(f[k])} placeholder={opts.placeholder} spellCheck={false} onChange={e => set(k, e.target.value as never)} />}
  </Field>;
  return <article className="hub-card hub-editor" aria-label={server ? t('hub.editName', { name: server.label }) : t('hub.add')} data-testid="hub-editor">
    <header className="hub-card-head"><span className="hub-mark" aria-hidden="true">{monogram(f.label || '+')}</span><div className="hub-card-id"><h3>{server ? t('hub.editName', { name: server.label }) : t('hub.add')}</h3><p className="hub-kind">{t('hub.editorLead')}</p></div></header>
    <div className="hub-form">
      {field('label', t('hub.f.label'), { placeholder: 'Azure DevOps' })}
      <fieldset className="hub-seg"><legend>{t('hub.f.transport')}<HelpTip title={t('hub.f.transport')} label={t('hub.f.transport')}>{t('hub.f.transportTip')}</HelpTip></legend>
        {(['stdio', 'http'] as const).map(v => <label key={v} data-on={f.transport === v}><input type="radio" name="hub-transport" checked={f.transport === v} onChange={() => setF(x => ({ ...x, transport: v, tokenPrefix: v === 'http' ? 'Bearer ' : '' }))} />{t(v === 'stdio' ? 'hub.kind.stdio' : 'hub.kind.http')}</label>)}
      </fieldset>
      {f.transport === 'stdio' ? <>
        {field('command', t('hub.f.command'), { placeholder: 'npx', mono: true, tip: t('hub.f.commandTip') })}
        {field('args', t('hub.f.args'), { area: true, mono: true, placeholder: '-y\n@azure-devops/mcp\ncontoso' })}
        {field('env', t('hub.f.env'), { area: true, mono: true, placeholder: 'ORG=contoso', tip: t('hub.f.envTip') })}
      </> : <>
        {field('url', t('hub.f.url'), { placeholder: 'https://example.com/mcp', mono: true, tip: t('hub.f.urlTip') })}
        {field('headers', t('hub.f.headers'), { area: true, mono: true, placeholder: 'X-Team: web', tip: t('hub.f.envTip') })}
      </>}
      <div className="hub-form-row">
        {field('tokenName', t(f.transport === 'stdio' ? 'hub.f.tokenEnv' : 'hub.f.tokenHeader'), { mono: true, placeholder: f.transport === 'stdio' ? 'AZURE_DEVOPS_PAT' : 'Authorization', tip: t('hub.f.tokenTip') })}
        {f.transport === 'http' && field('tokenPrefix', t('hub.f.prefix'), { mono: true, placeholder: 'Bearer ' })}
      </div>
      {field('purpose', t('hub.f.purpose'), { placeholder: t('hub.f.purposeHint') })}
      <label className="hub-check"><input type="checkbox" checked={f.enabled} onChange={e => set('enabled', e.target.checked)} />{t('hub.f.enabled')}</label>
    </div>
    {error && <p role="alert" className="hub-problem"><b>{error}</b></p>}
    <footer className="hub-card-foot">
      <button type="button" className="btn btn-primary btn-m" disabled={busy || !f.label.trim()} onClick={() => void save()}>{t('common.save')}</button>
      <button type="button" className="btn btn-ghost btn-m" disabled={busy} onClick={() => onDone()}>{t('hub.cancel')}</button>
      {server && <button type="button" className="btn btn-danger btn-m hub-push" disabled={busy} onClick={() => void remove()}>{t('hub.remove')}</button>}
    </footer>
  </article>;
}

function ImportPanel({ onDone }: { onDone: (s?: McpServersState) => void }) {
  const [found, setFound] = useState<McpImportCandidate[] | null>(null), [chosen, setChosen] = useState<string[]>([]), [busy, setBusy] = useState(false), [errors, setErrors] = useState<string[]>([]);
  useEffect(() => { void window.sb.invoke('mcpservers:importScan', undefined).then(list => { setFound(list); setChosen(list.filter(c => !c.exists).map(c => c.key)); }, () => setFound([])); }, []);
  const apply = async () => {
    setBusy(true);
    try { const r = await window.sb.invoke('mcpservers:importApply', { keys: chosen }); setErrors(r.errors.map(e => e.message)); if (!r.errors.length) { toast(t('hub.imported', { n: r.added.length }), 'ok'); onDone(r.state); } }
    catch { setErrors([t('hub.error')]); } finally { setBusy(false); }
  };
  return <section className="hub-import" aria-label={t('hub.import')} data-testid="hub-import">
    <header><h4>{t('hub.import')}</h4><p>{t('hub.importLead')}</p></header>
    {found === null ? <p role="status">{t('hub.importScanning')}</p> : !found.length ? <p role="status">{t('hub.importNone')}</p> : <ul>{found.map(c => <li key={c.key}>
      <label><input type="checkbox" checked={chosen.includes(c.key)} disabled={c.exists} onChange={e => setChosen(x => e.target.checked ? [...x, c.key] : x.filter(k => k !== c.key))} />
        <b>{c.def.label}</b><span className="hub-chip">{c.source === 'claude' ? 'Claude' : c.source === 'cursor' ? 'Cursor' : 'Codex'}</span><code>{runsAs(c.def)}</code></label>
      {c.exists && <small>{t('hub.importExists')}</small>}
      {c.secretsDropped.length > 0 && <small>{t('hub.importDropped', { list: c.secretsDropped.join(', ') })}</small>}
    </li>)}</ul>}
    {errors.map(e => <p key={e} role="alert" className="hub-error">{e}</p>)}
    <footer className="hub-card-foot">
      <button type="button" className="btn btn-primary btn-m" disabled={busy || !chosen.length} onClick={() => void apply()}>{t('hub.importApply', { n: chosen.length })}</button>
      <button type="button" className="btn btn-ghost btn-m" onClick={() => onDone()}>{t('hub.cancel')}</button>
    </footer>
  </section>;
}

export function ConnectorsHub() {
  const { state, error, set } = useMcpServers();
  const [connectors, setConnectors] = useState<ConnectorState[]>([]);
  const [testing, setTesting] = useState<string[]>([]);
  const onStates = useCallback((s: ConnectorState[]) => setConnectors(s), []);
  const test = async (id: string) => {
    setTesting(x => [...x, id]);
    try { set(await window.sb.invoke('mcpservers:test', { id })); } catch { toast(t('hub.error'), 'err'); } finally { setTesting(x => x.filter(y => y !== id)); }
  };
  const servers = state?.servers ?? [];
  const testAll = () => { for (const s of servers) if (s.enabled) void test(s.id); };
  // «Aggiungi server MCP» (ADR 0207); a draft the Orchestrator opened (app_config form) opens it prefilled
  const [adding, setAdding] = useState<{ n: number; initial: { def: McpServerDef; tokens: string[] } | null } | null>(null);
  useEffect(() => {
    const take = () => { const d = takeMcpDraft(); if (d) { setAdding(x => ({ n: (x?.n ?? 0) + 1, initial: d })); requestAnimationFrame(() => document.querySelector('[data-testid="mcp-add"]')?.scrollIntoView({ block: 'center' })); } };
    take();
    return onMcpDraft(take);
  }, []);
  return <div className="hub" data-testid="connectors-hub">
    <p className="hub-lead">{t('hub.lead')}<HelpTip title={t('hub.whatTitle')} label={t('hub.whatTitle')} wide guide="mcp-servers">{t('hub.whatTip')}</HelpTip></p>
    <HubTotalsRow servers={servers} connectors={connectors} />
    <section className="hub-section" aria-labelledby="hub-catalog" data-testid="hub-catalog">
      <header className="hub-section-head"><h3 id="hub-catalog">{t('hub.catalog')}</h3><p>{t('hub.serversLead')}</p></header>
      <ToolCatalog />
      <p className="hub-muted">{t('hub.advancedNote')}</p>
    </section>
    <section className="hub-section" aria-labelledby="hub-accounts">
      <header className="hub-section-head"><h3 id="hub-accounts">{t('hub.accounts')}<HelpTip title={t('hub.accounts')} label={t('hub.accounts')}>{t('hub.accountsTip')}</HelpTip></h3><p>{t('hub.accountsLead')}</p></header>
      <AppConnectorScreen embedded onStates={onStates} />
    </section>
    <section className="hub-section" aria-labelledby="hub-servers" data-testid="hub-servers">
      <header className="hub-section-head"><h3 id="hub-servers">{t('hub.servers')}<HelpTip title={t('hub.servers')} label={t('hub.servers')} wide>{t('hub.serversTip')}</HelpTip></h3>
        <div className="hub-actions">
          {servers.length > 1 && <button type="button" className="btn btn-ghost btn-m" onClick={testAll} disabled={testing.length > 0}><IconRefresh size={14} />{t('hub.testAll')}</button>}
          {!adding && <button type="button" className="btn btn-primary btn-m" onClick={() => setAdding({ n: 0, initial: null })} data-testid="mcp-add-open"><IconPlus size={14} />{t('mcpadd.open')}</button>}
        </div>
      </header>
      {adding && <McpAddPanel key={adding.n} initial={adding.initial} onDone={s => { if (s) set(s); setAdding(null); }} />}
      {error && <p role="alert" className="hub-error">{t('hub.loadError')}</p>}
      {state && !servers.length && !adding && <div className="hub-empty" data-testid="hub-empty"><b>{t('hub.emptyTitle')}</b><p>{t('hub.emptyBody')}</p></div>}
      <div className="hub-grid">
        {state && servers.map(s => <ServerCard key={s.id} server={s} state={state} testing={testing.includes(s.id)} onTest={() => void test(s.id)} onState={set} />)}
      </div>
      {!state?.secretsAvailable && state?.secretsWhy && <p className="hub-muted">{t('hub.keyringWhy', { why: state.secretsWhy })}</p>}
    </section>
  </div>;
}

/** Settings → Avanzate (ADR 0119): the technical MCP form (stdio/http, command, args, env, headers), the import from
 *  Claude and Cursor, and editing or removing any server field by field. */
export function McpAdvanced() {
  const { state, error, set } = useMcpServers();
  const [editing, setEditing] = useState<string | 'new' | null>(null), [importing, setImporting] = useState(false);
  const done = (s?: McpServersState) => { if (s) set(s); setEditing(null); setImporting(false); };
  const servers = state?.servers ?? [];
  return <div className="hub" data-testid="mcp-advanced">
    <section className="hub-section" aria-labelledby="hub-adv-servers">
      <header className="hub-section-head"><h3 id="hub-adv-servers">{t('hub.adv.servers')}</h3><p>{t('hub.adv.lead')}</p>
        <div className="hub-actions">
          <button type="button" className="btn btn-primary btn-m" onClick={() => { setImporting(false); setEditing('new'); }} data-testid="hub-add"><IconPlus size={14} />{t('hub.add')}</button>
          <button type="button" className="btn btn-ghost btn-m" onClick={() => { setEditing(null); setImporting(true); }} data-testid="hub-import-open">{t('hub.import')}</button>
        </div>
      </header>
      {importing && <ImportPanel onDone={done} />}
      {error && <p role="alert" className="hub-error">{t('hub.loadError')}</p>}
      {editing === 'new' && <div className="hub-grid"><ServerEditor server={null} onDone={done} /></div>}
      {state && !servers.length && editing !== 'new' && <p className="hub-muted">{t('hub.adv.empty')}</p>}
      {servers.length > 0 && <ul className="hub-adv-list">{servers.map(s => editing === s.id
        ? <li key={s.id} className="hub-adv-edit"><ServerEditor server={s} onDone={done} /></li>
        : <li key={s.id} data-testid={`hub-adv-${s.id}`}><span className="hub-mark" aria-hidden="true">{monogram(s.label)}</span><b>{s.label}</b><code title={runsAs(s)}>{runsAs(s)}</code>
          <button type="button" className="btn btn-ghost btn-s" onClick={() => { setImporting(false); setEditing(s.id); }} aria-label={t('hub.editName', { name: s.label })}>{t('hub.edit')}</button></li>)}</ul>}
    </section>
  </div>;
}
