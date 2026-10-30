// The app-managed MCP servers in the UI (ADR 0086): one shared state read over IPC (mcpservers:state) and kept fresh by
// mcpservers:changed, plus the pure readings the cards show: a server's state (works, not tried, token missing, error,
// off), how many roles may use it, the hub's totals, and the form's text fields to a definition and back; the add
// panel's form (ADR 0207: one command line, masked tokens, who uses it) and the drafts the Orchestrator opens there
// (app_config form → ui:command mcpDraft). Used by ConnectorsHub (Settings → Connettori), McpAddPanel and
// AgentMcpSection (the agent card's MCP section); pure parts tested in node.
import { useEffect, useState } from 'react';
import type { McpServerDef, McpServerView, McpServersState, McpToolAccess } from '@shared/mcp-servers';
import { MCP_ACCESS_ROLES, accessOn, idFrom, toolAllowed } from '@shared/mcp-servers';
import { shellWords, type McpDraft } from '@shared/mcp-paste';

export type ServerStatus = 'ok' | 'untested' | 'missing' | 'failed' | 'off';

export function serverStatus(s: McpServerView): ServerStatus {
  if (!s.enabled) return 'off';
  if (Object.values(s.secretMasks).some(m => m === null)) return 'missing';
  if (!s.lastTest) return 'untested';
  return s.lastTest.ok ? 'ok' : 'failed';
}

/** The roles (and Flash) that may use at least one of the server's tools (by their card; the role's tool classes aside). */
export function rolesWith(state: McpServersState, id: string): string[] {
  return MCP_ACCESS_ROLES.filter(r => accessOn(r, state.access[r]?.servers[id]));
}

/** Tools of the last test that this access lets through. */
export function toolsAllowed(s: McpServerView, access: McpToolAccess | undefined): number {
  return (s.lastTest?.tools ?? []).filter(t => toolAllowed(access, t)).length;
}

export interface HubTotals { working: number; toFix: number; total: number; tools: number; reading: number }
/** The hub's numbers: working = connectors verified + servers whose last test passed; to fix = failed, token missing;
 *  tools = the tools of the working servers, reading = those the server marks read-only. */
export function hubTotals(servers: readonly McpServerView[], connectors: readonly { status: string }[]): HubTotals {
  const st = servers.map(serverStatus);
  const live = servers.filter((_, i) => st[i] === 'ok');
  return {
    working: connectors.filter(c => c.status === 'verified').length + live.length,
    toFix: connectors.filter(c => c.status === 'failed').length + st.filter(x => x === 'failed' || x === 'missing').length,
    total: connectors.length + servers.length,
    tools: live.reduce((n, s) => n + (s.lastTest?.tools.length ?? 0), 0),
    reading: live.reduce((n, s) => n + (s.lastTest?.tools.filter(t => t.readOnly).length ?? 0), 0),
  };
}

/** What the add/edit form holds: plain text fields, turned into a definition only on save. */
export interface ServerForm {
  label: string; transport: 'stdio' | 'http'; command: string; args: string; env: string; url: string; headers: string;
  tokenName: string; tokenPrefix: string; purpose: string; enabled: boolean;
}
export const emptyForm = (): ServerForm => ({ label: '', transport: 'stdio', command: '', args: '', env: '', url: '', headers: '', tokenName: '', tokenPrefix: 'Bearer ', purpose: '', enabled: true });

