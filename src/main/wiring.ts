// Builds the services and connects them: chats get their own browser MCP endpoint, app-chat events reach the live feed,
// the app-control tools are mounted on the same local MCP server. Used by index.ts (one call at start).
// SB_DEMO=1 swaps in the demo services (demo-wiring.ts: fake chats, brain and browser tabs; SB_DEMO_FREEZE=1 = deterministic).
import type { BrowserWindow } from 'electron';
import { app, safeStorage, shell } from 'electron';
import os from 'node:os';
import type { CliStatus, Harness } from '../shared/contract';
import { NEW_CHAT_RULE } from '../shared/newchat';
import { engineStatuses } from './cli';
import { anthropicApi, engineOf, enginePathsFromEnv, priceEnginesOf } from './engines/registry';
import { mountTextTool, TEXT_ENV } from './engines/text-mcp';
import { agentsMayOpen, crossRefusal, engineOn } from './engines/policy';
import { createEngines, type EnginesApi } from './engines/service';
import { safeStorageCipher } from './engines/secrets';
import { EngineSweeper } from './chats/sweep';
import { ChatManager } from './chats/manager';
import type { Emitter } from './ipc';
import type { BrainService, BrowserService, ChatService, DevopsApi, SkillsApi } from './services';
import { SkillsService } from './skills/service';
import { createBrain } from './brain';
import { setLaunchRules } from './brain/adapters/domains';
import { doneEvent } from './brain/live';
import { syncBeforeCreate } from './brain/sync';
import { predictionLine } from './brain/routing';
import { listPrice, setPriceTable } from './chats/live-cost';
import type { McpServer, McpTool, ToolOutput } from './mcp/server';
import { createBrowserModule, mcpPortFromEnv } from './browser/service';
import { appControlTools, regiaEndpointAuth, type ToolDef, type ToolOut } from './appctl/tools';
import { ChatMail, mailTools } from './chats/mail';
import { brainClassifier } from './chats/regia-delivery';
import { readRegiaMail } from './brain/brain-settings';
import { EndpointTokens } from './mcp/tokens';
import { createDemoServices } from './demo-wiring';
import { forcedSampler, OsLoadSampler } from './chats/admission';
import { ProductSync } from './sync';
import fs from 'node:fs';
import { CommandRunner } from './run/runner';
import { CommandAsks } from './run/asks';
import { RunResults } from './run/results';
import { RegiaWake } from './chats/regia-wake';
import { DevopsService } from './devops/service';
import { Quality } from './brain/quality';
import { cleanEnv, findNode, ImproveService, type ImproveDeps } from './improve/service';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { electronNode, runNode } from './brain/node';
import path from 'node:path';
import { log, errText } from './log';
import { AnswerLaterStore, REQUEST_KINDS } from './later';
import { Artifacts, showUiTool } from './genui/artifacts';
import { releaseId } from './release';
import { launcherName, restartWaiter, sharedDir } from './platform';
import { HeadlessRunner } from './compare/headless';
import { CompareQueue, queueAllowed } from './compare/queue';
import { COMPACT_WINDOW } from './brain/settings-schema';
import { setRecorder } from './chats/drift';

