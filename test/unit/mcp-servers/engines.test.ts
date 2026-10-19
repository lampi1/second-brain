// The app-managed MCP servers reach every engine at launch only (ADR 0086, AGENTS.md rule 6): Claude in --mcp-config
// with the managed servers it may not use in --disallowedTools, Cursor (ACP) in session/new mcpServers, Codex as
// `-c mcp_servers.<id>.url=` overrides that ask before each tool. Only gateway URLs (loopback, no secret) are passed;
// a non-loopback URL or an unsafe id never reaches Codex's command line; no engine config file is written.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { codexLaunch } from '../../../src/main/brain/adapters/codex';
import { AcpSession } from '../../../src/main/chats/acp';
import { ChatManager } from '../../../src/main/chats/manager';
import { FAKE, FAKE_CURSOR, cursorLog, fakeLog, recEmitter, recSink, tmp, waitFor } from '../chats/helpers';

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

  it('Cursor (ACP): session/new lists the managed servers next to the app\'s own', async () => {
    const logFile = path.join(tmp('log'), 'cursor.jsonl');
    const s = new AcpSession({ engineId: 'cursor', label: 'Cursor', args: ['acp'], modelFlag: '--model', acpCommand: 'agent', loginCommand: 'agent login', chatId: 'c_x', cwd: tmp('cwd'), pathOverride: FAKE_CURSOR,
      model: null, effort: null, permissionMode: null, title: null, sessionId: null, resume: false, fork: false, worktree: false, mcpConfig: null, costBaseUsd: 0,
      mcpUrl: 'http://127.0.0.1:4329/mcp/chat/c_x/t', extMcp: [{ name: 'ado', url: GW }], env: { FAKE_CURSOR_LOG: logFile, CURSOR_CONFIG_DIR: tmp('cfg') } } as ConstructorParameters<typeof AcpSession>[0], recSink());
    open.push({ close: () => s.close() });
    s.start();
    await waitFor(() => cursorLog(logFile).some(l => l.method === 'session/new'), 'session/new');
    expect(cursorLog(logFile).find(l => l.method === 'session/new')?.params?.mcpServers).toEqual([
      { type: 'http', name: 'second-brain', url: 'http://127.0.0.1:4329/mcp/chat/c_x/t', headers: [] },
      { type: 'http', name: 'ado', url: GW, headers: [] },
    ]);
  });

  it('Claude: --mcp-config carries the managed servers, --disallowedTools the ones the chat may not use; no file written', async () => {
    const home = tmp('home'), userData = tmp('ud'), argLog = path.join(userData, 'argv.jsonl');
    const m = new ChatManager({ emitter: recEmitter(), userData, enginePaths: { claude: FAKE }, claudeHome: home, env: { CLAUDE_CONFIG_DIR: home, FAKE_CLAUDE_LOG: argLog },
      extMcp: id => ({ servers: [{ name: 'ado', url: `http://127.0.0.1:4329/mcp/ext/${id}/ado/t` }], denied: ['jira'] }) });
    open.push({ shutdown: () => m.shutdown() });
    const c = await m.create({ harness: 'claude', cwd: tmp('cwd'), prompt: 'hi' });
    const argv = await waitFor(() => fakeLog(argLog).find(l => l.argv)?.argv, 'argv');
    const config = JSON.parse(argv[argv.indexOf('--mcp-config') + 1]!) as { mcpServers: Record<string, { url: string }> };
    expect(config.mcpServers.ado).toEqual({ type: 'http', url: `http://127.0.0.1:4329/mcp/ext/${c.id}/ado/t` });
    expect(argv[argv.indexOf('--disallowedTools') + 1]).toBe('mcp__jira');
    expect(fs.readdirSync(home).filter(f => /mcp|settings/.test(f))).toEqual([]);
    expect(m.mcpContext(c.id)).toEqual({ roles: [null], policy: null });
    expect(m.mcpContext('nope')).toBeNull();
  });
});
