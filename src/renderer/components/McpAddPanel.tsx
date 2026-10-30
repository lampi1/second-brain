// «Aggiungi server MCP» (ADR 0207; the owner, 2026-10-30: «MCP deve essere facilissimo configurarlo»): paste what a
// server's README shows (a Claude Desktop / Cursor `mcpServers` JSON, a command line like `npx -y @x/server`, or an
// http(s) URL) and the form fills itself (shared/mcp-paste.ts), or pick a popular server with one click. The form: name,
// local command (one line) or remote address, plain variables or headers, the tokens as masked fields (a pasted value
// lands there, never in the definition; it goes only to the app's secret store, mcpservers:setSecret), what it is for,
// and who may use it (the Orchestrator, the five roles, Flash: RoleAccessChips). «Salva e prova» saves, stores the
// tokens, sets the roles and opens the server as a chat would: «Funziona: N strumenti» or the error and its fix. A draft
// the Orchestrator opened (app_config action form) arrives prefilled, its tokens still to type. Shown in Settings →
// Connettori (ConnectorsHub.tsx). Styles: styles/connectors-hub.css (.mcp-add).
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import type { McpServerDef, McpServersState, McpTestResult } from '@shared/mcp-servers';
import { FLASH_MCP_ROLE, MCP_ACCESS_ROLES, accessOn, defaultAccess, toggleAccess } from '@shared/mcp-servers';
import { MCP_CATALOG, catalogDraft, parseMcpSnippet, type McpDraft } from '@shared/mcp-paste';
import { roleName } from '@shared/roles';
import { addFormOf, defOfAdd, emptyAddForm, type AddForm } from '../lib/mcp-servers';
import { holdUpdate } from '../lib/update-barrier';
import { t } from '../i18n';
import { HelpTip } from './HelpTip';
import { IconAlert, IconCheck, IconSpinner, IconX } from './Icons';

const who = (r: string) => (r === FLASH_MCP_ROLE ? 'Flash' : roleName(r));

/** Who may use one server: a toggle chip each for the Orchestrator, the five roles and Flash (reading tools only).
 *  `onToggle` saves at once on a card; in the add form it only changes the form. A role narrowed on its agent card to
 *  «solo lettura» or chosen tools shows as on, marked partial. */
export function RoleAccessChips({ value, partial = [], onToggle, label, disabled }: { value: Record<string, boolean>; partial?: readonly string[]; onToggle: (role: string, on: boolean) => void; label: string; disabled?: boolean }) {
  return <div className="mcp-roles" role="group" aria-label={label}>
    {MCP_ACCESS_ROLES.map(r => <button key={r} type="button" className="mcp-role" aria-pressed={value[r] === true} data-partial={partial.includes(r) || undefined} disabled={disabled}
      title={r === FLASH_MCP_ROLE ? t('mcpadd.flashTip') : partial.includes(r) ? t('mcpadd.partialTip') : undefined} data-testid={`mcp-role-${r}`} onClick={() => onToggle(r, value[r] !== true)}>
      <i aria-hidden="true">{value[r] ? <IconCheck size={11} /> : null}</i>{who(r)}{r === FLASH_MCP_ROLE && <small>{t('mcpadd.readOnly')}</small>}
    </button>)}
  </div>;
}

/** The chips of a saved server, saved at once (mcpservers:setAccess). */
export function ServerRoles({ server, state, onState }: { server: string; state: McpServersState; onState: (s: McpServersState) => void }) {
  const [busy, setBusy] = useState(false);
  const value = Object.fromEntries(MCP_ACCESS_ROLES.map(r => [r, accessOn(r, state.access[r]?.servers[server])]));
  const partial = MCP_ACCESS_ROLES.filter(r => { const a = state.access[r]?.servers[server]; return a !== undefined && a !== 'none' && a !== 'all' && !(r === FLASH_MCP_ROLE && a === 'read'); });
  const toggle = async (role: string, on: boolean) => {
    setBusy(true);
    try { onState(await window.sb.invoke('mcpservers:setAccess', { role, server, access: toggleAccess(role, on) })); } finally { setBusy(false); }
  };
  return <RoleAccessChips value={value} partial={partial} disabled={busy} label={t('mcpadd.who')} onToggle={(r, on) => void toggle(r, on)} />;
}

type Phase = { kind: 'form' } | { kind: 'saving' } | { kind: 'result'; id: string; test: McpTestResult | null };