export interface Ctx { emitter: Emitter; window: () => BrowserWindow | null; userData: string }
export interface Wired {
  chats: ChatService; browser: BrowserService; brain: BrainService; devops: DevopsApi;
  /** the engines of the brain, which definitions the user turned on, the API keys (ADR 0046) */
  engines: EnginesApi;
  /** the chat folders' git branches ('chat:branches'); absent = read from disk (chats/branch.ts) */
  branches?: (cwds: unknown) => Record<string, string | null>;
  /** "Skill e agenti" (ADR 0018) */
  skills: SkillsApi;
  /** The local MCP server: browser routes, /mcp/app (app control). */
  mcp: McpServer;
  /** code blocks run by the user's click ("Esegui"), output streamed back (run:updated) */
  runner: CommandRunner;
  /** shell blocks a chat left for the user, as open requests ("Comando da eseguire", run/asks.ts) */
  asks: CommandAsks;
  /** "Eventi alla Regia": work chats' news wakes the Regia (chats/regia-wake.ts) */
  wake: RegiaWake;
  /** "Migliora l'app": branches, Aggiorna, the restart notice (ADR 0020) */
  improve: ImproveService;
  /** "Rispondi dopo" (main/later.ts, ADR 0035) */
  later: AnswerLaterStore;
  cli(): Record<Harness, CliStatus> | null;
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

/** The app-control tools on the local MCP server: /mcp/app for the work Regia, /mcp/improve for the Regia of
 *  "Migliora l'app" (its own chats, the branches' state). */
export function attachAppTools(mcp: McpServer, deps: Omit<Parameters<typeof appControlTools>[0], 'space' | 'improve'>, improve: ImproveService, demo = false, regiaTokens?: EndpointTokens): void {
  const as = (t: ToolDef): McpTool => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as Record<string, unknown>, run: async a => toMcp(await t.run(a)) });
  const what = demo ? 'the second-brain app (demo data)' : 'the second-brain app itself: state, chats, open questions (read-only), feed, logs, screenshots, UI';
  // NEW_CHAT_RULE: what the "Nuova chat" toggle of the Regia's input means (ADR 0034)
  const instructions = `Control and inspect ${what}. It can never answer questions or permissions. For a status or after a wake, call app_digest (since "last") once instead of reading chats one by one. ${NEW_CHAT_RULE}`;
  // /mcp/app: test agents (acts as the first Regia); /mcp/app/r/<id>/<token>: each work Regia's own, so the tools know
  // the caller (ADR 0021). Only an open Regia with its own token answers (the token lives only here and in its config).
  mcp.mount('/mcp/app', { name: 'app', instructions, tools: appControlTools(deps).map(as) });
  if (regiaTokens) {
    mcp.mount('/mcp/app/r/:chatId/:token', {
      name: 'app', instructions, authorize: regiaEndpointAuth(regiaTokens, () => deps.chats.list()), who: p => p.chatId,
      tools: c => appControlTools(deps, c.params.chatId).map(as),
    });
  }
  mcp.mount('/mcp/improve', {
    name: 'app',
    instructions: `"Migliora l'app": the Regia of the app's own improvements. Control and inspect ${what}, only the chats of this section; app_improve_state reads branches and versions. It can never answer questions or permissions, never promote nor restart the app. ${NEW_CHAT_RULE}`,
    tools: appControlTools({ ...deps, space: 'app', improve: { repo: () => improve.repo(), state: () => improve.refresh(), inRepo: dir => improve.inRepo(dir) } }).map(as),
  });
}

/** "Rispondi dopo" (main/later.ts): the flag, sent to the page as 'later:changed'. */
export const createLater = (ctx: Pick<Ctx, 'emitter' | 'userData'>): AnswerLaterStore =>
  new AnswerLaterStore(path.join(ctx.userData, 'answer-later.json'), st => ctx.emitter.emit('later:changed', st));

/** The runner of "Esegui": blocks are checked against the chat's own assistant messages, run in the chat's folder. */
export function commandRunner(ctx: Pick<Ctx, 'emitter'>, chats: ChatService): CommandRunner {
  return new CommandRunner({
    itemText: (chatId, itemId) => { const it = chats.items(chatId).find(i => i.id === itemId); return it?.kind === 'assistant' ? it.text : null; },
    cwdOf: chatId => chats.list().find(c => c.id === chatId)?.cwd ?? null,
    emit: run => ctx.emitter.emit('run:updated', run),
  });
}

/** "Comando da eseguire" requests (run/asks.ts): they watch every event main sends to the page (the emitter is tapped
 *  here, for the real app and the demo alike) and notify through the feed like a question ("Domanda per te"). */
export function attachCommandAsks(ctx: Pick<Ctx, 'emitter'>, runner: CommandRunner, brain: Pick<BrainService, 'publish'>, now?: () => number): CommandAsks {
  const send = ctx.emitter.emit.bind(ctx.emitter);
  const asks = new CommandAsks({
    // through the emitter as it is when called: the taps added later (the Regia's news) hear it too
    emit: (ch, p) => ctx.emitter.emit(ch, p),
    ran: (chatId, itemId, code) => runner.list(chatId).some(r => r.itemId === itemId && r.code === code),
    ...(now ? { now } : {}),
    onAsk: (req, title) => brain.publish([{ kind: 'question', title, detail: `Comando da eseguire: ${req.detail.split(/\r?\n/)[0] ?? ''}`, chatId: req.chatId }]),
  });
  ctx.emitter.emit = (ch, p) => { send(ch, p); asks.observe(ch, p); };
  return asks;
}

