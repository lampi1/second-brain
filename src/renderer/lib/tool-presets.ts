// The tool catalog of the setup wizard and of Settings → Connettori (issue #165, ADR 0119), kept pure so it is
// unit-tested without a DOM (test/unit/tool-presets.test.ts). Each tile is a preset that creates the app's account
// connector and its MCP server together (the app-managed servers of ADR 0086): it asks only human data (organization,
// site, email), then a browser sign-in or a token with a direct link to the page where it is made, and tests the
// connection at once (the account's read-only probe: "Works: I see N projects"; the MCP server's own test: its tools).
// Only real providers and servers: GitHub's remote MCP server, Atlassian's remote MCP server, Microsoft's Azure DevOps
// MCP server (npx @azure-devops/mcp). The technical form (command, args, env, headers) is in Settings → Avanzate only.
// Used by components/ToolCatalog.tsx; the port is the existing typed IPC (mcpservers:*, connectors:*).
import type { ConnectorId, ConnectorState, ConnectorToken } from '@shared/connectors';
import type { McpServerDef, McpServersState } from '@shared/mcp-servers';
import { slotKey } from '@shared/mcp-servers';
import { POLL_TRIES } from './setup-connectors';
import { plainError } from './setup-wizard';

export type PresetId = 'github' | 'jira' | 'azure';
export type PresetField = 'organization' | 'site' | 'email';
export interface ToolPreset {
  id: PresetId;
  name: string;
  /** two letters on the tile */
  mark: string;
  /** the app's account connector the tile creates too */
  account: ConnectorId;
  /** the MCP server's id (the name the engines see) */
  server: string;
  /** the human data asked, in this order */
  fields: readonly PresetField[];
  /** browser = the tool's official sign-in in its own window; token = pasted in the tile */
  auth: 'browser' | 'token';
  /** where the token is made (opened in the user's browser) */
  tokenUrl?: string;
}
export const PRESETS: readonly ToolPreset[] = [
  { id: 'github', name: 'GitHub', mark: 'GH', account: 'github', server: 'github', fields: [], auth: 'token', tokenUrl: 'https://github.com/settings/personal-access-tokens/new' },
  { id: 'jira', name: 'Jira Cloud', mark: 'J', account: 'jira', server: 'jira', fields: ['site', 'email'], auth: 'token', tokenUrl: 'https://id.atlassian.com/manage-profile/security/api-tokens' },
  { id: 'azure', name: 'Azure DevOps', mark: 'Az', account: 'azure', server: 'azure-devops', fields: ['organization'], auth: 'browser' },
];
export const presetOf = (id: PresetId): ToolPreset => PRESETS.find(p => p.id === id)!;

export type PresetInput = Partial<Record<PresetField, string>> & { token?: string };
export type InputProblem = Partial<Record<PresetField | 'token', 'missing' | 'invalid'>>;

