// Builds the services and connects them: chats get their own browser MCP endpoint, app-chat events reach the live feed,
// the app-control tools are mounted on the same local MCP server. Used by index.ts (one call at start).
// SB_DEMO=1 swaps in the demo services (demo-wiring.ts: fake chats, brain and browser tabs; SB_DEMO_FREEZE=1 = deterministic).
import type { BrowserWindow } from 'electron';
import { app } from 'electron';
import type { CliStatus } from '../shared/contract';
import { claudeStatus, cursorStatus } from './cli';
import { ChatManager, type TurnEndInfo } from './chats/manager';
import type { Emitter } from './ipc';
import type { BrainService, BrowserService, ChatService } from './services';
import { createBrain } from './brain';
import type { McpServer, McpTool, ToolOutput } from './mcp/server';
import { createBrowserModule, mcpPortFromEnv } from './browser/service';
import { appControlTools, type ToolOut } from './appctl/tools';
import { createDemoServices } from './demo-wiring';
import { ProductSync } from './sync';
import path from 'node:path';

export interface Ctx { emitter: Emitter; window: () => BrowserWindow | null; userData: string }
export interface Wired {
  chats: ChatService; browser: BrowserService; brain: BrainService;
  /** The local MCP server: browser routes, /mcp/app (app control). */
  mcp: McpServer;
  cli(): { claude: CliStatus; cursor: CliStatus } | null;
  shutdown(): Promise<void>;
  /** synchronous: kills every child process tree now (app quit, belt and braces after shutdown) */
  killNow(): void;
}

/** app-control results → MCP tool output (objects as JSON text, screenshots as images with their captions). */
export function toMcp(out: ToolOut): ToolOutput {
  if (typeof out === 'string') return out;
  if (out && typeof out === 'object' && 'images' in out && Array.isArray((out as { images?: unknown }).images)) {
    const o = out as { text?: string; images: { data: string; mimeType: string; caption?: string }[] };
    return { text: [o.text ?? '', ...o.images.map((im, i) => `image ${i + 1}: ${im.caption ?? ''}`)].filter(Boolean).join('\n'), images: o.images.map(({ data, mimeType }) => ({ data, mimeType })) };
  }
  return JSON.stringify(out, null, 1);
}

export async function createServices(ctx: Ctx): Promise<Wired> {
  if (process.env.SB_DEMO === '1') return createDemoServices(ctx);
  let cliCache: { claude: CliStatus; cursor: CliStatus } | null = null;
  // not in e2e tests: a pending CLI check would delay the app exit by seconds
  if (!process.env.SB_TEST) void Promise.all([claudeStatus(), cursorStatus()]).then(([claude, cursor]) => { cliCache = { claude, cursor }; });

  const { service: browser, mcp } = await createBrowserModule({ emitter: ctx.emitter, window: ctx.window, userData: ctx.userData, port: mcpPortFromEnv() });
  // the brain's chats.mjs poll leaves out the app's own chats (bound below, once the chat manager exists)
  let isOwn: (id: string) => boolean = () => false;
  const brain: BrainService = await createBrain({ emitter: ctx.emitter, window: ctx.window, userData: ctx.userData, skipChat: id => isOwn(id) });

  // Claude chats through the user's own `claude` CLI (SB_CLAUDE_PATH: a fake CLI for e2e tests); each chat gets its own
  // browser endpoint, so it sees and drives only its tabs.
  const manager = new ChatManager({
    emitter: ctx.emitter,
    userData: ctx.userData,
    ...(process.env.SB_CLAUDE_PATH ? { claudePath: process.env.SB_CLAUDE_PATH } : {}),
    ...(process.env.SB_CURSOR_PATH ? { cursorPath: process.env.SB_CURSOR_PATH } : {}),
    appVersion: app.getVersion(),
    mcpUrlFor: chatId => browser.mcpUrlFor(chatId),
    // brain hooks: plan limits, the job ledger (estimate vs actual), the live feed and notifications
    onRateLimit: msg => brain.ingestRateLimits(msg),
    estimateFor: req => brain.estimate(req),
    onTurnEnd: info => {
      const job = jobs.get(info.chatId) ?? { usd: 0, ms: 0, turns: 0, prompt: info.firstPrompt, kind: info.kind };
      job.usd += info.costUsd; job.ms += info.durationMs; job.turns += info.turns;
      jobs.set(info.chatId, job);
      const est = manager.list().find(c => c.id === info.chatId)?.estimate ?? null;
      brain.recordJob({
        ...(info.sessionId ? { id: `${info.harness}:${info.sessionId}` } : {}), harness: info.harness, model: info.model, effort: info.effort,
        ...(job.prompt ? { prompt: job.prompt } : {}), ...(job.kind ? { kind: job.kind } : {}), estimate: est,
        actual: { usd: job.usd, minutes: Math.round(job.ms / 6000) / 10, tokensIn: null, tokensOut: null, turns: job.turns },
      });
    },
    onWaiting: (chatId, p) => brain.publish([{ kind: 'question', title: titleOf(chatId), detail: p.title, chatId }]),
    onDone: chatId => brain.publish([{ kind: 'chat-done', title: titleOf(chatId), detail: 'ha finito il turno', chatId }]),
  });
  const jobs = new Map<string, { usd: number; ms: number; turns: number; prompt: string | undefined; kind: TurnEndInfo['kind'] }>();
  const titleOf = (chatId: string) => manager.list().find(c => c.id === chatId)?.title ?? 'Chat';
  isOwn = id => manager.isOwnSession(id);
  // a closed chat's browser tabs go away and its per-chat MCP token stops working
  const closeChat = manager.close.bind(manager);
  manager.close = async (chatId: string) => { await closeChat(chatId); browser.forgetChat(chatId); };
  const chats: ChatService = manager;
  // browser events for the live feed ("rifai l'accesso a example-test-3")
  browser.setFeed(e => brain.publish([e]));

  const appTools = appControlTools({
    chats, browser, brain, window: ctx.window, version: app.getVersion(),
    emitUi: cmd => ctx.emitter.emit('ui:command', cmd),
  });
  mcp.mount('/mcp/app', {
    name: 'app',
    instructions: 'Control and inspect the second-brain app itself: state, chats, open questions (read-only), feed, logs, screenshots, UI. It can never answer questions or permissions.',
    tools: appTools.map((t): McpTool => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as Record<string, unknown>, run: async a => toMcp(await t.run(a)) })),
  });

  // GitHub sync outcomes + product changes in the brain (stable instance only, never in tests): src/main/sync.ts
  let sync: ProductSync | null = null;
  if (process.env.SB_RELEASE && !process.env.SB_TEST) {
    sync = new ProductSync({ base: path.join(process.env.LOCALAPPDATA ?? ctx.userData, 'second-brain'), brainRoot: () => brain.info().brainRoot, brain, nodeExe: process.execPath });
    sync.start();
  }

  return {
    chats, browser, brain, mcp,
    // computed once in the background at start (spawning the CLIs takes seconds); cli:status gives a fresh one
    cli: () => cliCache,
    shutdown: async () => { sync?.stop(); await Promise.allSettled([chats.shutdown(), browser.shutdown(), brain.shutdown()]); },
    killNow: () => manager.killAll(),
  };
}