/** "Eventi alla Regia" (chats/regia-wake.ts): it watches the same events (the emitter tapped once more) and writes
 *  to the Regia through the chat service. on = the setting regiaEvents and, in tests, an explicit SB_REGIA_EVENTS=1
 *  (a test's Regia never gets surprise messages); SB_REGIA_EVENTS_MS shortens the grouping window for e2e. */
export function attachRegiaWake(ctx: Pick<Ctx, 'emitter'>, chats: Pick<ChatService, 'send' | 'list'>, on: () => boolean, now?: () => number): RegiaWake {
  const groupMs = Number(process.env.SB_REGIA_EVENTS_MS) || undefined;
  const wake = new RegiaWake({ send: (chatId, text) => chats.send(chatId, text), enabled: on, list: () => chats.list(), ...(groupMs ? { groupMs } : {}), ...(now ? { now } : {}) });
  const send = ctx.emitter.emit.bind(ctx.emitter);
  ctx.emitter.emit = (ch, p) => { send(ch, p); wake.observe(ch, p); };
  return wake;
}

/** "Esito alla chat" (run/results.ts): a run's end goes back to the chat that proposed the block. on = the setting
 *  runResults and, in tests, an explicit SB_RUN_RESULTS=1 (a test's chats never get surprise messages). */
export function attachRunResults(ctx: Pick<Ctx, 'emitter'>, chats: Pick<ChatService, 'send' | 'list'>, on: () => boolean): RunResults {
  const groupMs = Number(process.env.SB_RUN_RESULTS_MS) || undefined;
  const results = new RunResults({ send: (chatId, text) => chats.send(chatId, text), enabled: on, list: () => chats.list(), ...(groupMs ? { groupMs } : {}) });
  const send = ctx.emitter.emit.bind(ctx.emitter);
  ctx.emitter.emit = (ch, p) => { send(ch, p); results.observe(ch, p); };
  return results;
}

/** show_ui's visuals (ADR 0033, genui/artifacts.ts): kept per chat in userData, merged into the chat's items (chat:items),
 *  attached to the chat's next question by watching the events main sends to the page (the emitter tapped once more).
 *  SB_ASK_WAIT_MS shortens the wait for that question, only under SB_TEST (e2e). */
export function attachArtifacts(ctx: Pick<Ctx, 'emitter' | 'userData'>, chats: Pick<ChatService, 'list' | 'items'>, now?: () => number): Artifacts {
  const wait = Number(process.env.SB_ASK_WAIT_MS);
  const store = new Artifacts({
    dir: path.join(ctx.userData, 'artifacts'), chats: () => chats.list(), emit: (chatId, item) => ctx.emitter.emit('chat:item', { chatId, item }),
    ...(now ? { now } : {}), ...(process.env.SB_TEST === '1' && wait > 0 ? { askWaitMs: wait } : {}),
  });
  const send = ctx.emitter.emit.bind(ctx.emitter);
  ctx.emitter.emit = (ch, p) => { send(ch, p); store.observe(ch, p); };
  const items = chats.items.bind(chats);
  chats.items = chatId => store.merge(chatId, items(chatId));
  return store;
}

/** "Migliora l'app" (ADR 0020). Stable = started by the launcher (SB_RELEASE); SB_IMPROVE_STABLE=<release id> makes a
 *  test or demo run behave as that stable release (with SB_RELEASES_ROOT and SB_IMPROVE_REPO pointing at temp folders),
 *  and then a restart is only recorded (__sbImprove.restarts), never real. */
