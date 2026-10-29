// An Orchestrator on Cursor really drives the app (the user, 2026-10-11: "orchestrator con cursor che apre chat cursor o claude"):
// the real ChatManager, the real MCP server with the app-control tools on /mcp/app, the fake Cursor CLI that calls
// app_create_chat (a role) over HTTP like the real agent does with the server it gets in session/new; each role chat
// starts on its role's engine. No real CLI, no tokens.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import { McpServer, type McpTool } from '../../../src/main/mcp/server';
import { appControlTools } from '../../../src/main/appctl/tools';
import { routeChat, type RouteRequest } from '../../../src/main/brain/routing';
import type { BrainService, BrowserService } from '../../../src/main/services';
import { AgentCatalogService } from '../../../src/main/agents/catalog';
import type { AgentModelChoice } from '../../../src/shared/agents';
import { FAKE, FAKE_CURSOR, cursorLog, fakeLog, recEmitter, tmp, waitFor } from './helpers';

const live: { m: ChatManager; mcp: McpServer }[] = [];
afterEach(async () => {
  for (const x of live.splice(0)) { await x.m.shutdown(200); x.mcp.close(); }
});

/** The real role catalog: Scout on Claude, Artisan on Cursor (the user's choice in Brain → Agenti). */
function roles(userData: string): AgentCatalogService {
  const engine = (e: string): AgentModelChoice => ({ engine: e, label: e, enabled: true, trusted: true, effort: e === 'claude', defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: [], installed: true, authenticated: true });
  const c = new AgentCatalogService({ userData, models: () => [engine('claude'), engine('cursor')] });
  const artisan = c.list().profiles.find(p => p.id === 'artisan')!;
  c.save({ ...artisan, engine: 'cursor' }, 'artisan');
  return c;
}

async function setup(cross = true) {
  const userData = tmp('ud'), home = tmp('home'), cwd = tmp('cwd');
  const claudeLog = path.join(userData, 'claude.jsonl'), curLog = path.join(userData, 'cursor.jsonl');
  const mcp = new McpServer({ name: 'second-brain', version: '0' });
  const port = await mcp.listen(0);
  const m = new ChatManager({
    emitter: recEmitter(), userData, enginePaths: { claude: FAKE, cursor: FAKE_CURSOR }, claudeHome: home,
    appMcpUrl: () => `http://127.0.0.1:${port}/mcp/app`,
    env: { CLAUDE_CONFIG_DIR: home, FAKE_CLAUDE_LOG: claudeLog, FAKE_CURSOR_LOG: curLog, CURSOR_CONFIG_DIR: tmp('cursor-user') },
  });
  const brain = { routingInfo: () => ({ registry: null }), route: (req: RouteRequest) => routeChat(req, null, null, null), settings: () => ({ messaging: { crossHarness: cross }, engineOn: { claude: true, cursor: true }, engines: { claude: true, cursor: true }, orchestratorChats: { harness: 'claude', claudeModel: '', cursorModel: '', claudeEffort: '' } }), info: () => ({ brainRoot: cwd }) } as unknown as BrainService;
  const catalog = roles(tmp('roles'));
  const tools = appControlTools({ chats: m, browser: { list: () => [] } as unknown as BrowserService, brain, window: () => null, emitUi: () => {}, version: '0', agents: () => catalog.list(), resolveRole: req => catalog.resolve(req) });
  mcp.mount('/mcp/app', { name: 'app', instructions: 'app', tools: tools.map((t): McpTool => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as Record<string, unknown>, run: async a => JSON.stringify(await t.run(a)) })) });
  live.push({ m, mcp });
  return { m, cwd, claudeLog, curLog };
}

const call = (roleId: string, title: string) => `mcpcall second-brain-app app_create_chat ${JSON.stringify({ title, prompt: 'ciao', roleId })}`;

describe('an Orchestrator on Cursor', () => {
  it('gets the app tools and delegates role chats on both engines, each on its role\'s engine', async () => {
    const { m, cwd, claudeLog, curLog } = await setup();
    const orchestrator = await m.create({ harness: 'cursor', cwd, title: 'Orchestrator', orchestrator: true, prompt: [call('scout', 'Prova · Claude'), call('artisan', 'Prova · Cursor')].join('\n') });
    await waitFor(() => m.list().length === 3 && m.items(orchestrator.id).filter(i => i.kind === 'tool' && i.status !== 'running').length === 2, 'two chats created by the Orchestrator', 20000);

    const made = m.list().filter(c => c.id !== orchestrator.id);
    expect(made.map(c => [c.title, c.harness, c.isOrchestrator])).toEqual([['Prova · Claude', 'claude', false], ['Prova · Cursor', 'cursor', false]]);
    expect(m.list().filter(c => c.isOrchestrator).map(c => c.id)).toEqual([orchestrator.id]); // still one Orchestrator
    // the Orchestrator's two tool calls succeeded (shown in its transcript)
    expect(m.items(orchestrator.id).filter(i => i.kind === 'tool').map(i => (i.kind === 'tool' ? i.status : ''))).toEqual(['ok', 'ok']);
    // both chats really started, each on its own engine
    await waitFor(() => fakeLog(claudeLog).some(l => l.argv), 'claude chat started');
    await waitFor(() => cursorLog(curLog).filter(l => l.method === 'session/new').length === 2, 'cursor chat started');
    // only the Orchestrator's Cursor session got the app server
    const news = cursorLog(curLog).filter(l => l.method === 'session/new').map(l => (l.params?.mcpServers as { name: string }[]).map(s => s.name));
    expect(news).toEqual([['second-brain-app'], []]);
  }, 40000);

  it('with cross-engine messaging off, role chats still start on both enabled engines', async () => {
    const { m, cwd } = await setup(false);
    const orchestrator = await m.create({ harness: 'cursor', cwd, title: 'Orchestrator', orchestrator: true, prompt: [call('scout', 'No · Claude'), call('artisan', 'Si · Cursor')].join('\n') });
    await waitFor(() => m.items(orchestrator.id).filter(i => i.kind === 'tool' && i.status !== 'running').length === 2, 'both calls answered', 20000);
    expect(m.list().filter(c => c.id !== orchestrator.id).map(c => [c.title, c.harness])).toEqual([['No · Claude', 'claude'], ['Si · Cursor', 'cursor']]);
    const tools = m.items(orchestrator.id).filter(i => i.kind === 'tool');
    expect(tools.map(i => (i.kind === 'tool' ? i.status : ''))).toEqual(['ok', 'ok']);
  }, 40000);
});
