// MCP servers managed by the app (ADR 0086, issue #91): the shapes main and the renderer share, and the pure rules that
// decide which servers and tools a role, and a chat under its parents, may use. Why: one place for every engine instead
// of a copy in Claude's, Cursor's and Codex's own config files. Secrets never appear here: a server lists its secret
// slots (an env variable or a header) and the renderer only ever sees a mask. Used by main/mcp-servers/* (store,
// gateway, service), the Settings → Connettori section and the agent card's MCP section.

import { FLASH_ID, ROLE_IDS } from './roles';

export type McpTransport = 'stdio' | 'http';
/** Where a server's token goes: an environment variable of its process (stdio) or a request header (http). */
export interface McpSecretSlot { where: 'env' | 'header'; name: string; /** for a header: what precedes the token ("Bearer ") */ prefix?: string }
export interface McpServerDef {
  /** the name the engines see (Claude: mcp__<id>__<tool>): lowercase letters, digits and dashes */
  id: string;
  label: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  /** plain (non-secret) environment variables of a stdio server */
  env?: Record<string, string>;
  url?: string;
  /** plain (non-secret) headers of an http server */
  headers?: Record<string, string>;
  secrets: McpSecretSlot[];
  /** what the user uses it for (shown on its card) */
  purpose?: string;
  importedFrom?: McpImportSource;
  /** off: no chat gets it, the test still works */
  enabled: boolean;
  /** User confirmation: this connector account and its targets are restricted to non-production routine work. */
  routineTest?: true;
  /** Added by the Orchestrator, or its command / arguments / variables / address changed by it (ADR 0207): off until
   *  the user's own click «Attiva», which names exactly this `runs` (runsOf); no test before it. */
  awaiting?: { runs: string; at: number };
}
export type McpImportSource = 'claude' | 'cursor' | 'codex';
export interface McpToolInfo { name: string; description: string; /** the server's own readOnlyHint; unknown = writes */ readOnly: boolean }
export type McpErrorCode = 'spawn' | 'timeout' | 'auth' | 'http' | 'protocol' | 'network' | 'secret' | 'invalid';
export interface McpTestResult {
  ok: boolean; at: number; ms: number; tools: McpToolInfo[];
  /** the server's own name and version (initialize) */
  serverInfo?: string;
  error?: { code: McpErrorCode; message: string; fix: string };
}
/** What a role may do with one server: every tool, only the reading ones, none, or the tools named. */
export type McpToolAccess = 'all' | 'read' | 'none' | { tools: string[] };
/** A role's MCP access; a server not listed = 'all' (owner, 2026-10-19: every role has every permission by default). */
export interface RoleMcpAccess { servers: Record<string, McpToolAccess> }
export interface McpServerView extends McpServerDef {
  /** per secret slot (slotKey): its mask, or null when the token is still missing */
  secretMasks: Record<string, string | null>;
  lastTest: McpTestResult | null;
}
export interface McpServersState {
  servers: McpServerView[];
  /** per role id */
  access: Record<string, RoleMcpAccess>;
  /** tokens can be stored (the OS keyring) */
  secretsAvailable: boolean;
  secretsWhy?: string;
}
export interface McpImportCandidate {
  /** stable key for importApply */
  key: string;
  source: McpImportSource;
  /** the config file it was read from (read only, never changed) */
  file: string;
  def: McpServerDef;
  /** secret values seen and NOT imported: the user types them again */
  secretsDropped: string[];
  /** a server with this id is already in the app */
  exists: boolean;
}

/** Names the app keeps for its own servers: no managed server may take them. */
export const RESERVED_IDS: readonly string[] = ['second-brain', 'second-brain-app'];
export const MCP_ID = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const slotKey = (s: McpSecretSlot): string => `${s.where}:${s.name}`;
/** A variable or header name that carries a credential (an imported value under such a name is never copied). */
export const SECRET_NAME = /(token|secret|password|passwd|pass\b|pat\b|_pat|api[_-]?key|apikey|auth|credential|cookie|session|private)/i;
/** A long mix of letters and digits: the shape of a token (a path or an npm scope is never one, see secretLooking). */
export const TOKENISH = /^(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9_\-.=+/:]{24,}$/;
/** A value (an argument, an env value, a header value) that carries a credential: "Bearer …", "Authorization: …",
 *  "X-Api-Key: …", or a token-shaped piece once split on spaces and colons (`--header "Authorization: Bearer <tok>"`,
 *  the mcp-remote pattern; `GH_HEADER="Bearer <tok>"`). A `--flag=value` argument is read by its value too. */
