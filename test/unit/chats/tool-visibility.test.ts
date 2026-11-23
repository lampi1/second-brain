// Which chat-endpoint tools a chat sees (src/main/chats/tool-visibility.ts, ChatManager.chatToolShown): the research's
// two tools only for the research, the Orchestrator's own endpoint tools hidden; the compact tool metadata of an engine
// with a tight MCP schema budget (Antigravity, compactMcpTool).
import { describe, expect, it } from 'vitest';
import { compactMcpTool, toolShownToChat, toolShownToUnknown, toolShownToWarm } from '../../../src/main/chats/tool-visibility';
import { appAsks } from '../../../src/main/engines/registry';

const chat = (o: Record<string, unknown> = {}): Parameters<typeof toolShownToChat>[0] => ({ isOrchestrator: false, parentId: null, ...o }) as never;

describe('tool visibility', () => {
  it('the research sees its two tools and no agent_* tool; nobody else sees them', () => {
    expect(toolShownToChat(chat({ research: true }), undefined, 'maintenance_propose')).toBe(true);
    expect(toolShownToChat(chat({ research: true }), undefined, 'agent_report')).toBe(false);
    expect(toolShownToChat(chat(), undefined, 'maintenance_pack')).toBe(false);
    expect(toolShownToUnknown('maintenance_pack')).toBe(false);
    expect(toolShownToUnknown('agent_report')).toBe(true);
  });
  it('the Orchestrator, a root chat and a role that launches nobody', () => {
    expect(toolShownToChat(chat({ isOrchestrator: true }), undefined, 'agent_delegate')).toBe(false);
    expect(toolShownToChat(chat(), undefined, 'agent_ask_parent')).toBe(false);
    expect(toolShownToChat(chat({ parentId: 'p' }), undefined, 'agent_ask_parent')).toBe(true);
    expect(toolShownToChat(chat(), [], 'agent_delegate')).toBe(false);
    expect(toolShownToChat(chat(), undefined, 'agent_delegate')).toBe(true);
    expect(toolShownToChat(chat(), undefined, 'plan_propose')).toBe(false);
  });
  it('ask_user only for a chat on an ACP engine (OpenCode, Cursor), Orchestrator included', () => {
    expect(toolShownToChat(chat(), undefined, 'ask_user')).toBe(false);
    expect(toolShownToChat(chat(), undefined, 'ask_user', true)).toBe(true);
    expect(toolShownToChat(chat({ isOrchestrator: true }), undefined, 'ask_user', true)).toBe(true);
    expect(toolShownToChat(chat({ research: true }), undefined, 'ask_user', true)).toBe(false);
    expect(toolShownToUnknown('ask_user')).toBe(false);
    expect(toolShownToWarm({ role: 'strategist', launches: ['scout'] }, 'ask_user')).toBe(false);
    // which engines: every ACP engine; Cursor too, whose AskQuestion its ACP sessions do not offer the model (real
    // run 2026-10-31: «The AskQuestion tool is unavailable»); never Claude or Codex
    expect([appAsks({ kind: 'acp' }), appAsks({ kind: 'acp', cursorExtras: true }), appAsks({ kind: 'claude' }), appAsks({ kind: 'codex' }), appAsks(null)]).toEqual([true, true, false, false, false]);
  });
  it('a waiting engine sees what its role\'s root chat would', () => {
    expect(toolShownToWarm({ role: 'scout', launches: [] }, 'agent_delegate')).toBe(false);
    expect(toolShownToWarm({ role: 'strategist', launches: ['scout'] }, 'agent_delegate')).toBe(true);
    expect(toolShownToWarm({ role: 'scout', launches: null }, 'agent_ask_parent')).toBe(false);
    expect(toolShownToWarm({ role: 'scout', launches: null, child: { ancestors: [] } }, 'agent_ask_parent')).toBe(true);
  });
  it('only the Orchestrator and the Strategist delegate: Scout, Artisan, Sentinel and Herald never see agent_delegate or agent_assign_task, stale launches or not (2026-11-23)', () => {
    for (const role of ['scout', 'artisan', 'sentinel', 'herald']) {
      const c = chat({ agent: { id: role, source: 'catalog' } });
      for (const tool of ['agent_delegate', 'agent_assign_task', 'agent_children']) {
        expect([role, tool, toolShownToChat(c, ['scout', 'sentinel'], tool)]).toEqual([role, tool, false]);
        expect([role, tool, toolShownToWarm({ role, launches: ['scout', 'sentinel'] }, tool)]).toEqual([role, tool, false]);
      }
      expect(toolShownToChat(chat({ agent: { id: role, source: 'catalog' }, parentId: 'p' }), [], 'agent_report')).toBe(true);
    }
    expect(toolShownToChat(chat({ agent: { id: 'strategist', source: 'catalog' } }), ['scout'], 'agent_delegate')).toBe(true);
    expect(toolShownToChat(chat({ agent: { id: 'strategist', source: 'catalog' } }), ['scout'], 'agent_assign_task')).toBe(true);
    // a plain chat (no catalog role) keeps what its launches say
    expect(toolShownToChat(chat({ agent: { id: 'plain', source: 'plain' } }), ['scout'], 'agent_delegate')).toBe(true);
  });
});

describe('compact tool metadata (Antigravity, ADR 0332)', () => {
  const long = 'x'.repeat(2000);
  const schema = {
    type: 'object', required: ['title', 'mode'], description: long,
    properties: {
      title: { type: 'string', description: long },
      mode: { type: 'string', enum: ['a', 'b'], description: long },
      items: { type: 'array', items: { type: 'object', properties: { n: { type: 'number', description: long } } } },
    },
  };
  const tool = { name: 'agent_report', description: long, inputSchema: schema, run: () => ({ content: [] }) } as never;
  it('clips every description and keeps names, types, enums and required fields', () => {
    const c = compactMcpTool(tool);
    expect(c.name).toBe('agent_report');
    expect(c.description.length).toBeLessThanOrEqual(180);
    expect(c.description.endsWith('…')).toBe(true);
    const p = c.inputSchema as typeof schema;
    expect(p.required).toEqual(['title', 'mode']);
    expect(p.properties.mode.enum).toEqual(['a', 'b']);
    expect(p.properties.title.type).toBe('string');
    expect(p.properties.title.description.length).toBeLessThanOrEqual(80);
    expect(p.properties.items.items.properties.n.description.length).toBeLessThanOrEqual(80);
    expect(JSON.stringify(c.inputSchema).length).toBeLessThan(JSON.stringify(schema).length / 5);
    expect(c.run).toBe((tool as { run: unknown }).run);
  });
  it("compacts a per-caller schema too; short text and run_code's schema stay as they are", () => {
    const per = compactMcpTool({ ...(tool as object), inputSchemaFor: () => schema } as never);
    expect(((per.inputSchemaFor!({}) as typeof schema).properties.title.description).length).toBeLessThanOrEqual(80);
    expect(compactMcpTool({ ...(tool as object), description: 'breve' } as never).description).toBe('breve');
    const rc = compactMcpTool({ ...(tool as object), name: 'run_code' } as never);
    expect(rc.inputSchema).toBe(schema);
    expect(rc.description.length).toBeLessThanOrEqual(180);
  });
});
