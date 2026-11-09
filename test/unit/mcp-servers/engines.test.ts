// The app-managed MCP servers reach every engine at launch only (ADR 0086, AGENTS.md rule 6): Claude in --mcp-config
// with the managed servers it may not use in --disallowedTools, Cursor (ACP) in session/new mcpServers, Codex as
// `-c mcp_servers.<id>.url=` overrides that ask before each tool. Only gateway URLs (loopback, no secret) are passed;
// a non-loopback URL or an unsafe id never reaches Codex's command line; no engine config file is written.
import { afterEach, describe, expect, it } from 'vitest';
import { codexLaunch } from '../../../src/main/brain/adapters/codex';

const GW = 'http://127.0.0.1:4329/mcp/ext/c_x/ado/tok123';
const open: { shutdown?: () => Promise<void>; close?: () => void }[] = [];
afterEach(async () => { for (const o of open.splice(0)) { await o.shutdown?.(); o.close?.(); } });

describe('engines get the gateway endpoints at launch', () => {
  it('Codex: one url override per server, asking first; never a non-loopback URL or an unsafe id', () => {
    const args = codexLaunch({ mcpUrl: null, appMcpUrl: null, domains: [], brain: false, extMcp: [{ name: 'ado', url: GW }, { name: 'evil', url: 'https://example.com/mcp' }, { name: 'a b', url: GW }, { name: 'second-brain-x', url: GW }] }).configArgs;
    const values = args.filter((_, i) => i % 2 === 1);
    expect(values.filter(v => v.startsWith('mcp_servers.'))).toEqual([`mcp_servers.ado.url=${GW}`, 'mcp_servers.ado.default_tools_approval_mode=prompt']);
    expect(codexLaunch({ mcpUrl: null, appMcpUrl: null, domains: [], brain: false, readOnly: true, extMcp: [{ name: 'ado', url: GW }] }).configArgs.join(' ')).not.toContain('mcp_servers.ado');
  });
});