export function secretLooking(value: string): boolean {
  const vals = [value.trim()];
  const eq = /^--?[\w-]+=/.exec(vals[0]!);
  if (eq) vals.push(vals[0]!.slice(eq[0].length).trim());
  return vals.some(v => /^bearer\s/i.test(v) || /^basic\s/i.test(v) || /^(authorization|[\w-]*(token|key|secret))\s*:/i.test(v)
    || v.split(/[\s:]+/).some(p => TOKENISH.test(p) && !/[\\/]/.test(p) && !p.startsWith('@')));
}

/** A free label → a valid server id ("Azure DevOps" → "azure-devops"). */
export function idFrom(label: string): string {
  const s = label.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return s && !RESERVED_IDS.includes(s) ? s : 'server';
}

/** Whether the access lets this tool through. `role`: Flash never gets a writing tool, whatever the access says
 *  (a tool list included; ADR 0207). */
export function toolAllowed(access: McpToolAccess | undefined, tool: Pick<McpToolInfo, 'name' | 'readOnly'>, role?: string | null): boolean {
  if (role === 'flash' && !tool.readOnly) return false;
  if (access === undefined || access === 'all') return true;
  if (access === 'none') return false;
  if (access === 'read') return tool.readOnly;
  return access.tools.includes(tool.name);
}
/** Whether the server is offered at all (at least potentially one tool). */
export const serverOffered = (access: McpToolAccess | undefined): boolean =>
  access === undefined || access === 'all' || access === 'read' || (typeof access === 'object' && access.tools.length > 0);

/** A chat's levels, its own role first, then each parent's: a tool passes only when every level lets it through, so a
 *  child never gets more than its parent. A level without a role (a plain chat) is undefined = no limit. */
export function chainAllows(levels: readonly (RoleMcpAccess | undefined)[], server: string, tool: Pick<McpToolInfo, 'name' | 'readOnly'>, roles?: readonly (string | null)[]): boolean {
  return levels.every((l, i) => toolAllowed(l?.servers[server], tool, roles?.[i]));
}
export const chainOffers = (levels: readonly (RoleMcpAccess | undefined)[], server: string): boolean =>
  levels.every(l => serverOffered(l?.servers[server]));

/** Flash (ADR 0107) uses the app's MCP servers only when the user turns a server on for it, and only its reading tools
 *  (ADR 0207: Flash stays read-only). Its access lives beside the roles' under this key. */
export const FLASH_MCP_ROLE = FLASH_ID;
/** Everyone whose MCP access the user sets: the Orchestrator, the five work roles, Flash. */
export const MCP_ACCESS_ROLES: readonly string[] = [...ROLE_IDS, FLASH_MCP_ROLE];
/** What a role gets from a server nobody set: every tool, Flash none. */
export const defaultAccess = (role: string): McpToolAccess => (role === FLASH_MCP_ROLE ? 'none' : 'all');
/** The access that holds for a role: the stored value or its default; Flash never more than the reading tools. */
export function effectiveAccess(role: string, stored: McpToolAccess | undefined): McpToolAccess {
  const v = stored ?? defaultAccess(role);
  return role === FLASH_MCP_ROLE && v === 'all' ? 'read' : v;
}
/** The simple on/off a per-role toggle shows (on = at least one tool offered) and the value it sets. */
export const accessOn = (role: string, stored: McpToolAccess | undefined): boolean => serverOffered(effectiveAccess(role, stored));
export const toggleAccess = (role: string, on: boolean): McpToolAccess => (on ? (role === FLASH_MCP_ROLE ? 'read' : 'all') : 'none');

/** Exactly what a server starts: its variables, command and arguments, or its address (shown on «Attiva»). */
export function runsOf(def: Pick<McpServerDef, 'transport' | 'command' | 'args' | 'env' | 'url'>): string {
  if (def.transport === 'http') return def.url ?? '';
  const q = (w: string) => (/^[\w@%+=:,./-]+$/.test(w) ? w : JSON.stringify(w));
  return [...Object.entries(def.env ?? {}).map(([k, v]) => `${k}=${q(v)}`), q(def.command ?? ''), ...(def.args ?? []).map(q)].join(' ');
}

/** Validates one access value (from the renderer); throws in Italian. */
export function checkAccess(v: unknown): McpToolAccess {
  if (v === 'all' || v === 'read' || v === 'none') return v;
  const tools = (v as { tools?: unknown } | null)?.tools;
  if (v && typeof v === 'object' && Array.isArray(tools) && tools.length <= 500 && tools.every(t => typeof t === 'string' && t.length > 0 && t.length <= 128)) return { tools: [...new Set(tools as string[])] };
  throw new Error('Accesso al server MCP non valido.');
}
