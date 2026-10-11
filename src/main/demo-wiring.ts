// Builds the demo services (SB_DEMO=1; SB_DEMO_FREEZE=1 = deterministic) from demo.ts (chats, brain) and
// demo-browser.ts (tabs as real WebContentsViews), with the real settings store and a real local MCP server where the
// app-control tools are mounted (/mcp/app), so agents can drive the demo like the app. Why: one entry point for
// wiring.ts's demo branch. Also exposes globalThis.__sbDemo for e2e tests (the last views:layout the UI sent, the
// views' visibility, a way to open a hand-off or a new question) and, when frozen, tells the UI the fixed clock after
// every page load (ui:command 'clock').
import { app } from 'electron';
import type { CliStatus, PendingRequest } from '../shared/contract';
import { appControlTools } from './appctl/tools';
import { ConfigStore } from './brain/config';
import { DemoBrain, DemoChats, FROZEN_EPOCH, seed, type Emit } from './demo';
import { DemoBrowser } from './demo-browser';
import { log, errText } from './log';
import { McpServer, mcpPortFromEnv, type McpTool } from './mcp/server';
import { toMcp, type Ctx, type Wired } from './wiring';

const demoCli = (version: string, account: string): CliStatus => ({ found: true, path: '(demo)', version, loggedIn: true, account });

export async function createDemoServices(ctx: Ctx): Promise<Wired> {
  const freeze = process.env.SB_DEMO_FREEZE === '1';
  const now = freeze ? () => FROZEN_EPOCH : () => Date.now();
  const s = seed(now());
  const emit: Emit = (ch, p) => ctx.emitter.emit(ch, p);
  const chats = new DemoChats(emit, { freeze, now }, s);
  const browser = new DemoBrowser(ctx.window, emit, freeze, (chatId, tabIds) => { chats.patch(chatId, { browserTabIds: tabIds }); });
  chats.browser = browser;
  browser.seed(s.tabs, { 'tab-qa': 'nota', 'tab-sms': 'sms' });
  const brain = new DemoBrain(emit, chats, s, new ConfigStore(ctx.userData, { SB_MCP_PORT: process.env.SB_MCP_PORT }));
  chats.start();
  brain.start();

  const mcp = new McpServer({ name: 'second-brain-demo', version: app.getVersion() });
  const tools = appControlTools({ chats, browser, brain, window: ctx.window, version: app.getVersion(), emitUi: cmd => ctx.emitter.emit('ui:command', cmd) });
  mcp.mount('/mcp/app', {
    name: 'app', instructions: 'Control and inspect the second-brain app (demo data). It can never answer questions or permissions.',
    tools: tools.map((t): McpTool => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as Record<string, unknown>, run: async a => toMcp(await t.run(a)) })),
  });
  try { await mcp.listen(mcpPortFromEnv()); } catch (e) {
    log.warn('demo', 'MCP port busy, using a random one', { data: { error: errText(e) } });
    await mcp.listen(0);
  }
  browser.mcpUrl = `http://127.0.0.1:${mcp.port}/mcp`;

  const wc = ctx.window()?.webContents;
  if (freeze && wc) wc.on('did-finish-load', () => ctx.emitter.emit('ui:command', { action: 'clock', value: String(FROZEN_EPOCH) }));
  (globalThis as Record<string, unknown>).__sbDemo = {
    freeze,
    layout: () => browser.lastLayout(),
    views: () => browser.views(),
    handoff: (tabId: string, reason: string, instructions: string) => browser.openHandoff(tabId, s.tabs.find(t => t.id === tabId)?.ownerChatId ?? null, reason, instructions, now()),
    /** an assistant message as a chat would stream it (e2e: markdown sanitizing) */
    say: (chatId: string, text: string) => chats.push(chatId, { kind: 'assistant', id: chats.nextId(), at: now(), text }),
    failNextAnswer: () => { chats.failNextAnswer = true; },
    clearThumbs: () => browser.clearThumbs(),
    /** a feed event, as the brain would publish it (e2e: toasts, notification center, badges) */
    event: (e: { kind: string; title: string; detail?: string; chatId?: string }) => brain.publish([e]),
    /** a new request from a chat (e2e: the global layer must show it without stealing focus) */
    ask: (chatId: string, req: Omit<PendingRequest, 'id' | 'chatId' | 'at'>) => { void chats.ask(chatId, req, new AbortController().signal).catch(() => {}); },
  };
  log.info('demo', 'demo services started', { data: { freeze, chats: s.chats.length, tabs: s.tabs.length, mcpPort: mcp.port } });

  return {
    chats, browser, brain, mcp,
    cli: () => ({ claude: demoCli('2.3.0 (demo)', 'demo@example.com'), cursor: demoCli('2026.10.01 (demo)', 'demo@example.com') }),
    shutdown: async () => { await Promise.allSettled([chats.shutdown(), browser.shutdown(), brain.shutdown(), mcp.close()]); },
    killNow: () => { void chats.shutdown(); }, // the demo starts no processes: stopping its timers is enough
  };
}
