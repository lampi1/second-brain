// Native MCP approval policy: only exact app read/mail tools on attached loopback servers are pre-approved.
// Asserts the Codex configuration contract, not a live model or installed CLI run.
import { describe, expect, it } from 'vitest';
import { codexLaunch } from '../../../src/main/brain/adapters/codex';

const urls = { mcpUrl: 'http://127.0.0.1:4329/mcp/chat/c_test/fixture', appMcpUrl: 'http://127.0.0.1:4329/mcp/app/r/regia/fixture', domains: [], brain: false };
const overrides = (input = {}) => codexLaunch({ ...urls, ...input }).configArgs.filter((_, index) => index % 2 === 1);
const approved = (values: string[]) => values.filter(value => value.endsWith('.approval_mode=approve'));

describe('native Codex app tool approval', () => {
  it('pre-approves exactly the ten requested mail/read tools, with prompt fallback for the two attached app servers', () => {
    const values = overrides();
    expect(approved(values)).toEqual([
      'mcp_servers.second-brain.tools.send_to_chat.approval_mode=approve',
      'mcp_servers.second-brain.tools.list_chats.approval_mode=approve',
      ...['app_digest', 'app_send_to_chat', 'app_chats', 'app_chat_items', 'app_pending', 'app_feed', 'app_logs', 'app_state'].map(name => `mcp_servers.second-brain-app.tools.${name}.approval_mode=approve`),
    ]);
    expect(values).toContain('mcp_servers.second-brain.default_tools_approval_mode=prompt');
    expect(values).toContain('mcp_servers.second-brain-app.default_tools_approval_mode=prompt');
    expect(values).toContain('approval_policy=on-request');
    expect(values).toContain('sandbox_mode=workspace-write');
  });

  it('leaves action tools, similar names and other servers outside the native approval overrides', () => {
    const values = overrides();
    for (const name of ['app_close_chat', 'app_reopen_chat', 'app_create_chat', 'app_ui', 'app_state_extra', 'APP_STATE', 'click', 'navigate', 'type']) {
      expect(values.some(value => value.includes(`.tools.${name}.`))).toBe(false);
    }
    expect(values.some(value => value.startsWith('mcp_servers.second-brain-app-evil.'))).toBe(false);
    expect(values.some(value => value.startsWith('mcp_servers.remote.'))).toBe(false);
    expect(values.filter(value => value.includes('approval')).every(value => value === 'approval_policy=on-request' || value.startsWith('mcp_servers.second-brain.') || value.startsWith('mcp_servers.second-brain-app.'))).toBe(true);
    expect(values.some(value => value.includes('*') || value.includes('enabled_tools') || value.includes('disabled_tools'))).toBe(false);
  });

  it('does not add app-server policy without an attached app server or mail policy without its own endpoint', () => {
    expect(overrides({ appMcpUrl: null }).some(value => value.startsWith('mcp_servers.second-brain-app.'))).toBe(false);
    expect(overrides({ mcpUrl: null }).some(value => value.startsWith('mcp_servers.second-brain.'))).toBe(false);
    expect(overrides({ mcpUrl: null, appMcpUrl: null })).toEqual(['approval_policy=on-request', 'sandbox_mode=workspace-write']);
  });

  it.each(['http://remote.invalid:4329/mcp/app', 'http://127.0.0.1.evil.invalid:4329/mcp/app', 'https://127.0.0.1:4329/mcp/app', 'http://127.0.0.1:4329/other', 'not-a-url', 'http://127.0.0.1:4329/mcp/app?x=y'])('never trusts a non-app or non-loopback endpoint: %s', url => {
    expect(approved(overrides({ mcpUrl: url, appMcpUrl: url }))).toEqual([]);
  });

  it('preserves no MCP access for read-only comparisons', () => {
    expect(overrides({ readOnly: true })).toEqual(['approval_policy=on-request', 'sandbox_mode=read-only']);
  });
});