export function McpAddPanel({ onDone, initial }: { onDone: (s?: McpServersState) => void; initial?: { def: McpServerDef; tokens: string[] } | null }) {
  const [paste, setPaste] = useState(''), [pick, setPick] = useState(0);
  const [f, setF] = useState<AddForm>(() => (initial ? addFormOf({ def: initial.def }) : emptyAddForm()));
  const [phase, setPhase] = useState<Phase>({ kind: 'form' }), [error, setError] = useState(''), [saved, setSaved] = useState<string | null>(null);
  const [from, setFrom] = useState<string>(initial ? 'agent' : '');
  const parsed = useMemo(() => (paste.trim() ? parseMcpSnippet(paste) : null), [paste]);
  const pasteId = useId();
  const typed = f.tokens.some(x => x.value) || !!paste;
  useEffect(() => (typed ? holdUpdate(t('hub.token')) : undefined), [typed]);
  const fill = (d: McpDraft, source: string) => { setF(x => ({ ...addFormOf(d), roles: x.roles })); setFrom(source); setError(''); };
  // a paste fills the form at once (the first server of a JSON with several; the chips pick another)
  useEffect(() => { if (parsed?.ok) fill(parsed.drafts[Math.min(pick, parsed.drafts.length - 1)]!, parsed.kind); }, [parsed, pick]);
  const set = <K extends keyof AddForm>(k: K, v: AddForm[K]) => setF(x => ({ ...x, [k]: v }));
  const def = defOfAdd(f, saved ?? undefined);
  const missing = f.tokens.filter(x => x.name && !x.value).map(x => x.name);
  const save = async () => {
    if (!def) { setError(t('mcpadd.badLine')); return; }
    setPhase({ kind: 'saving' }); setError('');
    try {
      let st = await window.sb.invoke('mcpservers:save', { def, ...(saved ? { previousId: saved } : {}) });
      const id = def.id;
      setSaved(id);
      for (const tok of f.tokens) if (tok.name && tok.value) st = await window.sb.invoke('mcpservers:setSecret', { id, slot: `${def.transport === 'stdio' ? 'env' : 'header'}:${tok.name}`, value: tok.value });
      // the typed tokens are in the secret store now: out of this panel's memory
      setF(x => ({ ...x, tokens: x.tokens.map(k => ({ ...k, value: '' })) }));
      setPaste('');
      for (const r of MCP_ACCESS_ROLES) {
        const want = f.roles[r] === true;
        if (want !== accessOn(r, st.access[r]?.servers[id]) || (want && JSON.stringify(toggleAccess(r, true)) !== JSON.stringify(st.access[r]?.servers[id] ?? defaultAccess(r)))) st = await window.sb.invoke('mcpservers:setAccess', { role: r, server: id, access: toggleAccess(r, want) });
      }
      const after = st.servers.find(s => s.id === id);
      const needs = after ? Object.values(after.secretMasks).some(m => m === null) : false;
      st = needs ? st : await window.sb.invoke('mcpservers:test', { id });
      setPhase({ kind: 'result', id, test: needs ? null : st.servers.find(s => s.id === id)?.lastTest ?? null });
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : t('hub.error'));
      setPhase({ kind: 'form' });
    }
  };
  if (phase.kind === 'result') {
    const r = phase.test, tools = r?.tools ?? [], reading = tools.filter(x => x.readOnly).length;
    return <section className="mcp-add" aria-label={t('mcpadd.title')} data-testid="mcp-add">
      <div className={`mcp-result ${r?.ok ? 'ok' : r ? 'bad' : 'wait'}`} role="status" data-testid="mcp-add-result">
        <span className="mcp-result-mark" aria-hidden="true">{r?.ok ? <IconCheck size={16} /> : <IconAlert size={16} />}</span>
        <div>
          <b>{r?.ok ? t('mcpadd.works', { n: tools.length }) : r ? r.error?.message ?? t('hub.status.failed') : t('mcpadd.savedNeedsToken')}</b>
          <p>{r?.ok ? t('hub.toolsSplit', { r: reading, w: tools.length - reading }) : r ? <><span>{t('hub.fix')}</span> {r.error?.fix}</> : t('mcpadd.savedNeedsTokenHint')}</p>
        </div>
      </div>
      <footer className="mcp-add-foot">
        <button type="button" className="btn btn-primary btn-m" onClick={() => onDone()} data-testid="mcp-add-done">{t('mcpadd.done')}</button>
        {!r?.ok && <button type="button" className="btn btn-ghost btn-m" onClick={() => setPhase({ kind: 'form' })}>{t('hub.edit')}</button>}
      </footer>
    </section>;
  }
  const busy = phase.kind === 'saving';
  return <section className="mcp-add" aria-label={t('mcpadd.title')} data-testid="mcp-add">
    <header className="mcp-add-head">
      <div><h4>{t('mcpadd.title')}</h4><p>{t('mcpadd.lead')}</p></div>
      <button type="button" className="mcp-x" aria-label={t('hub.cancel')} onClick={() => onDone()}><IconX size={14} /></button>
    </header>
    <div className="mcp-paste">
      <label htmlFor={pasteId}>{t('mcpadd.pasteLabel')}</label>
      <textarea id={pasteId} className="st-input mono" rows={4} spellCheck={false} value={paste} placeholder={t('mcpadd.pastePlaceholder')} data-testid="mcp-paste" onChange={e => { setPaste(e.target.value); setPick(0); }} />
      {parsed && <p className={`mcp-paste-status ${parsed.ok ? 'ok' : 'bad'}`} role="status" data-testid="mcp-paste-status">
        {parsed.ok ? <><IconCheck size={12} />{t(`mcpadd.read.${parsed.kind}`, { n: parsed.drafts.length })}{Object.keys(parsed.drafts[pick]?.values ?? {}).length > 0 && <> · {t('mcpadd.tokensMoved')}</>}</> : <><IconAlert size={12} />{t(`mcpadd.err.${parsed.error}`)}</>}
      </p>}
      {parsed?.ok && parsed.drafts.length > 1 && <div className="mcp-picks" role="group" aria-label={t('mcpadd.which')}>{parsed.drafts.map((d, i) => <button key={d.def.id} type="button" className="mcp-pick" aria-pressed={i === pick} onClick={() => setPick(i)}>{d.def.label}</button>)}</div>}
      {parsed?.ok && (parsed.drafts[pick]?.dropped.length ?? 0) > 0 && <p className="hub-muted">{t('hub.importDropped', { list: parsed.drafts[pick]!.dropped.join(', ') })}</p>}
    </div>
    <div className="mcp-catalog">
      <span className="mcp-catalog-label">{t('mcpadd.popular')}</span>
      <div className="mcp-catalog-list">{MCP_CATALOG.map(e => <button key={e.id} type="button" className="mcp-cat" aria-pressed={from === `cat:${e.id}`} data-testid={`mcp-cat-${e.id}`}
        onClick={() => { const d = catalogDraft(e, e.ask?.placeholder ?? ''); if (d) { setPaste(''); fill(d, `cat:${e.id}`); } }}>
        <b>{e.label}</b><small>{t(`mcpadd.cat.${e.id}` as 'mcpadd.cat.fetch')}</small></button>)}</div>
      {from.startsWith('cat:') && MCP_CATALOG.find(e => `cat:${e.id}` === from)?.ask && <p className="hub-muted">{t('mcpadd.askHint', { value: MCP_CATALOG.find(e => `cat:${e.id}` === from)!.ask!.placeholder })}</p>}
      {from === 'agent' && <p className="mcp-agent-note" role="note">{t('mcpadd.fromAgent')}</p>}
    </div>
    <div className="mcp-form">
      <div className="mcp-form-row">
        <Field label={t('hub.f.label')}>{id => <input id={id} className="st-input" value={f.label} placeholder="GitHub" onChange={e => set('label', e.target.value)} data-testid="mcp-f-label" />}</Field>
        <div className="mcp-field"><span>{t('hub.f.transport')}</span>
          <div className="st-seg" role="radiogroup" aria-label={t('hub.f.transport')}>{(['stdio', 'http'] as const).map(v => <button key={v} type="button" role="radio" aria-checked={f.transport === v} className={f.transport === v ? 'on' : ''} onClick={() => setF(x => ({ ...x, transport: v, tokens: x.tokens.map(k => ({ ...k, ...(v === 'http' && /^authorization$/i.test(k.name) ? { prefix: 'Bearer ' } : {}) })) }))}>{t(v === 'stdio' ? 'hub.kind.stdio' : 'hub.kind.http')}</button>)}</div>
        </div>
      </div>
      {f.transport === 'stdio'
        ? <Field label={t('mcpadd.line')} tip={t('mcpadd.lineTip')}>{id => <input id={id} className="st-input mono" value={f.line} placeholder="npx -y @modelcontextprotocol/server-memory" spellCheck={false} onChange={e => set('line', e.target.value)} data-testid="mcp-f-line" />}</Field>
        : <Field label={t('hub.f.url')} tip={t('hub.f.urlTip')}>{id => <input id={id} className="st-input mono" value={f.url} placeholder="https://example.com/mcp" spellCheck={false} onChange={e => set('url', e.target.value)} data-testid="mcp-f-url" />}</Field>}
      <details className="mcp-more" open={!!(f.transport === 'stdio' ? f.env : f.headers)}>
        <summary>{t(f.transport === 'stdio' ? 'hub.f.env' : 'hub.f.headers')}</summary>
        <Field label={t(f.transport === 'stdio' ? 'hub.f.env' : 'hub.f.headers')} tip={t('hub.f.envTip')}>{id => <textarea id={id} className="st-input mono" rows={2} spellCheck={false} value={f.transport === 'stdio' ? f.env : f.headers} placeholder={f.transport === 'stdio' ? 'ORG=contoso' : 'X-Team: web'} onChange={e => set(f.transport === 'stdio' ? 'env' : 'headers', e.target.value)} />}</Field>
      </details>
      <div className="mcp-tokens" data-testid="mcp-tokens">
        <span className="mcp-tokens-head">{t('mcpadd.tokens')}<HelpTip title={t('hub.token')} label={t('hub.token')}>{t('mcpadd.tokensTip')}</HelpTip></span>
        {f.tokens.map((tok, i) => <div className="mcp-token" key={i}>
          <input className="st-input mono" aria-label={t('mcpadd.tokenName')} value={tok.name} placeholder={f.transport === 'stdio' ? 'GITHUB_TOKEN' : 'Authorization'} spellCheck={false} onChange={e => set('tokens', f.tokens.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <input className="st-input mono" type="password" autoComplete="off" spellCheck={false} aria-label={t('hub.tokenFor', { name: tok.name || '…' })} value={tok.value} placeholder={t('mcpadd.tokenValue')} data-testid={`mcp-token-${i}`} onChange={e => set('tokens', f.tokens.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
          <button type="button" className="mcp-x" aria-label={t('hub.deleteToken')} onClick={() => set('tokens', f.tokens.filter((_, j) => j !== i))}><IconX size={12} /></button>
        </div>)}
        {f.tokens.length < 4 && <button type="button" className="btn btn-subtle btn-s" onClick={() => set('tokens', [...f.tokens, { name: '', value: '', ...(f.transport === 'http' ? { prefix: 'Bearer ' } : {}) }])}>{t('mcpadd.addToken')}</button>}
      </div>
      <Field label={t('hub.f.purpose')}>{id => <input id={id} className="st-input" value={f.purpose} placeholder={t('hub.f.purposeHint')} onChange={e => set('purpose', e.target.value)} />}</Field>
      <div className="mcp-field"><span>{t('mcpadd.who')}<HelpTip title={t('mcpadd.who')} label={t('mcpadd.who')}>{t('mcpadd.whoTip')}</HelpTip></span>
        <RoleAccessChips value={f.roles} label={t('mcpadd.who')} onToggle={(r, on) => set('roles', { ...f.roles, [r]: on })} />
      </div>
    </div>
    {error && <p role="alert" className="hub-problem" data-testid="mcp-add-error"><b>{error}</b></p>}
    <footer className="mcp-add-foot">
      <button type="button" className="btn btn-primary btn-m" disabled={busy || !f.label.trim() || !def} onClick={() => void save()} data-testid="mcp-add-save">{busy ? <><IconSpinner size={14} />{t('hub.testing')}</> : missing.length ? t('mcpadd.saveOnly') : t('mcpadd.saveTest')}</button>
      <button type="button" className="btn btn-ghost btn-m" disabled={busy} onClick={() => onDone()}>{t('hub.cancel')}</button>
      {missing.length > 0 && <small className="hub-muted">{t('mcpadd.missing', { list: missing.join(', ') })}</small>}
    </footer>
  </section>;
}

/** A form field: its label (never wrapping the "?", which is a button of its own) and its control. */
function Field({ label, tip, children }: { label: string; tip?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return <div className="mcp-field"><span><label htmlFor={id}>{label}</label>{tip && <HelpTip title={label} label={label}>{tip}</HelpTip>}</span>{children(id)}</div>;
}