export function createImprove(ctx: Pick<Ctx, 'emitter' | 'userData'>, chats: Pick<ChatService, 'list' | 'create'>, appRepo: () => string | null, routing?: ImproveDeps['routing']): ImproveService {
  const fake = process.env.SB_IMPROVE_STABLE;
  const running = fake ?? releaseId() ?? 'dev';
  const releasesBase = process.env.SB_RELEASES_ROOT ?? sharedDir();
  const real = !!releaseId() && !fake && !process.env.SB_TEST;
  const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const devRepo = process.env.SB_IMPROVE_REPO ?? (fs.existsSync(path.join(outDir, '.git')) ? outDir : null);
  const recorder = { restarts: 0 };
  (globalThis as Record<string, unknown>).__sbImprove = recorder;
  return new ImproveService({
    userData: ctx.userData, releasesBase, running, stable: !!fake || !!releaseId(),
    appRepo: () => appRepo() ?? (fake ? devRepo : null), devRepo, chats, node: findNode(), ...(routing ? { routing } : {}),
    emit: st => ctx.emitter.emit('improve:state', st),
    restart: failed => {
      if (!real) { recorder.restarts++; log.info('improve', 'restart asked (test run: not restarting)'); return; }
      // the launcher starts the new current release (and falls back by itself) once this process is gone: this app
      // holds the single-instance lock until its quit ends (chats close, up to seconds), and a release started before
      // would exit at once and be marked bad (reviews 2026-10-12). After 60 s it starts anyway.
      const launcher = path.join(releasesBase, launcherName());
      const waiter = restartWaiter(process.pid, launcher);
      // quit only once the waiter really started: a powershell.exe that cannot start (blocked, missing) reports it
      // asynchronously, and the app must then stay open rather than close with nothing to reopen it (review 2026-10-12)
      const fail = (e: unknown) => { log.error('improve', 'launcher not started: the app stays open on the old version', { cause: errText(e), hint: `start it by hand: ${launcher}` }); failed(); };
      try {
        const child = spawn(waiter.command, waiter.args, { detached: true, stdio: 'ignore', windowsHide: true, env: cleanEnv(process.env) });
        child.once('error', fail);
        child.once('spawn', () => {
          child.unref();
          log.info('improve', 'restarting through the launcher', { data: { launcher } });
          app.quit();
        });
      } catch (e) { fail(e); }
    },
  });
}

