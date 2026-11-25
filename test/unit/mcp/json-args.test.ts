// Issue #487: Cursor's CallDynamicTool with Gemini sends nested objects and lists as null. A nested object or list sent as
// its JSON text is read back by the schema, and a null where a value was expected is named in the tool's error with how
// to send it. Pins src/main/mcp/json-args.ts and its use in mcp/server.ts.
import { describe, expect, it } from 'vitest';
import { nullsHint, schemaArgs } from '../../../src/main/mcp/json-args';
import { McpServer, type McpTool } from '../../../src/main/mcp/server';

const DELEGATE = { type: 'object', properties: { tasks: { type: 'array', items: { type: 'object', properties: {
  role: { type: 'string' }, contract: { type: 'object', properties: { goal: { type: 'string' }, doneWhen: { type: 'array', items: { type: 'string' } } } },
} } } } };
const SHOW = { type: 'object', properties: { title: { type: 'string' }, props: { type: 'object', properties: { done: { type: 'array', items: { type: 'string' } } } } } };

describe('schemaArgs', () => {
  it('reads back a nested object or list sent as JSON text, where the schema wants one', () => {
    const contract = { goal: 'g', doneWhen: ['a'] };
    const r = schemaArgs({ tasks: [{ role: 'scout', contract: JSON.stringify(contract) }] }, DELEGATE);
    expect(r).toEqual({ args: { tasks: [{ role: 'scout', contract }] }, nulls: [] });
    expect(schemaArgs({ tasks: JSON.stringify([{ role: 'scout', contract }]) }, DELEGATE).args).toEqual({ tasks: [{ role: 'scout', contract }] });
    expect(schemaArgs({ title: 't', props: '{"done":["x"]}' }, SHOW).args).toEqual({ title: 't', props: { done: ['x'] } });
  });
  it('leaves text where text is wanted, and what is not JSON of the wanted kind', () => {
    const args = { title: '{"a":1}', props: { done: ['[1]'] } };
    expect(schemaArgs(args, SHOW).args).toBe(args);
    expect(schemaArgs({ title: 't', props: '[1]' }, SHOW).args.props).toBe('[1]');
    expect(schemaArgs({ title: 't', props: '{oops' }, SHOW).args.props).toBe('{oops');
    expect(schemaArgs({ x: '{"a":1}' }, { type: 'object' }).args).toEqual({ x: '{"a":1}' });
  });
  it('names the nulls the lossy call left: where a value was wanted, and in lists the schema does not describe', () => {
    expect(schemaArgs({ tasks: [{ role: 'scout', contract: null }] }, DELEGATE).nulls).toEqual(['tasks[0].contract']);
    expect(schemaArgs({ title: 't', props: { done: [null, null], checks: [null] } }, SHOW).nulls).toEqual(['props.done[0]', 'props.done[1]', 'props.checks[0]']);
    expect(schemaArgs({ x: null }, { type: 'object', properties: { x: { type: ['object', 'null'] } } }).nulls).toEqual([]);
    expect(nullsHint(['tasks[0].contract'])).toMatch(/tasks\[0\]\.contract arrived as null.*JSON text/);
  });
});

describe('the MCP server reads the arguments by the tool\'s schema (#487)', () => {
  const call = async (tool: McpTool, args: unknown): Promise<{ text: string; isError?: boolean }> => {
    const s = new McpServer({ name: 't', version: '0', port: 0 } as unknown as ConstructorParameters<typeof McpServer>[0]);
    const mount = { name: 't', instructions: '', tools: [tool] };
    const r = await (s as unknown as { handle(m: unknown, mount: unknown, ctx: unknown): Promise<{ result: { content: { text: string }[]; isError?: boolean } }> })
      .handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool.name, arguments: args } }, mount, { mount: 't', params: {}, sessionId: 's', signal: new AbortController().signal, progress: () => false });
    return { text: r.result.content[0]!.text, ...(r.result.isError ? { isError: true } : {}) };
  };
  const tool: McpTool = { name: 'agent_delegate', description: 'd', inputSchema: DELEGATE, run: a => {
    const c = (a.tasks as { contract: unknown }[])[0]!.contract;
    if (!c || typeof c !== 'object') throw new Error('contract: object required.');
    return `goal ${(c as { goal: string }).goal}`;
  } };
  it('a contract sent as JSON text runs; one sent as null fails with the way to send it', async () => {
    expect(await call(tool, { tasks: [{ role: 'scout', contract: '{"goal":"g","doneWhen":["a"]}' }] })).toEqual({ text: 'goal g' });
    const bad = await call(tool, { tasks: [{ role: 'scout', contract: null }] });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/^Error: contract: object required\. Note: tasks\[0\]\.contract arrived as null/);
  });
});
