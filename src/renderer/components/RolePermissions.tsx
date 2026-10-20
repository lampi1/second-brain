// A role's permissions card (Brain → Agenti → a role, under its numbers; ADR 0085): what the role may do, as clear
// toggles per tool class (grouped "Leggere" / "Agire", a narrower class shown under the wider one that includes it) and
// the permission ceiling as four choices, each with the app's "?" (HelpTip) saying what it allows. By default every
// role has every permission («Tutto consentito»); the user narrows it here, saves it as a new version of the role
// (agents:save, the same versioning as every role edit) or goes back to the defaults ("Ripristina predefiniti").
// Running chats keep the permissions they started with. The card is a list of sections (PERMISSION_SECTIONS): another
// part of a role's permissions (e.g. its MCP servers) appends a section there and edits the same draft. Rendered by
// AgentStudio.tsx; the card back of AgentCatalogCard links here (element "permessi"). Styles: styles/role-permissions.css.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PERMISSION_CEILINGS, TOOL_CLASSES, type AgentProfile, type AgentToolPolicy, type PermissionCeiling, type ToolClass } from '@shared/agents';
import { ALL_TOOLS, ROLE_DEFAULTS, defaultPermissions, isRoleId } from '@shared/roles';
import { saveAgent, useAgents } from '../store/agents';
import { toast, ui } from '../store/ui';
import { agentDraftOf } from '../lib/agent-drafts';
import { AgentMcpSection } from './AgentMcpSection';
import { t } from '../i18n';
import { HelpTip } from './HelpTip';
import '../styles/role-permissions.css';

/** What the permissions card edits: the role's tool policy and its ceiling (one save, one version). */
export interface PermissionDraft { tools: AgentToolPolicy | null; permissionCeiling: PermissionCeiling | null }
export interface PermissionSectionProps { profile: AgentProfile; draft: PermissionDraft; change: (patch: Partial<PermissionDraft>) => void; disabled: boolean }
/** One section of the card: a title with its "?", and its controls over the shared draft. */
export interface PermissionSection { id: string; title: () => string; hint: () => string; render: (p: PermissionSectionProps) => ReactNode }

/** The element id the card back's "Modifica permessi" goes to (actions.ts go → highlight). */
export const PERMISSIONS_ELEMENT = 'permessi';
const reason = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

/** The narrower class a wider one includes (tool-policy.ts INCLUDED_BY): shown under it, on while the wider is on. */
const NARROWER: Partial<Record<ToolClass, ToolClass>> = { shell: 'shell-read', browser: 'browser-read', edit: 'brain-write' };
const WIDER: Partial<Record<ToolClass, ToolClass>> = { 'shell-read': 'shell', 'browser-read': 'browser', 'brain-write': 'edit' };
const GROUPS: { id: 'read' | 'act'; classes: ToolClass[] }[] = [
  { id: 'read', classes: ['read', 'web', 'calendar-read'] },
  { id: 'act', classes: ['edit', 'shell', 'browser', 'mail-draft', 'mcp'] },
];

function Toggle({ on, label, disabled, onChange, testid }: { on: boolean; label: string; disabled: boolean; onChange: (on: boolean) => void; testid: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`rp-switch${on ? ' on' : ''}`} onClick={() => onChange(!on)} data-testid={testid}>
    <span className="rp-knob" aria-hidden="true" /></button>;
}

function ToolRow({ c, allow, disabled, toggle, narrow }: { c: ToolClass; allow: readonly ToolClass[]; disabled: boolean; toggle: (c: ToolClass, on: boolean) => void; narrow?: boolean }) {
  const wider = WIDER[c], included = !!wider && allow.includes(wider), on = allow.includes(c) || included;
  const name = t(`studio.tool.${c}`);
  const example = c === 'shell-read' ? t('perm.tool.shell-read.example') : undefined;
  return <div className={`rp-tool${narrow ? ' rp-tool-narrow' : ''}`} data-on={on} data-testid={`perm-tool-${c}`}>
    <div className="rp-tool-id">
      <span className="rp-tool-name">{name}</span>
      <HelpTip title={name} label={name} {...(example ? { example } : {})} testid={`perm-help-${c}`}>{t(`perm.tool.${c}`)}</HelpTip>
      {included && <small className="rp-included">{t('perm.includedIn', { wider: t(`studio.tool.${wider!}`) })}</small>}
    </div>
    <Toggle on={on} label={`${name}: ${on ? t('perm.on') : t('perm.off')}`} disabled={disabled || included} onChange={v => toggle(c, v)} testid={`perm-toggle-${c}`} />
  </div>;
}

