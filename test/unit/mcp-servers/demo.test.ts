// The demo's MCP servers (main/mcp-servers/demo.ts): seeding them must never throw (a retired role such as Herald in
// a role limit made `npm run demo` and the README shots fail at start), and every role limit names a current role.
import { describe, expect, it } from 'vitest';
import { demoMcpServers } from '../../../src/main/mcp-servers/demo';
import { McpServer } from '../../../src/main/mcp/server';
import { MCP_ACCESS_ROLES } from '../../../src/shared/mcp-servers';
import { tmp } from '../chats/helpers';

describe('demo MCP servers', () => {
  it('seeds the four servers and the role limits without throwing, only on current roles', () => {
    const svc = demoMcpServers({ userData: tmp('demo-mcp'), mcp: new McpServer({ name: 't', version: '1' }), emit: () => {}, now: () => 1_000_000 });
    expect(svc.store.servers().map(s => s.id)).toEqual(['azure-devops', 'github', 'jira', 'docs-search']);
    for (const role of ['artisan', 'scout', 'sentinel']) expect(MCP_ACCESS_ROLES).toContain(role);
    expect(svc.store.roleAccess('artisan')?.servers['azure-devops']).toBeTruthy();
    expect(svc.store.roleAccess('herald')).toBeUndefined();
  });
});
