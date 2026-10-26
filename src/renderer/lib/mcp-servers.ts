// The app-managed MCP servers in the UI (ADR 0086): one shared state read over IPC (mcpservers:state) and kept fresh by
// mcpservers:changed, plus the pure readings the cards show: a server's state (works, not tried, token missing, error,
// off), how many roles may use it, the hub's totals, and the form's text fields to a definition and back. Used by
// ConnectorsHub (Settings → Connettori) and AgentMcpSection (the agent card's MCP section); pure parts tested in node.
import { useEffect, useState } from 'react';
import type { McpServerDef, McpServerView, McpServersState, McpToolAccess } from '@shared/mcp-servers';
import { idFrom, serverOffered, toolAllowed } from '@shared/mcp-servers';
import { ROLE_IDS } from '@shared/roles';

export type ServerStatus = 'ok' | 'untested' | 'missing' | 'failed' | 'off';

export function serverStatus(s: McpServerView): ServerStatus {
  if (!s.enabled) return 'off';
  if (Object.values(s.secretMasks).some(m => m === null)) return 'missing';
  if (!s.lastTest) return 'untested';
  return s.lastTest.ok ? 'ok' : 'failed';
}

/** The roles that may use at least one of the server's tools (by their card; the role's tool classes aside). */
export function rolesWith(state: McpServersState, id: string): string[] {
  return ROLE_IDS.filter(r => serverOffered(state.access[r]?.servers[id]));
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
  tokenName: string; tokenPrefix: string; purpose: string; enabled: boolean; routineTest: boolean;
}
export const emptyForm = (): ServerForm => ({ label: '', transport: 'stdio', command: '', args: '', env: '', url: '', headers: '', tokenName: '', tokenPrefix: 'Bearer ', purpose: '', enabled: true, routineTest: false });

export function formOf(s: McpServerDef): ServerForm {
  const slot = s.secrets[0];
  return {
    label: s.label, transport: s.transport, command: s.command ?? '', args: (s.args ?? []).join('\n'),
    env: Object.entries(s.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n'), url: s.url ?? '',
    headers: Object.entries(s.headers ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n'),
    tokenName: slot?.name ?? '', tokenPrefix: slot?.prefix ?? (s.transport === 'http' ? 'Bearer ' : ''), purpose: s.purpose ?? '', enabled: s.enabled, routineTest: s.routineTest === true,
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
  const common = { id: base?.id ?? idFrom(f.label), label: f.label.trim(), transport: f.transport, secrets: [...slot, ...others], enabled: f.enabled, ...(f.routineTest ? { routineTest: true as const } : {}),
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