const toolsSection: PermissionSection = {
  id: 'tools', title: () => t('perm.sec.tools'), hint: () => t('perm.sec.tools.hint'),
  render: ({ draft, change, disabled }) => {
    const allow = draft.tools?.allow ?? [...ALL_TOOLS];
    const toggle = (c: ToolClass, on: boolean) => {
      const next = on ? TOOL_CLASSES.filter(x => x === c || allow.includes(x)) : allow.filter(x => x !== c);
      // a named MCP list needs the mcp class (tool-policy.ts checkedTools): off with it
      const mcp = draft.tools?.mcp && next.includes('mcp') ? { mcp: draft.tools.mcp } : {};
      change({ tools: { allow: next, ...mcp } });
    };
    return <div className="rp-groups">{GROUPS.map(g => <section key={g.id} className="rp-group" aria-label={t(`perm.group.${g.id}`)}>
      <h5>{t(`perm.group.${g.id}`)}</h5>
      {g.classes.map(c => <div key={c} className="rp-tool-wrap">
        <ToolRow c={c} allow={allow} disabled={disabled} toggle={toggle} />
        {NARROWER[c] && <ToolRow c={NARROWER[c]!} allow={allow} disabled={disabled} toggle={toggle} narrow />}
      </div>)}
    </section>)}</div>;
  },
};

const CEILINGS: (PermissionCeiling | null)[] = [null, ...[...PERMISSION_CEILINGS].reverse()];
const ceilingSection: PermissionSection = {
  id: 'ceiling', title: () => t('perm.sec.ceiling'), hint: () => t('perm.sec.ceiling.hint'),
  render: ({ draft, change, disabled, profile }) => <div className="rp-ceilings" role="radiogroup" aria-label={t('perm.sec.ceiling')}>
    {CEILINGS.map(c => {
      const key = c ?? 'none', name = c ? t(`studio.ceiling.${c}`) : t('perm.ceiling.none'), on = draft.permissionCeiling === c;
      return <label key={key} className="rp-ceiling" data-on={on} data-testid={`perm-ceiling-${key}`}>
        <input type="radio" name={`ceiling-${profile.id}`} checked={on} disabled={disabled} onChange={() => change({ permissionCeiling: c })} />
        <span className="rp-ceiling-name">{name}{c === null && <em>{t('perm.ceiling.none.badge')}</em>}</span>
        <HelpTip title={name} label={name} testid={`perm-help-ceiling-${key}`}>{t(`perm.ceiling.${key}.help`)}</HelpTip>
      </label>;
    })}
  </div>,
};

/** The card's sections, in order. Append a section to give a role another permission to edit (it edits the same draft). */
/** The MCP servers the role may use (AgentMcpSection, ADR 0086): saved at once per server, not with the draft; it
 *  follows the "Server MCP" toggle above (off: no server reaches the role). */
const mcpSection: PermissionSection = {
  id: 'mcp', title: () => t('agentMcp.title'), hint: () => t('perm.sec.mcp.hint'),
  render: ({ profile, draft }) => <AgentMcpSection embedded roleId={profile.id} roleName={profile.name} mcpClass={(draft.tools?.allow ?? ALL_TOOLS).includes('mcp')} />,
};

export const PERMISSION_SECTIONS: PermissionSection[] = [toolsSection, ceilingSection, mcpSection];

const draftOf = (p: AgentProfile): PermissionDraft => ({ tools: p.tools ? structuredClone(p.tools) : null, permissionCeiling: p.permissionCeiling });
const sameDraft = (a: PermissionDraft, b: PermissionDraft) => JSON.stringify(a) === JSON.stringify(b);
/** «Tutto consentito», or how far the role is narrowed: tools allowed (a narrower class covered by its wider one counts). */
export function permissionSummary(p: Pick<AgentProfile, 'id' | 'tools' | 'permissionCeiling'>): { full: boolean; text: string } {
  if (isRoleId(p.id) && defaultPermissions(p.id, p.tools, p.permissionCeiling)) return { full: true, text: t('perm.all') };
  const allow = p.tools?.allow ?? ALL_TOOLS;
  const n = TOOL_CLASSES.filter(c => allow.includes(c) || (WIDER[c] && allow.includes(WIDER[c]!))).length;
  const parts = [t('perm.narrowed', { n, total: TOOL_CLASSES.length }), ...(p.permissionCeiling ? [t('perm.narrowedCeiling', { ceiling: t(`studio.ceiling.${p.permissionCeiling}`) })] : [])];
  return { full: false, text: parts.join(' · ') };
}

