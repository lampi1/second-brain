// ADR 0371 point 2 (#492): a chat's required tools (shared/role-tools.ts: agent_report, plan_propose, agent_delegate…)
// are never deferred behind ToolSearch; every other app tool is. A mount lists with _meta anthropic/alwaysLoad only the
// names its alwaysLoad returns for that chat; a role chat's --mcp-config marks no whole server (that loaded every schema:
// ~25-34k tokens on the Orchestrator). Red before ADR 0371: tools/list carried no _meta, so Claude deferred agent_report,
// plan_propose and agent_delegate (29 «input schema was not in your prompt» in 20 hours). The schema sizes below are
// measured on the app's real tool factories (the token figures of ADR 0371: characters / 4). No engine runs.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import { ClaudeSession } from '../../../src/main/chats/claude';
import type { HarnessSession, SessionOptions } from '../../../src/main/chats/session';
import { ALWAYS_LOAD, McpServer, type McpTool } from '../../../src/main/mcp/server';
import { plainOwner } from '../../../src/main/agents/catalog';
import { delegationTools } from '../../../src/main/agents/delegation';
import { strategyTools } from '../../../src/main/agents/strategy-tools';
import { workDecisionTools } from '../../../src/main/agents/work-decisions';
import { agentCatalogTool } from '../../../src/main/agents/discovery';
import { askTools } from '../../../src/main/chats/ask-tool';
import { mailTools } from '../../../src/main/chats/mail';
import { artifactSaveTool } from '../../../src/main/library/tools';
import { brainSearchTool } from '../../../src/main/search/hybrid/tool';
import { memoryTools } from '../../../src/main/rules/memory-tool';
import { brainQueriesTool, chatQueryAddTool } from '../../../src/main/brain/queries-tools';
import { brainScriptsTool, chatScriptAddTool } from '../../../src/main/brain/scripts-tools';
import { showUiTool } from '../../../src/main/genui/artifacts';
import { QuestionRelay } from '../../../src/main/chats/relay';
import { toolListSize, toolShownToChat } from '../../../src/main/chats/tool-visibility';
import { appControlTools } from '../../../src/main/appctl/tools';
import { ORCHESTRATOR_APP_REQUIRED, requiredTools } from '../../../src/shared/role-tools';