/** "<org>", "dev.azure.com/<org>" or "https://dev.azure.com/<org>/<project>" → "<org>" (null = not one) */
export function organizationOf(text: string): string | null {
  const v = text.trim().replace(/^https?:\/\//i, '').replace(/^dev\.azure\.com\//i, '').split('/')[0]!.replace(/\.visualstudio\.com$/i, '');
  return /^[a-zA-Z0-9][a-zA-Z0-9-]{0,49}$/.test(v) ? v : null;
}
/** "acme", "acme.atlassian.net" or "https://acme.atlassian.net/jira" → "https://acme.atlassian.net" (null = not one) */
export function siteOf(text: string): string | null {
  const v = text.trim().toLowerCase().replace(/^https?:\/\//, '').split(/[/?#]/)[0]!;
  const name = v.endsWith('.atlassian.net') ? v.slice(0, -'.atlassian.net'.length) : v;
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(name) ? `https://${name}.atlassian.net` : null;
}
const emailOk = (v: string) => /^[^\s:@]+@[^\s:@]+\.[^\s:@]+$/.test(v.trim());
const tokenOk = (preset: ToolPreset, v: string) => preset.id === 'github' ? /^[A-Za-z0-9_]{20,255}$/.test(v.trim()) : /^\S{8,4096}$/.test(v.trim());

/** what keeps a tile from connecting: each field missing or not valid (the tile says what to write) */
export function inputProblems(preset: ToolPreset, input: PresetInput): InputProblem {
  const out: InputProblem = {};
  for (const f of preset.fields) {
    const v = (input[f] ?? '').trim();
    if (!v) out[f] = 'missing';
    else if (f === 'organization' ? !organizationOf(v) : f === 'site' ? !siteOf(v) : !emailOk(v)) out[f] = 'invalid';
  }
  if (preset.auth === 'token') { const v = (input.token ?? '').trim(); if (!v) out.token = 'missing'; else if (!tokenOk(preset, v)) out.token = 'invalid'; }
  return out;
}

const base64 = (text: string): string => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

/** the MCP server the tile creates (main validates it again); purpose = the card's line, in the UI language */
export function presetServer(preset: ToolPreset, input: PresetInput, purpose: string): McpServerDef {
  const common = { id: preset.server, label: preset.name, enabled: true, purpose };
  if (preset.id === 'github') return { ...common, transport: 'http', url: 'https://api.githubcopilot.com/mcp/', secrets: [{ where: 'header', name: 'Authorization', prefix: 'Bearer ' }] };
  if (preset.id === 'jira') return { ...common, transport: 'http', url: 'https://mcp.atlassian.com/v1/mcp', secrets: [{ where: 'header', name: 'Authorization', prefix: 'Basic ' }] };
  return { ...common, transport: 'stdio', command: 'npx', args: ['-y', '@azure-devops/mcp', organizationOf(input.organization ?? '') ?? ''], secrets: [] };
}
/** the value of the server's token slot: GitHub's token as is; Atlassian's API token as Basic email:token */
export function presetSecret(preset: ToolPreset, input: PresetInput): string | null {
  const token = (input.token ?? '').trim();
  if (preset.auth !== 'token' || !token) return null;
  return preset.id === 'jira' ? base64(`${(input.email ?? '').trim()}:${token}`) : token;
}
/** the token the account connector keeps (null = a browser sign-in) */
export function presetToken(preset: ToolPreset, input: PresetInput): ConnectorToken | null {
  const token = (input.token ?? '').trim();
  if (preset.id === 'github') return { provider: 'github', token };
  if (preset.id === 'jira') return { provider: 'jira', token, site: siteOf(input.site ?? '') ?? '', email: (input.email ?? '').trim() };
  return null;
}

/** What a tile shows. */
export type TilePhase = 'idle' | 'connecting' | 'waiting' | 'testing' | 'ok' | 'failed';
export interface TileState {
  phase: TilePhase;
  account?: string | null;
  projects?: number;
  tools?: number;
  /** which part failed: the sign-in or token (account), the server's own test (server), tokens cannot be stored on
   *  this computer (keyring), or the app (app) */
  failed?: 'account' | 'server' | 'keyring' | 'app';
  /** the server test's message and fix (already the app's sentence), or the app's reason */
  message?: string;
  fix?: string;
}
export interface ToolPort {
  servers(): Promise<McpServersState>;
  saveServer(def: McpServerDef, previousId?: string): Promise<McpServersState>;
  setSecret(id: string, slot: string, value: string): Promise<McpServersState>;
  testServer(id: string): Promise<McpServersState>;
  useToken(value: ConnectorToken): Promise<ConnectorState>;
  login(provider: ConnectorId): Promise<void>;
  probe(provider: ConnectorId): Promise<ConnectorState>;
}

/** creates (or updates) the tile's MCP server and puts its token in place; null = done, else why not */
async function createServer(port: ToolPort, preset: ToolPreset, input: PresetInput, purpose: string): Promise<TileState | null> {
  try {
    const state = await port.servers();
    const def = presetServer(preset, input, purpose), secret = presetSecret(preset, input);
    if (secret && !state.secretsAvailable) return { phase: 'failed', failed: 'keyring', message: state.secretsWhy };
    const exists = state.servers.some(s => s.id === def.id);
    await port.saveServer(def, exists ? def.id : undefined);
    if (secret) await port.setSecret(def.id, slotKey(def.secrets[0]!), secret);
    return null;
  } catch (error) { return { phase: 'failed', failed: 'app', message: plainError(error) }; }
}

/** the server's own test, after the account works: ok with its tools, or failed with its message and fix */
export async function testPreset(port: ToolPort, preset: ToolPreset, account: ConnectorState): Promise<TileState> {
  const seen = { account: account.account, projects: account.projects.length };
  try {
    const state = await port.testServer(preset.server);
    const test = state.servers.find(s => s.id === preset.server)?.lastTest;
    if (test?.ok) return { phase: 'ok', ...seen, tools: test.tools.length };
    return { phase: 'failed', failed: 'server', ...seen, message: test?.error?.message, fix: test?.error?.fix };
  } catch (error) { return { phase: 'failed', failed: 'server', ...seen, message: plainError(error) }; }
}

/** "Collega": server and account together. A token tile probes at once; a browser tile opens the sign-in and returns
 *  'waiting' (the tile then checks by itself with pollPreset). Never throws: every end is a state with what to do. */
export async function connectPreset(port: ToolPort, preset: ToolPreset, input: PresetInput, purpose: string): Promise<TileState> {
  const refused = await createServer(port, preset, input, purpose);
  if (refused) return refused;
  const token = preset.auth === 'token' ? presetToken(preset, input) : null;
  if (token) {
    let account: ConnectorState;
    try { account = await port.useToken(token); }
    catch (error) { return { phase: 'failed', failed: 'account', message: plainError(error) }; }
    if (account.status !== 'verified') return { phase: 'failed', failed: 'account' };
    return testPreset(port, preset, account);
  }
  try { await port.login(preset.account); }
  catch (error) { return { phase: 'failed', failed: 'account', message: plainError(error) }; }
  return pollPreset(port, preset, 0);
}

/** one check while a browser sign-in is open: verified → the server test; the last try → failed with what to do */
export async function pollPreset(port: ToolPort, preset: ToolPreset, attempt: number): Promise<TileState> {
  let account: ConnectorState;
  try { account = await port.probe(preset.account); }
  catch (error) { return { phase: 'failed', failed: 'account', message: plainError(error) }; }
  if (account.status === 'verified') return testPreset(port, preset, account);
  return attempt + 1 >= POLL_TRIES ? { phase: 'failed', failed: 'account' } : { phase: 'waiting' };
}

/** a tile already done in an earlier run: the account verified and the server's last test passed */
export function tileFrom(preset: ToolPreset, accounts: readonly ConnectorState[], servers: McpServersState | null): TileState {
  const account = accounts.find(a => a.provider === preset.account), server = servers?.servers.find(s => s.id === preset.server);
  if (account?.status === 'verified' && server?.lastTest?.ok) return { phase: 'ok', account: account.account, projects: account.projects.length, tools: server.lastTest.tools.length };
  return { phase: 'idle' };
}