export function RolePermissions({ profile }: { profile: AgentProfile }) {
  const { catalog } = useAgents();
  const [draft, setDraft] = useState<PermissionDraft>(() => draftOf(profile));
  const [base, setBase] = useState(profile.updatedAt);
  const [busy, setBusy] = useState(false), [problem, setProblem] = useState<string | null>(null);
  const card = useRef<HTMLElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const saved = draftOf(profile);
  const dirty = !sameDraft(draft, saved);
  const stale = dirty && profile.updatedAt !== base;
  // the role changed elsewhere (a version restored, a reset) and nothing is pending here: follow it
  useEffect(() => { if (!dirty) { setDraft(draftOf(profile)); setBase(profile.updatedAt); } }, [profile.updatedAt]);
  // the card back's "Modifica permessi" lands here
  const hl = ui.use(s => s.highlight);
  useEffect(() => {
    if (hl?.id !== PERMISSIONS_ELEMENT) return;
    card.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    heading.current?.focus({ preventScroll: true });
  }, [hl?.n]);
  const defaults = isRoleId(profile.id) ? { tools: { allow: [...ROLE_DEFAULTS[profile.id].tools] }, permissionCeiling: ROLE_DEFAULTS[profile.id].ceiling } : saved;
  const atDefaults = isRoleId(profile.id) && defaultPermissions(profile.id, profile.tools, profile.permissionCeiling);
  const disabled = busy || !!profile.trial || !!catalog?.problem;
  const write = async (next: PermissionDraft, done: string) => {
    setBusy(true); setProblem(null);
    try { await saveAgent({ ...agentDraftOf(profile), ...next }, profile.id); setDraft(next); toast(done, 'ok'); }
    catch (e) { setProblem(t('perm.error', { detail: reason(e) })); }
    finally { setBusy(false); }
  };
  const summary = permissionSummary({ id: profile.id, ...(dirty ? { tools: draft.tools, permissionCeiling: draft.permissionCeiling } : { tools: profile.tools, permissionCeiling: profile.permissionCeiling }) });
  const change = (patch: Partial<PermissionDraft>) => { if (!dirty) setBase(profile.updatedAt); setDraft(d => ({ ...d, ...patch })); };
  return <section ref={card} className="ad-card rp-card" id={PERMISSIONS_ELEMENT} aria-labelledby={`rp-${profile.id}`} data-testid="role-permissions" data-full={summary.full}>
    <header className="rp-head">
      <div className="rp-title">
        <h3 id={`rp-${profile.id}`} ref={heading} tabIndex={-1}>{t('perm.title')}</h3>
        <HelpTip title={t('perm.help.title')} example={t('perm.help.example')} label={t('perm.title')} wide guide="permissions" testid="perm-help">{t('perm.help')}</HelpTip>
        <span className="rp-status" data-full={summary.full} data-testid="perm-status"><i aria-hidden="true" />{summary.text}</span>
        {dirty && <span className="rp-dirty">{t('perm.dirty')}</span>}
      </div>
      <div className="rp-actions">
        <button type="button" className="btn btn-ghost btn-s" disabled={disabled || (atDefaults && !dirty)} title={t('perm.resetHint')} onClick={() => void write(defaults, t('perm.resetDone'))} data-testid="perm-reset">{t('perm.reset')}</button>
        {dirty && <button type="button" className="btn btn-ghost btn-s" disabled={busy} onClick={() => { setDraft(saved); setProblem(null); }} data-testid="perm-cancel">{t('perm.cancel')}</button>}
        {dirty && <button type="button" className="btn btn-primary btn-s" disabled={disabled || stale} onClick={() => void write(draft, t('perm.saved'))} data-testid="perm-save">{t('perm.save')}</button>}
      </div>
    </header>
    {profile.id === 'orchestrator' && <p className="ad-hint">{t('perm.orchestrator')}</p>}
    {profile.trial && <p role="alert" className="studio-alert">{t('perm.trial')}</p>}
    {stale && <div role="alert" className="studio-alert"><p>{t('perm.stale')}</p><div className="studio-alert-actions">
      <button type="button" className="btn btn-ghost btn-s" onClick={() => { setDraft(draftOf(profile)); setBase(profile.updatedAt); }}>{t('perm.reload')}</button></div></div>}
    {problem && <p role="alert" className="studio-alert">{problem}</p>}
    <div className="rp-sections">{PERMISSION_SECTIONS.map(s => <section key={s.id} className="rp-section" aria-labelledby={`rp-${profile.id}-${s.id}`} data-testid={`perm-section-${s.id}`}>
      <header><h4 id={`rp-${profile.id}-${s.id}`}>{s.title()}</h4><p>{s.hint()}</p></header>
      {s.render({ profile, draft, change, disabled })}
    </section>)}</div>
  </section>;
}