export function formOf(s: McpServerDef): ServerForm {
  const slot = s.secrets[0];
  return {
    label: s.label, transport: s.transport, command: s.command ?? '', args: (s.args ?? []).join('\n'),
    env: Object.entries(s.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n'), url: s.url ?? '',
    headers: Object.entries(s.headers ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n'),
    tokenName: slot?.name ?? '', tokenPrefix: slot?.prefix ?? (s.transport === 'http' ? 'Bearer ' : ''), purpose: s.purpose ?? '', enabled: s.enabled,
  };
}

const lines = (text: string): string[] => text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
const pairs = (text: string, sep: RegExp): Record<string, string> => Object.fromEntries(lines(text).map(l => { const m = sep.exec(l); return m ? [l.slice(0, m.index).trim(), l.slice(m.index + m[0].length).trim()] : [l, '']; }));

/** The form → a definition for mcpservers:save (main validates it again). `base` keeps an edited server's id, extra
 *  secret slots (from an import) and origin. */
export function defOf(f: ServerForm, base?: McpServerDef): McpServerDef {
  const name = f.tokenName.trim();
  const slot = name ? [{ where: f.transport === 'stdio' ? 'env' as const : 'header' as const, name, ...(f.transport === 'http' && f.tokenPrefix ? { prefix: f.tokenPrefix } : {}) }] : [];
  const others = (base?.secrets ?? []).slice(1).filter(s => s.where === (f.transport === 'stdio' ? 'env' : 'header'));
  const common = { id: base?.id ?? idFrom(f.label), label: f.label.trim(), transport: f.transport, secrets: [...slot, ...others], enabled: f.enabled,
    ...(f.purpose.trim() ? { purpose: f.purpose.trim() } : {}), ...(base?.importedFrom ? { importedFrom: base.importedFrom } : {}) };
  if (f.transport === 'stdio') {
    const env = pairs(f.env, /=/);
    return { ...common, command: f.command.trim(), args: lines(f.args), ...(Object.keys(env).length ? { env } : {}) };
  }
  const headers = pairs(f.headers, /:/);
  return { ...common, url: f.url.trim(), ...(Object.keys(headers).length ? { headers } : {}) };
}

/** "npx -y @azure-devops/mcp" or "api.githubcopilot.com": how the server starts, short. */
export function runsAs(s: McpServerDef): string {
  if (s.transport === 'http') { try { const u = new URL(s.url ?? ''); return u.host + (u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '')); } catch { return s.url ?? ''; } }
  return [s.command, ...(s.args ?? [])].join(' ');
}

/** Two letters for the card's mark. */
export const monogram = (label: string): string => {
  const words = label.trim().split(/[\s._-]+/).filter(Boolean);
  return ((words[0]?.[0] ?? '?') + (words[1]?.[0] ?? words[0]?.[1] ?? '')).toUpperCase();
};

// one shared copy for every card and section on screen
let cache: McpServersState | null = null;
const listeners = new Set<(s: McpServersState) => void>();
let subscribed = false;
const publish = (s: McpServersState) => { cache = s; for (const l of listeners) l(s); };

export function useMcpServers(): { state: McpServersState | null; error: boolean; set: (s: McpServersState) => void } {
  const [state, setState] = useState<McpServersState | null>(cache);
  const [error, setError] = useState(false);
  useEffect(() => {
    listeners.add(setState);
    if (!subscribed) { subscribed = true; window.sb.on('mcpservers:changed', publish); }
    void window.sb.invoke('mcpservers:state', undefined).then(publish, () => setError(true));
    return () => { listeners.delete(setState); };
  }, []);
  return { state, error, set: publish };
}

/** A command and its arguments as one line, quoting what needs it ("C:\\My files" keeps its space). */
export function commandLine(command: string, args: readonly string[]): string {
  return [command, ...args].filter(w => w !== '').map(w => (/[\s"']/.test(w) || w === '' ? `"${w.replace(/"/g, '\\"')}"` : w)).join(' ');
}

/** The add panel's form (McpAddPanel.tsx, ADR 0207): the command as one line, tokens with their typed value (kept only
 *  in the panel until saved to the secret store), who may use the server. */
export interface AddForm {
  label: string; transport: 'stdio' | 'http'; line: string; url: string; env: string; headers: string; purpose: string;
  tokens: { name: string; prefix?: string; value: string }[]; roles: Record<string, boolean>;
}
export const defaultRoles = (): Record<string, boolean> => Object.fromEntries(MCP_ACCESS_ROLES.map(r => [r, accessOn(r, undefined)]));
export const emptyAddForm = (): AddForm => ({ label: '', transport: 'stdio', line: '', url: '', env: '', headers: '', purpose: '', tokens: [], roles: defaultRoles() });

export function addFormOf(d: Pick<McpDraft, 'def'> & { values?: Record<string, string> }): AddForm {
  const f = d.def;
  return {
    label: f.label, transport: f.transport, line: f.transport === 'stdio' ? commandLine(f.command ?? '', f.args ?? []) : '', url: f.url ?? '',
    env: Object.entries(f.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n'), headers: Object.entries(f.headers ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n'),
    purpose: f.purpose ?? '', tokens: f.secrets.map(s => ({ name: s.name, ...(s.prefix ? { prefix: s.prefix } : {}), value: d.values?.[`${s.where}:${s.name}`] ?? '' })), roles: defaultRoles(),
  };
}

/** The add form → a definition for mcpservers:save (main validates it again); null when the command line cannot be read. */
export function defOfAdd(f: AddForm, id?: string): McpServerDef | null {
  const where = f.transport === 'stdio' ? 'env' as const : 'header' as const;
  const secrets = f.tokens.filter(x => x.name.trim()).map(x => ({ where, name: x.name.trim(), ...(where === 'header' && x.prefix ? { prefix: x.prefix } : {}) }));
  const common = { id: id ?? idFrom(f.label), label: f.label.trim(), transport: f.transport, secrets, enabled: true, ...(f.purpose.trim() ? { purpose: f.purpose.trim() } : {}) };
  if (f.transport === 'stdio') {
    const words = shellWords(f.line.trim());
    if (!words?.length) return null;
    const env = pairs(f.env, /=/);
    return { ...common, command: words[0]!, args: words.slice(1), ...(Object.keys(env).length ? { env } : {}) };
  }
  const headers = pairs(f.headers, /:/);
  return { ...common, url: f.url.trim(), ...(Object.keys(headers).length ? { headers } : {}) };
}

// a draft the Orchestrator opened for the user (app_config form): waits here until Settings → Connettori takes it
let pendingDraft: { def: McpServerDef; tokens: string[] } | null = null;
const draftListeners = new Set<() => void>();
export function openMcpDraft(json: string): boolean {
  try {
    const d = JSON.parse(json) as { def?: McpServerDef; tokens?: string[] };
    if (!d.def || typeof d.def !== 'object' || (d.def.transport !== 'stdio' && d.def.transport !== 'http')) return false;
    pendingDraft = { def: { ...d.def, secrets: Array.isArray(d.def.secrets) ? d.def.secrets : [] }, tokens: Array.isArray(d.tokens) ? d.tokens : [] };
    for (const l of draftListeners) l();
    return true;
  } catch { return false; }
}
export const takeMcpDraft = (): { def: McpServerDef; tokens: string[] } | null => { const d = pendingDraft; pendingDraft = null; return d; };
export function onMcpDraft(fn: () => void): () => void { draftListeners.add(fn); return () => { draftListeners.delete(fn); }; }