const dirs: string[] = [], managers: ChatManager[] = [];
const tmp = (): string => { const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-al-'))); dirs.push(d); return d; };
afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(50); for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

type Mount = { name: string; instructions: string; tools: McpTool[]; alwaysLoad?: boolean | ((p: Record<string, string>) => Iterable<string>) };
const list = async (mount: Mount, chatId = 'c1'): Promise<{ name: string; _meta?: Record<string, unknown> }[]> => {
  const s = new McpServer({ name: 't', version: '0', port: 0 } as unknown as ConstructorParameters<typeof McpServer>[0]);
  const r = await (s as unknown as { handle(m: unknown, mount: unknown, ctx: unknown): Promise<{ result: { tools: { name: string; _meta?: Record<string, unknown> }[] } }> })
    .handle({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, mount, { mount: 't', params: { chatId }, sessionId: 's', signal: new AbortController().signal, progress: () => false });
  return r.result.tools;
};
const tool = (name: string, meta?: Record<string, unknown>): McpTool => ({ name, description: 'd', inputSchema: { type: 'object' }, ...(meta ? { meta } : {}), run: () => 'ok' });
const marked = (tools: { name: string; _meta?: Record<string, unknown> }[]): string[] => tools.filter(t => t._meta?.[ALWAYS_LOAD] === true).map(t => t.name);

async function roleChat(harness: 'claude' | 'cursor'): Promise<SessionOptions> {
  const seen: SessionOptions[] = [];
  const m = new ChatManager({
    userData: tmp(), emitter: { emit: () => {} } as never, brainRoot: () => null,
    mcpUrlFor: id => `http://127.0.0.1:4000/mcp/chat/${id}/token`,
    sessionFactory: (h, options, s): HarnessSession => { seen.push(options); return { harness: h, state: 'idle', sessionId: options.sessionId ?? null, pid: null, root: null, busy: false, alive: true,
      start: () => { s.changed({ state: 'idle' }); }, send: () => {}, answer: () => false, interrupt: async () => {}, setModel: async () => {}, setPermissionMode: async () => {}, setEffort: async () => {},
      rename: async () => {}, contextUsage: async () => null, usage: async () => null, close: async () => {}, killNow: () => {} }; },
  });
  managers.push(m);
  const owner = { ...plainOwner(harness, null), source: 'catalog' as const, id: 'strategist', version: 1 };
  const chat = await m.create({ harness, cwd: tmp(), title: 'Ordini · Piano' }, 'agent', { owner, instructions: 'Pianifica.', policy: null });
  await m.send(chat.id, 'Fai il piano.');
  return seen.at(-1)!;
}

const d = {} as never;
/** the chat endpoint's tools as wiring.ts adds them (role-tools-matrix.test.ts's list) */
const CHAT: McpTool[] = [...delegationTools(d), ...strategyTools(d), ...workDecisionTools(d), agentCatalogTool(d), ...askTools(d), ...mailTools(d), artifactSaveTool(d),
  brainSearchTool(d), ...memoryTools(d), brainQueriesTool(d), chatQueryAddTool(d, d), brainScriptsTool(d), chatScriptAddTool(d, d), showUiTool(d),
  new QuestionRelay(d).tool()] as McpTool[];
const tokens = (tools: readonly McpTool[]): number => Math.round(toolListSize(tools) / 4);
const view = (role: string | null, o: { orchestrator?: boolean; child?: boolean; plan?: boolean } = {}) => ({
  s: { isOrchestrator: !!o.orchestrator, research: false, ...(role ? { agent: { id: role, source: 'catalog' as const } } : {}), ...(o.child ? { parentId: 'p' } : {}), ...(o.plan ? { plan: { phase: 'proposed' } } : {}) } as never,
  need: requiredTools({ role, isOrchestrator: !!o.orchestrator, child: !!o.child, plan: !!o.plan, appAsks: false }),
});

describe('#492 point 2: the required app tool schemas are always loaded, the rest stays deferred', () => {
  it('a mount marks only the names its alwaysLoad gives for this chat, keeping their own _meta; true marks all; none, nothing', async () => {
    const tools = [tool('agent_report'), tool('plan_propose', { 'anthropic/searchHint': 'plan' }), tool('brain_search')];
    const per = await list({ name: 'browser-chat', instructions: '', tools, alwaysLoad: p => p.chatId === 'c1' ? ['agent_report', 'plan_propose'] : [] });
    expect(marked(per)).toEqual(['agent_report', 'plan_propose']);
    expect(per[1]!._meta).toMatchObject({ 'anthropic/searchHint': 'plan' });
    expect(per[2]!._meta).toBeUndefined();
    expect(marked(await list({ name: 'browser-chat', instructions: '', tools, alwaysLoad: () => [] }, 'c2'))).toEqual([]);
    expect(marked(await list({ name: 'x', instructions: '', tools, alwaysLoad: true }))).toEqual(['agent_report', 'plan_propose', 'brain_search']);
    expect((await list({ name: 'other', instructions: '', tools }))[0]!._meta).toBeUndefined();
  });

  it('the tools that failed are each on their chat\'s required list', () => {
    expect(view('scout', { child: true }).need).toContain('agent_report');
    expect(view('strategist').need).toContain('agent_delegate');
    expect(view('strategist', { plan: true }).need).toEqual(expect.arrayContaining(['plan_propose', 'agent_delegate']));
    expect(ORCHESTRATOR_APP_REQUIRED).toEqual(expect.arrayContaining(['app_create_chat', 'app_config']));
  });

  it('a Claude role chat\'s --mcp-config loads no whole server upfront; Cursor gets the same endpoint', async () => {
    const args = new ClaudeSession(await roleChat('claude'), { changed: () => {} } as never).args();
    const servers = JSON.parse(args[args.lastIndexOf('--mcp-config') + 1]!).mcpServers as Record<string, { url: string; alwaysLoad?: boolean }>;
    expect(servers['second-brain']!.url).toContain('/mcp/chat/');
    expect(Object.values(servers).some(s => s.alwaysLoad)).toBe(false);
    const cursor = JSON.parse((await roleChat('cursor')).mcpConfig!).mcpServers as Record<string, { url: string }>;
    expect(cursor['second-brain']!.url).toContain('/mcp/chat/');
  });

  it('what is loaded upfront, in tokens: a fraction of every schema (worker, Strategist, Orchestrator)', () => {
    const shown = (v: ReturnType<typeof view>) => CHAT.filter(t => toolShownToChat(v.s, undefined, t.name));
    const upfront = (v: ReturnType<typeof view>) => shown(v).filter(t => v.need.includes(t.name));
    const worker = view('artisan', { child: true }), strategist = view('strategist', { plan: true }), orch = view(null, { orchestrator: true });
    const app = appControlTools({ chats: { list: () => [], items: () => [] } as never, browser: { list: () => [] } as never, brain: d, window: () => null, emitUi: () => {}, version: '0', config: {} }, 'o') as unknown as McpTool[];
    const appUp = app.filter(t => ORCHESTRATOR_APP_REQUIRED.includes(t.name));
    const m = {
      worker: [tokens(shown(worker)), tokens(upfront(worker))],
      strategist: [tokens(shown(strategist)), tokens(upfront(strategist))],
      orchestrator: [tokens(shown(orch)) + tokens(app), tokens(upfront(orch)) + tokens(appUp)],
    };
    // every schema (the first commit of ADR 0371) against the required ones (this one). Measured 2026-11-27, of the tools
    // built here (no browser tools, no connectors: the real full lists are larger): worker 5.9k → 2.5k, Strategist with
    // a plan 10.5k → 5.2k, Orchestrator 10.7k → 6.7k
    for (const [all, up] of Object.values(m)) expect(up).toBeLessThan(all * 0.7);
    expect(m.worker[1]).toBeLessThan(4_000);
    expect(m.strategist[1]).toBeLessThan(9_000);
    expect(m.orchestrator[1]).toBeLessThan(14_000);
  });
});
