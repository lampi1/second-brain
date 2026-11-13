// Strict, fail-closed project configuration adapters; unsupported existing syntax is left untouched.
import type { Harness } from './contract';
import path from 'node:path';
export const configPaths: Record<Harness, string> = { claude: '.mcp.json', codex: path.join('.codex', 'config.toml'), cursor: path.join('.cursor', 'mcp.json') };
const sensitive = /(?:authorization|password|secret|token|api[_-]?key|headers|env)\s*["']?\s*[:=]/i;
export function configAfter(harness: Harness, provider: string, endpoint: string, before: string | null): string {
  if (before && sensitive.test(before)) throw new Error('Existing authentication settings require secure migration before connecting');
  if (harness === 'codex') {
    // Do not pretend to parse arbitrary TOML. Nontrivial existing TOML needs a preserving parser in a later slice.
    if (before?.split(/\r?\n/).some(line => line.trim() && !line.trim().startsWith('#'))) throw new Error('Existing Codex settings need a preserving TOML adapter; no file changed');
    return (before ?? '') + `\n[mcp_servers.${provider}]\nurl = ${JSON.stringify(endpoint)}\n`;
  }
  let value: Record<string, unknown> = {};
  if (before !== null) {
    try { value = JSON.parse(before) as Record<string, unknown>; }
    catch { throw new Error('Invalid JSON configuration; no file changed'); }
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Expected a configuration object');
  }
  const servers = value.mcpServers ?? {};
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) throw new Error('Invalid server configuration');
  if (Object.hasOwn(servers, provider)) throw new Error('A connector with this name already exists; review it first');
  value.mcpServers = { ...servers, [provider]: harness === 'claude' ? { type: 'http', url: endpoint } : { url: endpoint } };
  return JSON.stringify(value, null, 2) + '\n';
}
export function semanticDiff(harness: Harness, provider: string, endpoint: string): string {
  // The preview never contains pre-existing config values (including unrecognized secrets).
  return harness === 'codex' ? `+ [mcp_servers.${provider}]\n+ url = ${JSON.stringify(endpoint)}` : `+ mcpServers.${provider} = ${JSON.stringify(harness === 'claude' ? { type: 'http', url: endpoint } : { url: endpoint })}`;
}
