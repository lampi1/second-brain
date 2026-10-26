// Generic connector recipes: pinned discovery, host-only credentials, role boundaries, drift and dispatch evidence.
import { describe, expect, it, vi } from 'vitest';
import { connectorArguments, connectorHash, validateConnector } from '../../../src/main/flows/connector-call';
import { RoutineConnectors } from '../../../src/main/mcp-servers/routine';
import type { FlowConnectorCall } from '../../../src/shared/flow-connector';
import type { McpServerDef, RoleMcpAccess } from '../../../src/shared/mcp-servers';
import type { UpstreamTool } from '../../../src/main/mcp-servers/client';
import { addRedaction } from '../../../src/main/log';
const fixture = () => {
  const def: McpServerDef = { id: 'test-service', label: 'Test service', enabled: true, routineTest: true, transport: 'http', url: 'https://qa.example.com/mcp', secrets: [] };
  let access: RoleMcpAccess = { servers: {} };
  const tools: UpstreamTool[] = [{ name: 'add_note', description: 'Add a note to the test system', readOnly: false, inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }];
  const call = vi.fn(async () => ({ content: [{ type: 'text', text: 'Saved note' }] })), close = vi.fn();
  const routines = new RoutineConnectors({ definitions: () => [def], endpoint: () => ({ transport: 'http', url: def.url!, headers: {} }), policy: () => ({ tools: { allow: ['mcp'] }, ceiling: null }), access: () => access, connect: () => ({ tools: async () => tools, call, close, serverInfo: 'fixture' }) });
  const recipe = async (): Promise<FlowConnectorCall> => { const found = await routines.inspect(def.id, 'add_note'); return { serverId: def.id, tool: 'add_note', serverHash: found.serverHash, toolHash: found.tools[0]!.toolHash, role: 'artisan', arguments: { text: '{{note}}' } }; };
  return { def, tools, call, close, routines, recipe, access: (v: RoleMcpAccess) => { access = v; } };
};
describe('portable connector argument data', () => {
  it('supports ordinary identifiers and typed inputs without interpreting data as a tool or server', () => {
    const args = { id: '11111111-2222-4333-8444-555555555555', commit: 'ab12'.repeat(10), author: 'test', text: '{{note}}', count: { $input: 'count', as: 'integer' }, flags: { $input: 'flags', as: 'json' } };
    expect(connectorArguments(args, ['note', 'count', 'flags'], { note: 'Literal {{other}}', count: '3', flags: '[true,false]' })).toEqual({ ...args, text: 'Literal {{other}}', count: 3, flags: [true, false] });
    expect(() => connectorArguments({ n: { $input: 'n', as: 'integer' } }, ['n'], { n: '3.2' })).toThrow('integer');
  });
  it('refuses secrets, undeclared/partial templates, prototype keys and excess data before dispatch', () => {
    for (const args of [{ password: 'fixture' }, { note: 'prefix {{id}}' }, { note: '{{unknown}}' }, JSON.parse('{"__proto__":{}}'), { note: 'x'.repeat(8001) }]) expect(() => connectorArguments(args, ['id'])).toThrow();
    addRedaction('fixture-private-value', true);
    expect(() => connectorArguments({ note: '{{id}}' }, ['id'], { id: 'fixture-private-value' })).toThrow('credential');
  });
  it('pins exactly the server/tool and accepts only existing work roles', async () => {
    const f = fixture(), recipe = await f.recipe(); expect(validateConnector(recipe, ['note'])).toEqual(recipe);
    expect(() => validateConnector({ ...recipe, serverId: '{{server}}' }, ['server'])).toThrow();
    expect(() => validateConnector({ ...recipe, role: 'orchestrator' }, ['note'])).toThrow();
    expect(connectorHash({ b: 2, a: 1 })).toBe(connectorHash({ a: 1, b: 2 }));
  });
});
describe('configured host connector execution', () => {
  it('discovers without calling, rechecks authorization, journals before calling and closes the connection', async () => {
    const f = fixture(), recipe = await f.recipe(), order: string[] = [];
    expect(f.call).not.toHaveBeenCalled();
    f.call.mockImplementation(async () => { order.push('call'); return { content: [{ type: 'text', text: 'Saved note' }] }; });
    const result = await f.routines.execute(recipe, { text: 'hello' }, false, new AbortController().signal, () => order.push('auth'), () => order.push('journal'));
    expect(result).toMatchObject({ outcome: 'done', summary: 'Saved note' }); expect(order.indexOf('journal')).toBeLessThan(order.indexOf('call')); expect(f.close).toHaveBeenCalled();
  });
  it.each(['unregistered', 'disabled', 'target-drift', 'schema-drift', 'role', 'read-only'] as const)('refuses %s before dispatch', async kind => {
    const f = fixture(), recipe = await f.recipe(), dispatched = vi.fn();
    if (kind === 'unregistered') delete f.def.routineTest;
    if (kind === 'disabled') f.def.enabled = false;
    if (kind === 'target-drift') f.def.url = 'https://other.example.com/mcp';
    if (kind === 'schema-drift') f.tools[0]!.inputSchema = { type: 'array' };
    if (kind === 'role') f.access({ servers: { 'test-service': 'none' } });
    await expect(f.routines.execute(recipe, {}, kind === 'read-only', new AbortController().signal, () => {}, dispatched)).rejects.toThrow();
    expect(dispatched).not.toHaveBeenCalled(); expect(f.call).not.toHaveBeenCalled();
  });
  it('treats remote errors as uncertain effects and redacts host secrets from response evidence', async () => {
    const f = fixture(), recipe = await f.recipe(); addRedaction('fixture-private-value', true);
    f.call.mockResolvedValue({ content: [{ type: 'text', text: 'fixture-private-value' }], isError: true } as never);
    expect(await f.routines.execute(recipe, {}, false, new AbortController().signal, () => {}, () => {})).toMatchObject({ outcome: 'unknown', summary: '[redacted]' });
  });
  it('checks live authorization again after asynchronous discovery', async () => {
    const f = fixture(), recipe = await f.recipe(); let checks = 0;
    await expect(f.routines.execute(recipe, {}, false, new AbortController().signal, () => { if (++checks > 1) throw new Error('cancelled'); }, () => {})).rejects.toThrow('cancelled');
    expect(f.call).not.toHaveBeenCalled();
  });
});