export async function createServices(ctx: Ctx): Promise<Wired> {
  if (process.env.SB_DEMO === '1') return createDemoServices(ctx);
  // the dev instance records the shapes real CLIs send (sanitized, a few per kind): fixtures for the contract tests (ADR 0055)
  setRecorder(!releaseId() && !process.env.SB_TEST ? path.join(ctx.userData, 'cli-records') : null);
  let cliCache: Record<Harness, CliStatus> | null = null;
  // not in e2e tests: a pending CLI check would delay the app exit by seconds
  if (!process.env.SB_TEST) void engineStatuses().then(all => { cliCache = all; ctx.emitter.emit('cli:ready', all); });

  // the brain folder (bound below, once the brain exists) holds the credentials file of login hand-offs
  let brainRoot: () => string | null = () => null;
  const { service: browser, mcp, addChatTools } = await createBrowserModule({ emitter: ctx.emitter, window: ctx.window, userData: ctx.userData, port: mcpPortFromEnv(), brainRoot: () => brainRoot() });
  // the brain's chats.mjs poll leaves out the app's own chats (bound below, once the chat manager exists)
  let isOwn: (id: string) => boolean = () => false;
  // "Rispondi dopo": a new request's Windows notification is held while it is on (it waits in the queue)
  const later = createLater(ctx);
  // the brain's estimates run (and the sample judge it starts) gets the app's text endpoint on the user's API credits;
  // writing rows «Sui crediti API» get the Anthropic API engine when it may run (both bound below, ADR 0052)
  let scriptEnv: () => Record<string, string> = () => ({});
  let apiRoute: () => Harness | null = () => null;
  const brain: BrainService = await createBrain({ emitter: ctx.emitter, window: ctx.window, userData: ctx.userData, skipChat: id => isOwn(id), held: e => later.get().on && REQUEST_KINDS.has(e.kind),
    scriptEnv: () => scriptEnv(), apiRoute: () => apiRoute() });
  // the brain's rules each Claude / Codex chat gets at launch (ADR 0060): read at every start, so a switch or a new
  // brain folder counts from the next chat
  setLaunchRules(() => {
    const s = brain.settings();
    const root = brain.info().brainRoot;
    return { domains: root ? [{ name: 'brain', root }] : [], claude: s.launchRulesClaude === true, codex: s.launchRulesCodex !== false };
  });
  // the brain's engines are read before the chats restore: a chat on one of them can resume (ADR 0046)
  const engines = createEngines({ userData: ctx.userData, emitter: ctx.emitter, cipher: safeStorageCipher(safeStorage), brainRoot: () => brain.info().brainRoot, settings: brain });
  const textTool = mountTextTool(mcp, engines.text);
  scriptEnv = () => ({ [TEXT_ENV]: textTool.url() });
  apiRoute = () => { const e = anthropicApi(); return e && engineOn(brain.settings(), e.id) && engines.hasKey(e.id) ? e.id : null; };
  // live turn costs at the brain's per-model list prices (harness/models.json), re-read at most every 30 s
  let prices: { at: number; reg: ReturnType<BrainService['routingInfo']>['registry'] } = { at: 0, reg: null };
  setPriceTable(() => { if (Date.now() - prices.at > 30_000) prices = { at: Date.now(), reg: brain.routingInfo().registry }; return prices.reg; });

  // Claude chats through the user's own `claude` CLI (SB_CLAUDE_PATH: a fake CLI for e2e tests); each chat gets its own
  // browser endpoint, so it sees and drives only its tabs.
  // each Regia's app-control endpoint carries an unguessable token (ADR 0021): the URL names the caller, whose engine
  // decides the Claude <-> Cursor rule, so a local process may not pick another Regia's identity
  const regiaTokens = new EndpointTokens();
  const coldTest = process.env.SB_TEST && process.env.SB_COLD_MS ? process.env.SB_COLD_MS.split(',').map(Number) as [number, number, number] : null;
  const manager = new ChatManager({
    emitter: ctx.emitter,
    userData: ctx.userData,
    enginePaths: enginePathsFromEnv(),
    // an engine the user switched off never starts, whoever asks (engines/policy.ts)
    engineOn: h => engineOn(brain.settings(), h),
    agentsMayOpen: h => agentsMayOpen(brain.settings(), h),
    // the user's API key, only for its own engine's process or request (engines/secrets.ts)
    keyFor: h => engines.keyFor(h),
    appVersion: app.getVersion(),
    // one Claude engine started ahead for the next new chat (chats/warm.ts: 10-25 s of CLI start-up measured,
    // 2026-10-13); never with the fake CLI of the e2e tests; SB_PREWARM=0 turns it off
    prewarm: !process.env.SB_CLAUDE_PATH && process.env.SB_PREWARM !== '0',
    mcpUrlFor: chatId => browser.mcpUrlFor(chatId),
    // agents' new chats and turns wait while the machine is busy (ADR 0036); SB_LOAD_FORCE="cpu,freeRam" fixes the load
    // for the e2e suite
    admission: {
      sampler: forcedSampler(process.env.SB_LOAD_FORCE) ?? new OsLoadSampler(),
      limits: () => { const st = brain.settings(); return { enabled: st.loadQueue !== false, cpu: st.loadQueueCpu ?? 75, ram: st.loadQueueRam ?? 15 }; },
    },
    // the Regia also gets the app-control tools (create work chats, read the app): /mcp/app on the same server
    appMcpUrl: (regiaId, space) => browser.mcpUrlFor(null).replace(/\/mcp$/, space === 'app' ? '/mcp/improve' : `/mcp/app/r/${regiaId}/${regiaTokens.tokenFor(regiaId)}`),
    // brain hooks: plan limits, the job ledger (real cost and time), the live feed and notifications
    onRateLimit: msg => brain.ingestRateLimits(msg),
    onModels: (h, list) => brain.recordModels(h, list),
    acpModelConfig: () => { const r = brain.settings().regiaChats; return { reasoning: r.cursorReasoning, fast: r.cursorFast }; },
    onTurnEnd: info => {
      // an API engine's turn spends the user's API credits: this month's figure in Settings → Motori (engines/spend.ts)
      const api = engineOf(info.harness);
      if (api?.kind === 'api') engines.addSpend(info.harness, info.model && listPrice(priceEnginesOf(api), info.model) ? info.costUsd : null);
      const job = jobs.get(info.chatId) ?? { usd: 0, turns: 0, prompt: info.firstPrompt };
      job.usd += info.costUsd; job.turns += info.turns;
      jobs.set(info.chatId, job);
      brain.recordJob({
        ...(info.sessionId ? { id: `${info.harness}:${info.sessionId}` } : {}), harness: info.harness, model: info.model, effort: info.effort,
        ...(job.prompt ? { prompt: job.prompt } : {}),
        // minutes = real work time (running, not waiting for the user's answers), the same the tile shows
        actual: { usd: job.usd, minutes: Math.round(manager.workMs(info.chatId) / 6000) / 10, minutesKind: 'work', tokensIn: null, tokensOut: null, turns: job.turns },
      });
      // a chat an agent routed (app_create_chat): its prediction once, then its measured actuals at every turn end, in
      // the improvement loop's ledger (ops/state/improve/outcomes.jsonl; the same id, later line wins; ADR 0032)
      const chat = manager.list().find(c => c.id === info.chatId);
      if (chat?.route) {
        // a chat that continues a routed one writes on the first chat's line; totals carry over a restart or a hand-off
        // (the ledger keeps the later line, so a line must never restart from zero)
        const id = chat.route.ledgerId ?? `app:${chat.id}`;
        let base = routedBase.get(chat.id);
        if (!base) {
          const last = brain.lastRoutingActual(id);
          base = { usd: last?.usd ?? 0, turns: last?.turns ?? 0, minutes: last?.minutes ?? 0, ctxPeak: last?.ctxPeak ?? 0 };
          routedBase.set(chat.id, base);
          // the prediction once per job: the first chat of the chain, at its first turn end (a restart repeats it, same id)
          if (!chat.route.ledgerId) brain.observeRouting(predictionLine(chat.route, { id, harness: chat.harness, model: chat.model, effort: chat.effort, promptChars: job.prompt?.length ?? null }));
        }
        base.ctxPeak = Math.max(base.ctxPeak, chat.contextTokens ?? 0);
        brain.observeRouting({ id, domain: 'routing', outcome: { known: false, source: 'measured' }, actual: {
          usd: Math.round((base.usd + job.usd) * 1e4) / 1e4, minutes: Math.round((base.minutes + manager.workMs(info.chatId) / 60_000) * 10) / 10,
          turns: base.turns + job.turns, ctxPeak: base.ctxPeak || null, handoffs: chat.route.handoffs ?? 0,
        } });
      }
    },
    onWaiting: (chatId, p) => brain.publish([{ kind: 'question', title: titleOf(chatId), detail: p.title, chatId }]),
    onDone: chatId => { const e = doneEvent(manager.list().find(c => c.id === chatId)); if (e) brain.publish([e]); },
    onCrash: (chatId, error) => { const e = doneEvent(manager.list().find(c => c.id === chatId), error); if (e) brain.publish([e]); },
    // long chats (ADR 0031): the compaction window of every Claude engine and the invisible continuation of cold chats
    // are settings; a manual hand-off asks to update the brain's now.md. SB_COLD_MS=<idle>,<ttl>,<every> shortens the
    // cold timers for the e2e suite (SB_TEST only)
    compactWindowTokens: () => brain.settings().compactWindowTokens ?? COMPACT_WINDOW,
    coldHandoff: () => brain.settings().contextHandoff,
    regiaDayCompact: () => brain.settings().regiaDayCompact !== false,
    coldIdleMs: () => coldTest?.[0] ?? (brain.settings().coldHandoffMin ?? 50) * 60_000,
    ...(coldTest ? { cacheTtlMs: coldTest[1], coldEveryMs: coldTest[2] } : {}),
    memTool: () => {
      const root = brain.info().brainRoot;
      const tool = root ? path.join(root, 'ops', 'tools', 'mem.mjs') : null;
      return tool && fs.existsSync(tool) ? tool : null;
    },
  });
  const jobs = new Map<string, { usd: number; turns: number; prompt: string | undefined }>();
  // a routed chat's totals already in the ledger when this run first saw it (after a restart, or its predecessor's)
  const routedBase = new Map<string, { usd: number; turns: number; minutes: number; ctxPeak: number }>();
  const titleOf = (chatId: string) => manager.list().find(c => c.id === chatId)?.title ?? 'Chat';
  isOwn = id => manager.isOwnSession(id);
  // a closed chat's browser tabs go away and its per-chat MCP token stops working
  const closeChat = manager.close.bind(manager);
  manager.close = async (chatId: string) => { await closeChat(chatId); browser.forgetChat(chatId); };
  // an archived chat's browser tabs close too; its MCP token and the environment's sign-in stay, so a reopen continues
  const archiveChat = manager.archive.bind(manager);
  manager.archive = async (chatId, o) => {
    const c = await archiveChat(chatId, o);
    for (const t of browser.list()) if (t.ownerChatId === chatId) browser.close(t.id);
    return c;
  };
  // brain domains (ADR 0059): a new chat reads the brain, so the remote's changes land first (bounded, throttled)
  syncBeforeCreate(manager, () => brain.syncBeforeRead());
  const chats: ChatService = manager;
  // idle engines released after engineIdleMin, orphans of ended engines swept every 15 min (ADR 0026; zero tokens)
  const sweeper = new EngineSweeper({ userData: ctx.userData, owners: () => manager.engines(), releaseIdle: ms => manager.releaseIdle(ms), idleMin: () => brain.settings().engineIdleMin ?? 30 });
  if (!process.env.SB_TEST) sweeper.start();
  // browser events for the live feed ("rifai l'accesso a example-test-3")
  browser.setFeed(e => brain.publish([e]));
  brainRoot = () => brain.info().brainRoot;
  // the user answered a hand-off after the chat's agent stopped waiting: a message wakes the chat
  browser.setWake((chatId, text) => { void chats.send(chatId, text).catch(e => log.warn('browser', 'could not wake the chat after a hand-off', { chat: chatId, cause: errText(e), hint: 'the chat is closed or failed to start: open it and tell it yourself' })); });

  // mail between chats in real time: inbox.mjs mail goes to the app's live chats at once, and every chat gets
  // send_to_chat / list_chats on its own MCP endpoint (chats/mail.ts)
  // the words that time the mail to a Regia come from the brain (chats/regia-delivery.ts)
  const classify = brainClassifier(() => { const root = brain.info().brainRoot; return root ? readRegiaMail(root) : undefined; });
  const mail = new ChatMail({ root: () => brain.info().brainRoot, chats, instance: path.basename(ctx.userData), classify });
  addChatTools(mailTools({ classify,
    root: () => brain.info().brainRoot, chats: () => chats.list(), crossRefusal: (from, to) => crossRefusal(brain.settings(), from, to),
    agentsMayOpen: h => agentsMayOpen(brain.settings(), h),
    deliver: () => { void mail.tick(); }, chainOf: box => mail.chainOf(box),
  }));
  mail.start();
  // show_ui on every chat's own endpoint: a visual from the catalog instead of a wall of text (ADR 0033)
  const artifacts = attachArtifacts(ctx, chats);
  addChatTools([showUiTool(artifacts)]);

  const runner = commandRunner(ctx, chats);
  const asks = attachCommandAsks(ctx, runner, brain);
  const wake = attachRegiaWake(ctx, chats, () => brain.settings().regiaEvents !== false && (!process.env.SB_TEST || process.env.SB_REGIA_EVENTS === '1'));
  const results = attachRunResults(ctx, chats, () => brain.settings().runResults !== false && (!process.env.SB_TEST || process.env.SB_RUN_RESULTS === '1'));
  const improve = createImprove(ctx, chats, () => brain.settings().appRepo ?? null, { route: r => brain.route(r), engineOn: h => engineOn(brain.settings(), h), agentsMayOpen: h => agentsMayOpen(brain.settings(), h) });
  attachAppTools(mcp, { chats, browser, brain, window: ctx.window, version: app.getVersion(), runs: chatId => runner.list(chatId), commandAsks: () => asks.pending(), emitUi: cmd => ctx.emitter.emit('ui:command', cmd), devops: () => devops.get() }, improve, false, regiaTokens);

  // DevOps page: the brain's read-only devops-me.mjs as a Node child (no AI, no tokens); on a timer only when turned on
  const node = electronNode();
  const devops = new DevopsService({
    file: path.join(ctx.userData, 'devops.json'),
    brainRoot: () => brain.info().brainRoot,
    settings: () => brain.settings().devops,
    run: (script, args, cwd, ms) => runNode(node, script, args, cwd, ms),
    emit: st => ctx.emitter.emit('devops:state', st),
    feed: events => brain.publish(events),
  });
  brain.onSettingChange(c => { if (c.key.startsWith('devops.') || c.key === 'brainRoot') devops.schedule(); });
  devops.schedule();
  // Qualità page's app half (/api/quality): this app's turns, the PRs of the last DevOps read, the brain's bug-reopen.mjs
  const quality = new Quality({
    logDir: path.join(ctx.userData, 'logs'), cacheFile: path.join(ctx.userData, 'quality-reopen.json'), brainRoot: () => brain.info().brainRoot,
    devops: () => devops.get(), run: (script, args, cwd, ms) => runNode(node, script, args, cwd, ms),
  });
  brain.serveApi('/api/quality', q => quality.get({ fresh: q.get('fresh') === '1' }));

  // "Skill e agenti" (ADR 0018): the user's ~/.claude and ~/.cursor (SB_SKILLS_HOME: a fixture home for tests), the
  // brain folder and the chats' folders; deletes go to the Recycle Bin (tests delete for real)
  const skills = new SkillsService({
    home: process.env.SB_SKILLS_HOME || os.homedir(),
    roots: () => [brain.info().brainRoot, ...chats.list().map(c => c.cwd)],
    trash: p => (process.env.SB_TEST ? fs.promises.rm(p, { recursive: true, force: true }) : shell.trashItem(p)),
  });

  // the comparison's side b (ADR 0046 §4): the runs the brain queues (harness/compare/app-queue.mjs), each a hidden
  // read-only session on an engine the user turned on, with the app's own logins and keys (compare/headless.ts)
  const headless = new HeadlessRunner({
    userData: ctx.userData, settings: () => brain.settings(), keyFor: h => engines.keyFor(h), enginePaths: () => enginePathsFromEnv(), appVersion: app.getVersion(), registry: () => brain.routingInfo().registry,
    // the other side's answers and the verdicts: never read by a run, whatever the brain lists
    denyRead: () => { const root = brain.info().brainRoot; return root ? [path.join(root, 'reviews', 'compare')] : []; },
  });
  const compareRuns = new CompareQueue({
    brainRoot: () => brain.info().brainRoot, node, runner: headless,
    anyOn: async () => { const st = await brain.compareList(); return st.ok && st.experiments.some(e => e.on); },
  });
  // only the user's stable app spends tokens on the brain's rounds (the dev instance is run by agents and tests)
  if (queueAllowed(!!releaseId(), process.env)) compareRuns.start();

  // GitHub sync outcomes + product changes in the brain (stable instance only, never in tests): src/main/sync.ts
  let sync: ProductSync | null = null;
  if (releaseId() && !process.env.SB_TEST && process.env.SB_NO_SYNC !== '1') {
    sync = new ProductSync({ base: sharedDir(), brainRoot: () => brain.info().brainRoot, brain, nodeExe: process.execPath });
    sync.start();
  }

  return {
    chats, browser, brain, mcp, runner, asks, wake, devops, skills, improve, later, engines,
    // computed once in the background at start (spawning the CLIs takes seconds); cli:status gives a fresh one
    cli: () => cliCache,
    shutdown: async () => { engines.stop(); sweeper.stop(); artifacts.stop(); sync?.stop(); mail.stop(); asks.stop(); wake.stop(); results.stop(); runner.shutdown(); devops.shutdown(); await Promise.allSettled([compareRuns.stop(), chats.shutdown(), browser.shutdown(), brain.shutdown()]); },
    killNow: () => { compareRuns.killNow(); manager.killAll(); runner.shutdown(); },
  };
}
