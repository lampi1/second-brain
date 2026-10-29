// Builds the services and connects them: chats get their own browser MCP endpoint, app-chat events reach the live feed,
// the app-control tools are mounted on the same local MCP server. Used by index.ts (one call at start).
// SB_DEMO=1 swaps in the demo services (demo-wiring.ts: fake chats, brain and browser tabs; SB_DEMO_FREEZE=1 = deterministic).
import type { BrowserWindow } from 'electron';
import { app, safeStorage, shell } from 'electron';
import os from 'node:os';
import { LearningReviewService } from './brainmodel/learning-review';
import { replayExecutor } from './brainmodel/replay-executor';
import type { ChatSummary, CliStatus, Harness, RunInfo } from '../shared/contract';
import { SEND_MODE_RULE } from '../shared/newchat';
import { engineStatuses } from './cli';
import { engineReadiness } from './engines/readiness';
import { anthropicApi, engineInfos, engineOf, enginePathsFromEnv, priceEnginesOf } from './engines/registry';
import { withApiModels } from './engines/sessions';
import { AgentCatalogService } from './agents/catalog';
import { RunFeedback } from './agents/run-feedback';
import { tierModel } from './agents/model-tier';
import { roleTableModel } from './agents/role-table';
import { qualifiedSkillsLine, runtimePluginName } from './agents/role-gate';
import { createAgentPacks } from './agents/pack/wiring';
import { chatLearnTool } from './agents/pack/learning';
import { estimateTask, SimilarIndex } from './agents/task-estimate';
import { estimateRecords } from './activity/records';
import { logEvent } from './activity/journal';
import { reviewPack } from './agents/review-pack';
import { estimateLine } from '../shared/task-estimate';
import { agentCatalogTool, CATALOG_GUIDANCE, roleCatalogBrief } from './agents/discovery';
import { SetupService } from './agents/setup';
import { uiLang } from './locale';
import { AutoCloseService, autoCloseNow } from './chats/auto-close';
import { readLocal, writeLocal } from './agents/local-store';
import { ProgressService } from './agents/progress';
import { mountLifecycleApi, type LifecycleApi } from './agents/lifecycle-api';
import { maintenanceEvent, proposalEvent } from './brain/announce';
import { MorningService } from './morning/service';
import { createAgentLoop } from './agents/loop';
import { childFeedbackTools } from './agents/child-feedback';
import { delegationTools } from './agents/delegation';
import { workDecisionTools } from './agents/work-decisions';
import { strategyTools } from './agents/strategy-tools';
import { portableId } from './agents/pack/flows';
import { memoryTools } from './rules/memory-tool';
import { MemoryService } from './rules/memory-service';
import { writeAgentMemory } from './rules/memory';
import type { AgentRun } from '../shared/agents';
import { mountTextTool, TEXT_ENV } from './engines/text-mcp';
import { agentsMayOpen, crossRefusal, engineOn, openRefusal } from './engines/policy';
import { checkedDelegation } from '../shared/roles';
import { createEngines, type EnginesApi } from './engines/service';
import { safeStorageCipher } from './engines/secrets';
import { PersonalBrowser } from './personal/browser';
import { RecordingStore } from './recordings/store';
import { LessonStore } from './learn/store';
import { LearnService, type TeachRun } from './learn/service';
import { runRead } from './learn/material';
import { systemLang } from './lang';
import { CloudService, cloudFile } from './cloud/service';
import { realExec, realHttp } from './cloud/exec';
import { CURSOR_CLOUD_KEY } from './cloud/cursor';
import { EngineSweeper } from './chats/sweep';
import { ChatManager, workBehind } from './chats/manager';
import type { Emitter } from './ipc';
import type { BrainService, BrowserService, ChatService, TasksApi, SkillsApi } from './services';
import { SkillsService } from './skills/service';
import { BrainModelService } from './brainmodel/service';
import { issuesUrlOf, ResearchService } from './brainmodel/research';
import { ghRun, openIssue } from './brainmodel/issue-open';
import { hiddenOpened, hiddenRun } from './window';
import { saveAiIdea } from './brain/save-idea';
import { researchTools } from './brainmodel/research-tools';
import { createBrain } from './brain';
import { setLaunchRules } from './brain/adapters/domains';
import { setCodexAutonomyRoots } from './brain/adapters/codex-policy';
import { doneEvent } from './brain/live';
import { syncBeforeCreate } from './brain/sync';
import { agentStatsLine, knownOutcome, predictionLine } from './brain/routing';
import { runMetrics } from './agents/run-metrics';
import { listPrice, priceTableSource, setPriceTable } from './chats/live-cost';
import type { McpServer, McpTool, ToolOutput } from './mcp/server';
import { createBrowserModule, mcpPortFromEnv } from './browser/service';
import { Workflows } from './workflows/service';
import { createRoutines, type Routines } from './routines/service';
import { devopsPatFromConnectors, devopsPatFromCursorConfig } from './routines/secret-fill';
import { testDbCredential } from './flows/test-db-env';
import { AGENT_LABEL, appControlTools, orchestratorEndpointAuth, type ToolDef, type ToolOut } from './appctl/tools';
import { readUi } from './appctl/guide';
import { ChatMail, mailTools } from './chats/mail';
import { brainClassifier } from './chats/orchestrator-delivery';
import { readOrchestratorMail } from './brain/brain-settings';
import { EndpointTokens } from './mcp/tokens';
import { McpServersService } from './mcp-servers/service';
import type { ChatMcpContext } from './mcp-servers/access';
import { createDemoServices } from './demo-wiring';
import { forcedSampler, OsLoadSampler } from './chats/admission';
import { ProductSync } from './sync';
import fs from 'node:fs';
import { CommandRunner } from './run/runner';
import { CommandAsks } from './run/asks';
import { RunResults } from './run/results';
import { OrchestratorWake } from './chats/orchestrator-wake';
import { attachHeldNews, type HeldNewsHub } from './chats/held-news';
import { ReplyRules } from './chats/reply-rules';
import { TaskService } from './tasks/service';
import { Quality } from './brain/quality';
import { AppSourceService, cleanEnv, findNode } from './update/source';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { askImageRoots, readAskImage } from './ask-image';
import { electronNode, runNode } from './brain/node';
import path from 'node:path';
import { templateRoot } from './rules/tools';
import { log, errText, addRedaction } from './log';
import { AnswerLaterStore, REQUEST_KINDS } from './later';
import { Artifacts, showUiTool } from './genui/artifacts';
import { releaseId } from './release';
import { launcherName, restartWaiter, sharedDir } from './platform';
import { HeadlessRunner } from './compare/headless';
import { OneShotService } from './agents/oneshot';
import type { AgentRunStore } from './agents/runs';
import { CompareQueue, queueAllowed } from './compare/queue';
import { DelegateWorktrees, gitWorktrees } from './agents/worktrees';
import { stageDelegatedChanges, stageDelegatedChangesMany } from './agents/delegation-integration';
import { JudgeSampler, judgeSamplingOn } from './agents/judge-sample';
import { COMPACT_WINDOW } from './brain/settings-schema';
import { setRecorder } from './chats/drift';
import { HybridSearch, workerFileNextTo } from './search/hybrid/service';
import { apiSearch, brainSearchTool } from './search/hybrid/tool';
import { BrainScripts, touchesScripts } from './brain/scripts';
import { BrainChangelog } from './brain/changelog';
import { brainScriptsTool, chatScriptAddTool } from './brain/scripts-tools';
import { BrainQueries, touchesQueries } from './brain/queries';
import { brainQueriesTool, chatQueryAddTool } from './brain/queries-tools';
import { AutoScripts } from './brain/auto-scripts';
import { mountRecallTool, RECALL_ENV } from './search/hybrid/recall';
import { timersFor } from './timers';
import { createLegacyArchive, type LegacyArchive } from './routines/legacy';
import { createFolderPackageStore } from './flows/package-authoring';
const { setInterval, clearInterval } = timersFor('wiring/auto-close');

export interface Ctx { emitter: Emitter; window: () => BrowserWindow | null; userData: string }
export interface Wired {
  /** cloud agents (ADR 0080): Cursor, Codex and Claude agents that run in their vendor's cloud */
  cloud?: CloudService;
  /** the verdicts on role runs (a parent's, a sampled Sentinel review's) and the user's Annulla on a change the app applied */
  runFeedback?: RunFeedback;
  /** the agents' "Da approvare" queue: read at /api/agents/lifecycle, decided only through agents:lifecycleDecide */
  agentLifecycle?: LifecycleApi;
  oneShot?: OneShotService;
  agentRuns?: AgentRunStore;
  memoryReview?: MemoryService;
  learningReview?: LearningReviewService;
  /** the brain's saved queries (ADR 0124): Memoria → Script & Query, queries:* IPC */
  queries?: BrainQueries;
  /** the hybrid brain search (SPEC 23); absent in the demo (Ctrl+K then uses its own index) */
  hybrid?: HybridSearch;
  workflows?: Workflows;
  routineArchive?: LegacyArchive;
  /** the Routine section's packages and runs (routines:* IPC); absent in the demo */
  routines?: Routines;
  updateChats?: { problem: () => string | null; checkpoint: () => void };
  progress: ProgressService;
  autoClose: AutoCloseService;
  agents: AgentCatalogService;
  agentPacks: ReturnType<typeof createAgentPacks>;
  /** the Brain pages and their maintenance jobs (ADR 0077) */
  brainModel: BrainModelService;
  /** the maintenance with research (ADR 0132): maintenance:* IPC, the Proposte deck's 'research' source */
  research?: ResearchService;
  /** the morning block ("Mentre eri via", ADR 0102); absent = the channel answers "nothing to show" */
  morning?: MorningService;
  setup: SetupService;
  chats: ChatService; browser: BrowserService; brain: BrainService; tasks: TasksApi;
  /** the user's own everyday browser, the Browser page (personal/browser.ts, ADR 0133) */
  personal: PersonalBrowser;
  /** the call recordings on disk (ADR 0154, recordings/store.ts): main/index.ts records and transcribes, app_recordings reads */
  recordings: RecordingStore;
  /** Impara (ADR 0185, learn/service.ts): the user's lessons; absent = the impara:* channels say it is not available */
  learn?: LearnService;
  /** the engines of the brain, which definitions the user turned on, the API keys (ADR 0046) */
  engines: EnginesApi;
  /** the chat folders' git branches ('chat:branches'); absent = read from disk (chats/branch.ts) */
  branches?: (cwds: unknown) => Record<string, string | null>;
  /** "Skill e agenti" (ADR 0018) */
  skills: SkillsApi;
  /** The local MCP server: browser routes, /mcp/app (app control). */
  mcp: McpServer;
  /** the MCP servers the user added in Settings → Connettori, given to each chat by role (ADR 0086) */
  mcpServers?: McpServersService;
  /** code blocks run by the user's click ("Esegui"), output streamed back (run:updated) */
  runner: CommandRunner;
  /** shell blocks a chat left for the user, as open requests ("Comando da eseguire", run/asks.ts) */
  asks: CommandAsks;
  /** "Eventi all'Orchestrator": work chats' news wakes the Orchestrator (chats/orchestrator-wake.ts) */
  wake: OrchestratorWake;
  /** "N novità in attesa" (#88): what the delivery rule holds back for the Orchestrators (chats/held-news.ts) */
  heldNews?: HeldNewsHub;
  /** "Aggiorna" from GitHub (Settings → Aggiornamenti), app_update_code, the restart notice (ADR 0074, 0075) */
  source: AppSourceService;
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
  // compact: the indented form was ~31% more characters, carried in every later turn of the Orchestrator
  return JSON.stringify(out);
}

/** The app-control tools on the local MCP server: /mcp/app for test agents (acts for the Orchestrator) and
 *  /mcp/app/o/<id>/<token>, the Orchestrator's own. Only the second gets app_update_code (ADR 0074). */
export function attachAppTools(mcp: McpServer, deps: Omit<Parameters<typeof appControlTools>[0], 'code'>, source: AppSourceService, demo = false, orchestratorTokens?: EndpointTokens): void {
  const as = (t: ToolDef): McpTool => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as Record<string, unknown>, ...(t.annotations ? { annotations: t.annotations } : {}), run: async a => toMcp(await t.run(a)) });
  const what = demo ? 'the second-brain app (demo data)' : 'the second-brain app itself: state, chats, open questions (read-only), feed, logs, screenshots, UI';
  // SEND_MODE_RULE: what the "Strategist" choice of the Orchestrator's input means (and the older "Veloce") (ADR 0034)
  const instructions = `Control and inspect ${what}. It can never answer questions or permissions. For a status or after a wake, call app_digest (since "last") once instead of reading chats one by one. ${CATALOG_GUIDANCE} ${SEND_MODE_RULE}`;
  const code = { repo: () => source.repo(), inRepo: (dir: string) => source.inRepo(dir) };
  // /mcp/app: test agents (acts for the Orchestrator); /mcp/app/o/<id>/<token>: the Orchestrator's own, so the tools know
  // the caller. Only an open Orchestrator with its own token answers (the token lives only here and in its config).
  mcp.mount('/mcp/app', { name: 'app', instructions, tools: appControlTools({ ...deps, code }).map(as) });
  if (orchestratorTokens) {
    mcp.mount('/mcp/app/o/:chatId/:token', {
      name: 'app', instructions, authorize: orchestratorEndpointAuth(orchestratorTokens, () => deps.chats.list()), who: p => p.chatId,
      tools: c => appControlTools({ ...deps, code: { ...code, pull: () => source.pull() } }, c.params.chatId).map(as),
    });
  }
}

/** "Rispondi dopo" (main/later.ts): the flag, sent to the page as 'later:changed'. */
export const createLater = (ctx: Pick<Ctx, 'emitter' | 'userData'>): AnswerLaterStore =>
  new AnswerLaterStore(path.join(ctx.userData, 'answer-later.json'), st => ctx.emitter.emit('later:changed', st));

/** The runner of "Esegui": blocks are checked against the chat's own assistant messages, run in the chat's folder. */
export function commandRunner(ctx: Pick<Ctx, 'emitter'>, chats: ChatService, onRun?: (run: RunInfo) => void): CommandRunner {
  return new CommandRunner({
    itemText: (chatId, itemId) => { const it = chats.items(chatId).find(i => i.id === itemId); return it?.kind === 'assistant' ? it.text : null; },
    cwdOf: chatId => chats.list().find(c => c.id === chatId)?.cwd ?? null,
    emit: run => { ctx.emitter.emit('run:updated', run); onRun?.(run); },
  });
}

/** "Comando da eseguire" requests (run/asks.ts): they watch every event main sends to the page (the emitter is tapped
 *  here, for the real app and the demo alike) and notify through the feed like a question ("Domanda per te"). */
export function attachCommandAsks(ctx: Pick<Ctx, 'emitter'>, runner: CommandRunner, brain: Pick<BrainService, 'publish'>, now?: () => number, chats?: Pick<ChatService, 'commandAsked' | 'commandDone'>): CommandAsks {
  const send = ctx.emitter.emit.bind(ctx.emitter);
  const asks = new CommandAsks({
    // through the emitter as it is when called: the taps added later (the Orchestrator's news) hear it too
    emit: (ch, p) => {
      ctx.emitter.emit(ch, p);
      if (ch === 'pending:resolved') { const x = p as { chatId: string; requestId: string }; chats?.commandDone?.(x.chatId, x.requestId); }
    },
    ran: (chatId, itemId, code) => runner.list(chatId).some(r => r.itemId === itemId && r.code === code),
    ...(now ? { now } : {}),
    onAsk: (req, title) => {
      chats?.commandAsked?.(req.chatId, req.id);
      brain.publish([{ kind: 'question', title, detail: `Comando da eseguire: ${req.detail.split(/\r?\n/)[0] ?? ''}`, chatId: req.chatId }]);
    },
  });
  ctx.emitter.emit = (ch, p) => { send(ch, p); asks.observe(ch, p); };
  return asks;
}

/** "Eventi all'Orchestrator" (chats/orchestrator-wake.ts): it watches the same events (the emitter tapped once more) and writes
 *  to the Orchestrator through the chat service. on = the setting orchestratorEvents and, in tests, an explicit SB_ORCHESTRATOR_EVENTS=1
 *  (a test's Orchestrator never gets surprise messages); SB_ORCHESTRATOR_EVENTS_MS shortens the grouping window for e2e. */
export function attachOrchestratorWake(ctx: Pick<Ctx, 'emitter'> & Partial<Pick<Ctx, 'userData'>>, chats: Pick<ChatService, 'send' | 'list' | 'submissionReceipts'>, on: () => boolean, now?: () => number): OrchestratorWake {
  const groupMs = Number(process.env.SB_ORCHESTRATOR_EVENTS_MS) || undefined;
  const wake = new OrchestratorWake({ ...(ctx.userData ? { userData: ctx.userData } : {}), receiptAcknowledgement: chats.submissionReceipts === true, send: (chatId, text, receipt) => chats.send(chatId, text, undefined, false, 'App', false, { kind: 'app' }, receipt ? { beforeSubmit() {}, ...receipt } : undefined), enabled: on, list: () => chats.list(), ...(groupMs ? { groupMs } : {}), ...(now ? { now } : {}) });
  const send = ctx.emitter.emit.bind(ctx.emitter);
  ctx.emitter.emit = (ch, p) => { send(ch, p); wake.observe(ch, p); };
  return wake;
}

/** "Esito alla chat" (run/results.ts): a run's end goes back to the chat that proposed the block. on = the setting
 *  runResults and, in tests, an explicit SB_RUN_RESULTS=1 (a test's chats never get surprise messages). */
export function attachRunResults(ctx: Pick<Ctx, 'emitter'>, chats: Pick<ChatService, 'send' | 'list' | 'submissionReceipts'>, on: () => boolean): RunResults {
  const groupMs = Number(process.env.SB_RUN_RESULTS_MS) || undefined;
  const results = new RunResults({ send: (chatId, text) => chats.send(chatId, text, undefined, false, 'App', false, { kind: 'app' }), enabled: on, list: () => chats.list(), ...(groupMs ? { groupMs } : {}) });
  const send = ctx.emitter.emit.bind(ctx.emitter);
  ctx.emitter.emit = (ch, p) => { send(ch, p); results.observe(ch, p); };
  return results;
}

/** show_ui's visuals (ADR 0033, genui/artifacts.ts): kept per chat in userData, merged into the chat's items (chat:items),
 *  attached to the chat's next question by watching the events main sends to the page (the emitter tapped once more).
 *  SB_ASK_WAIT_MS shortens the wait for that question, only under SB_TEST (e2e). */
export function attachArtifacts(ctx: Pick<Ctx, 'emitter' | 'userData'>, chats: Pick<ChatService, 'list' | 'items'>, now?: () => number, imageProblem?: (path: string) => string | null): Artifacts {
  const wait = Number(process.env.SB_ASK_WAIT_MS);
  const store = new Artifacts({
    dir: path.join(ctx.userData, 'artifacts'), chats: () => chats.list(), emit: (chatId, item) => ctx.emitter.emit('chat:item', { chatId, item }),
    ...(imageProblem ? { imageProblem, evidenceDir: path.join(ctx.userData, 'evidence') } : {}),
    ...(now ? { now } : {}), ...(process.env.SB_TEST === '1' && wait > 0 ? { askWaitMs: wait } : {}),
  });
  const send = ctx.emitter.emit.bind(ctx.emitter);
  // a question's visuals are linked before the question reaches the page: its card draws with its brief (ADR 0150)
  ctx.emitter.emit = (ch, p) => { if (ch === 'pending:added') { store.observe(ch, p); send(ch, p); } else { send(ch, p); store.observe(ch, p); } };
  const items = chats.items.bind(chats);
  chats.items = chatId => store.merge(chatId, items(chatId));
  return store;
}

/** "Aggiorna" from GitHub (ADR 0075). Stable = started by the launcher (SB_RELEASE); SB_UPDATE_STABLE=<release id> makes
 *  a test or demo run behave as that stable release (with SB_RELEASES_ROOT and SB_UPDATE_REPO pointing at temp
 *  folders), and then a restart is only recorded (__sbUpdate.restarts), never real. */
export function createAppSource(ctx: Pick<Ctx, 'emitter' | 'userData'>, appRepo: () => string | null): AppSourceService {
  const fake = process.env.SB_UPDATE_STABLE;
  const running = fake ?? releaseId() ?? 'dev';
  const releasesBase = process.env.SB_RELEASES_ROOT ?? sharedDir();
  const real = !!releaseId() && !fake && !process.env.SB_TEST;
  const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const devRepo = process.env.SB_UPDATE_REPO ?? (fs.existsSync(path.join(outDir, '.git')) ? outDir : null);
  const recorder = { restarts: 0 };
  (globalThis as Record<string, unknown>).__sbUpdate = recorder;
  return new AppSourceService({
    userData: ctx.userData, releasesBase, running, stable: !!fake || !!releaseId(),
    appRepo: () => appRepo() ?? (fake ? devRepo : null), devRepo, node: findNode(),
    emit: st => ctx.emitter.emit('source:state', st),
    offline: !!(process.env.SB_TEST || process.env.SB_DEMO) && !process.env.SB_UPDATE_REPO,
    relaunch: () => {
      if (process.env.SB_TEST || fake) { recorder.restarts++; log.info('update', 'relaunch asked (test run: not relaunching)'); return; }
      log.info('update', 'relaunching the dev build on the new code');
      app.relaunch();
      app.quit();
    },
    restart: failed => {
      if (!real) { recorder.restarts++; log.info('update', 'restart asked (test run: not restarting)'); return; }
      // the launcher starts the new current release (and falls back by itself) once this process is gone: this app
      // holds the single-instance lock until its quit ends (chats close, up to seconds), and a release started before
      // would exit at once and be marked bad (reviews 2026-10-12). After 60 s it starts anyway.
      const launcher = path.join(releasesBase, launcherName());
      const waiter = restartWaiter(process.pid, launcher);
      // quit only once the waiter really started: a powershell.exe that cannot start (blocked, missing) reports it
      // asynchronously, and the app must then stay open rather than close with nothing to reopen it (review 2026-10-12)
      const fail = (e: unknown) => { log.error('update', 'launcher not started: the app stays open on the old version', { cause: errText(e), hint: `start it by hand: ${launcher}` }); failed(); };
      try {
        const child = spawn(waiter.command, waiter.args, { detached: true, stdio: 'ignore', windowsHide: true, env: cleanEnv(process.env) });
        child.once('error', fail);
        child.once('spawn', () => {
          child.unref();
          log.info('update', 'restarting through the launcher', { data: { launcher } });
          app.quit();
        });
      } catch (e) { fail(e); }
    },
  });
}

/** Shared by real and demo wiring. */
export function createAgentCatalog(ctx: Ctx, brain: BrainService, engines: EnginesApi, cli: () => Record<Harness, CliStatus> | null, onCustomized?: () => void): AgentCatalogService {
  return new AgentCatalogService({ userData: ctx.userData, ...(onCustomized ? { onCustomized } : {}),
    tierModel: (engine, tier) => tierModel(engine, tier, brain.routingInfo().registry, brain.settings().modelTiers),
    tableModel: (engine, req) => roleTableModel(brain, engine, req),
    pulsePreset: () => {
      const choices = engineInfos();
      const e = choices.find(e => e.kind === 'api' && agentsMayOpen(brain.settings(), e.id) && engines.hasKey(e.id))
        ?? choices.find(e => e.kind === 'claude');
      const model = e ? brain.routingInfo().registry?.models.find(m => priceEnginesOf(e).includes(m.harness) && m.tier === 'mid')?.id ?? (e.kind === 'claude' ? 'sonnet' : null) : null;
      return { engine: e?.id ?? 'claude', model, ...(e?.caps.effort ? { effort: 'low' as const } : {}) };
    },
    models: () => {
      const seen = withApiModels(brain.modelsSeen());
      return engineInfos().map(e => ({ engine: e.id, label: e.label, enabled: engineOn(brain.settings(), e.id), trusted: e.trusted, effort: e.caps.effort, maxContext: e.kind === 'claude',
        models: seen[e.id]?.ids ?? [], source: seen[e.id]?.ids.length ? seen[e.id]!.at > 0 ? 'observed' as const : 'registry' as const : 'unknown' as const,
        installed: e.kind === 'api' ? null : cli()?.[e.id]?.found ?? null, authenticated: e.kind === 'api' ? engines.hasKey(e.id) : cli()?.[e.id]?.loggedIn ?? null,
        defaultModel: e.kind !== 'api', modelSelectable: e.kind !== 'acp' || !!engineOf(e.id)?.modelFlag,
        modelReason: e.kind === 'acp' && !engineOf(e.id)?.modelFlag ? 'Questo adattatore non può applicare una scelta di modello. È disponibile il default CLI.' : null }));
    },
    preferredEngine: () => brain.settings().orchestratorChats.harness ?? null,
    emit: catalog => ctx.emitter.emit('agents:changed', catalog),
  });
}

export async function createServices(ctx: Ctx): Promise<Wired> {
  if (process.env.SB_DEMO === '1') return createDemoServices(ctx);
  let workflowsRef: Workflows | undefined;
  // the dev instance records the shapes real CLIs send (sanitized, a few per kind): fixtures for the contract tests (ADR 0055)
  setRecorder(!releaseId() && !process.env.SB_TEST ? path.join(ctx.userData, 'cli-records') : null);
  let cliCache: Record<Harness, CliStatus> | null = null;

  // the brain folder (bound below, once the brain exists) holds the credentials file of login hand-offs
  let brainRoot: () => string | null = () => null;
  const { service: browser, mcp, addChatTools, setBrowserAccess, setChatToolFilter, sitePackageLogin } = await createBrowserModule({ emitter: ctx.emitter, window: ctx.window, userData: ctx.userData, port: mcpPortFromEnv(), brainRoot: () => brainRoot() });
  // the brain's chats.mjs poll leaves out the app's own chats (bound below, once the chat manager exists)
  let isOwn: (id: string) => boolean = () => false;
  // Retire the legacy global quiet flag before notifications start; postponement is request-local in the renderer.
  const later = createLater(ctx);
  later.set(false);
  // the brain's estimates run (and the sample judge it starts) gets the app's text endpoint on the user's API credits;
  // writing rows «Sui crediti API» get the Anthropic API engine when it may run (both bound below, ADR 0052)
  let scriptEnv: () => Record<string, string> = () => ({});
  let apiRoute: () => Harness | null = () => null;
  // the brain's scripts and changelog (ADR 0076), read from the brain folder once it is known (created first: the
  // brain's watcher reports their files)
  const brainChangelog = new BrainChangelog(() => brain.info().brainRoot);
  const brainScripts = new BrainScripts(() => brain.info().brainRoot, brainChangelog);
  let scriptsTimer: NodeJS.Timeout | null = null;
  // the saved queries (ADR 0124): their delete goes through the brain model's ChangeLog (created below)
  const brainQueries = new BrainQueries(() => brain.info().brainRoot, () => brainModelRef.current?.log ?? null, brainChangelog);
  let queriesTimer: NodeJS.Timeout | null = null;
  const onScriptFile = (f: string) => {
    if (touchesQueries(f)) {
      if (queriesTimer) clearTimeout(queriesTimer);
      queriesTimer = setTimeout(() => { queriesTimer = null; ctx.emitter.emit('queries:changed', undefined); }, 500);
    }
    if (!touchesScripts(f)) return;
    brainScripts.invalidate();
    if (scriptsTimer) clearTimeout(scriptsTimer);
    scriptsTimer = setTimeout(() => { scriptsTimer = null; ctx.emitter.emit('scripts:changed', undefined); }, 500);
  };
  // the hybrid brain search (SPEC 23): its worker starts after the window (index.ts); a brain file change re-syncs it
  const hybrid = new HybridSearch({
    dir: path.join(ctx.userData, 'search'), brainRoot: () => brain.info().brainRoot, workerFile: workerFileNextTo(path.dirname(fileURLToPath(import.meta.url))),
    download: !process.env.SB_TEST, onStatus: st => ctx.emitter.emit('search:status', st),
  });
  const brain: BrainService = await createBrain({ emitter: ctx.emitter, window: ctx.window, userData: ctx.userData, skipChat: id => isOwn(id), held: e => later.get().on && REQUEST_KINDS.has(e.kind),
    scriptEnv: () => scriptEnv(), apiRoute: () => apiRoute(), onFile: f => { hybrid.fileChanged(); onScriptFile(f); } });
  // the brain's scripts and changelog (ADR 0076): the Script and Changelog pages, brain_scripts for every chat, the
  // Orchestrator's write tools (attachAppTools below); a change on disk reloads both pages
  brain.serveApi('/api/scripts', () => brainScripts.list());
  brain.serveApi('/api/script', q => brainScripts.get(q.get('id') ?? ''));
  brain.serveApi('/api/changelog', () => brainChangelog.list());
  // undefined when the hybrid search fails: the brain's own server answers (substring search)
  brain.serveApi('/api/search', async q => {
    await memoryReview.retryInvalidations();
    return apiSearch((text, o) => hybrid.query(text, o), q).catch(() => undefined);
  });
  brain.serveApi('/api/themes', q => hybrid.themes(q.get('kind') === 'ideas' ? 'ideas' : 'errors'));
  // past errors similar to a prompt, for the brain's prompt hook in the chats the app starts (their env: RECALL_ENV)
  const recall = mountRecallTool(mcp, (text, k) => hybrid.recall(text, k), text => hybrid.detectCorrection(text));
  // the brain's rules each Claude / Codex chat gets at launch (ADR 0060): read at every start, so a switch or a new
  // brain folder counts from the next chat
  setCodexAutonomyRoots(() => brain.settings().codexAutonomyRoots ?? []);
  setLaunchRules(() => {
    const s = brain.settings();
    const root = brain.info().brainRoot;
    return { domains: root ? [{ name: 'brain', root }] : [], claude: s.launchRulesClaude === true, codex: s.launchRulesCodex !== false };
  });
  // the brain's engines are read before the chats restore: a chat on one of them can resume (ADR 0046)
  const engines = createEngines({ userData: ctx.userData, emitter: ctx.emitter, cipher: safeStorageCipher(safeStorage), brainRoot: () => brain.info().brainRoot, settings: brain });
  const textTool = mountTextTool(mcp, engines.text);
  // cloud agents (ADR 0080): the vendors' lists polled only while the window is on screen; tests never reach a vendor
  const cloud = new CloudService({
    file: cloudFile(ctx.userData), emit: st => ctx.emitter.emit('cloud:changed', st), exec: realExec,
    http: process.env.SB_TEST || process.env.VITEST ? () => Promise.reject(new Error('i test non chiamano Cursor')) : realHttp,
    cursorKey: () => engines.keyFor(CURSOR_CLOUD_KEY), engineOn: h => engineOn(brain.settings(), h),
    budget: () => { const b = brain.settings().budget; return { limitUsd: b.enabled && b.cursor.mode !== 'off' ? b.cursor.dailyUsd : null, localTodayUsd: brain.usage().cursorTodayUsd ?? 0 }; },
    addSpend: usd => engines.addSpend(CURSOR_CLOUD_KEY, usd),
    visible: () => { const w = ctx.window(); return !!w && !w.isDestroyed() && w.isVisible() && !w.isMinimized(); },
  });
  cloud.startPolling();
  // Retired personal milestones: keep legacy IPC read-only and preserve the existing progress file.
  const progressService = new ProgressService(ctx.userData, { enabled: false, chats: () => [] });
  // live turn costs and the Claude model list at the brain's per-model list prices (harness/models.json, else the
  // release template's), re-read at most every 30 s; set before the catalog reads its models (issue #96)
  setPriceTable(priceTableSource(() => brain.routingInfo().registry, () => { try { return path.join(templateRoot(), 'harness', 'models.json'); } catch { return null; } }));
  const agents = createAgentCatalog(ctx, brain, engines, () => ({ ...cliCache, ...engineReadiness() }));
  // Probe only after registry/trust initialization; reconcile untouched seeds when readiness arrives and tell the
  // renderer (issue #96: the role editor showed the startup snapshot). Tests never run installed vendors.
  if (!process.env.SB_TEST) void engineStatuses().then(all => { cliCache = all; agents.refresh(); ctx.emitter.emit('cli:ready', all); });
  brain.onSettingChange(c => { if (c.key === 'brainRoot' || c.key.startsWith('engineOn.') || c.key === 'orchestratorChats.harness' || c.key.startsWith('modelTiers.')) agents.refresh(); });
  // the Brain pages' reader, set once they are built (the skills a role's tools need)
  const brainModelRef: { current?: BrainModelService } = {};
  const researchRef: { current?: ResearchService } = {};
  const agentPacks = createAgentPacks(ctx.userData, brain, agents);
  const memoryReview = new MemoryService({ root: () => agentPacks.packs.root(), embed: (texts, mode) => hybrid.embed(texts, mode), invalidate: async () => { if (!await hybrid.sync()) throw new Error('Memory changed, but search invalidation is pending. Retry before continuing.'); } });
  // agent_learn_propose on a work chat's endpoint: only its own role's lessons, queued for the Orchestrator and the user
  const skillTools = () => brainModelRef.current?.skillTools() ?? [];
  addChatTools([agentCatalogTool(() => agents.list(), skillTools), chatLearnTool(agentPacks.learning, () => manager.runs.list()), brainSearchTool(async (q, o) => { await memoryReview.retryInvalidations(); return hybrid.query(q, o); }), brainScriptsTool(brainScripts), brainQueriesTool(brainQueries)]);
  addChatTools(memoryTools({ root: () => agentPacks.packs.root(), recall: (scope, query, options) => memoryReview.recall(scope, query, options), context: chatId => {
    const chat = manager.list().find(c => c.id === chatId);
    if (!chat || chat.agent?.source !== 'catalog' || chat.isOrchestrator || !chat.run) return null;
    return { scope: { roleId: portableId(chat.agent.id), project: chat.cwd }, sourceRunId: chat.run.runId };
  } }));
  scriptEnv = () => ({ [TEXT_ENV]: textTool.url() });
  apiRoute = () => { const e = anthropicApi(); return e && engineOn(brain.settings(), e.id) && engines.hasKey(e.id) ? e.id : null; };

  // Claude chats through the user's own `claude` CLI (SB_CLAUDE_PATH: a fake CLI for e2e tests); each chat gets its own
  // browser endpoint, so it sees and drives only its tabs.
  // the Orchestrator's app-control endpoint carries an unguessable token: the URL names the caller, whose engine decides the
  // Claude <-> Cursor rule, so a local process may not take the Orchestrator's identity
  const orchestratorTokens = new EndpointTokens();
  // the user's MCP servers (ADR 0086): reached by every chat through the app's gateway, tokens only in main
  const mcpServers: McpServersService = new McpServersService({ userData: ctx.userData, cipher: safeStorageCipher(safeStorage), mcp, context: (id): ChatMcpContext | null => manager.mcpContext(id), emit: st => ctx.emitter.emit('mcpservers:changed', st) });
  const coldTest = process.env.SB_TEST && process.env.SB_COLD_MS ? process.env.SB_COLD_MS.split(',').map(Number) as [number, number, number] : null;
  // rules on the chats' replies, checked at every turn end so they hold with any model (ADR 0063)
  const replyRules = new ReplyRules({ send: (chatId, text) => manager.send(chatId, text, undefined, false, 'App', false, { kind: 'app' }) });
  const autoCloseRef: { current?: AutoCloseService } = {};
  // the roles' improvement loop (set below, once the lifecycle exists): a run's end or the user's verdict → its role's
  // trial evaluated again
  const loopRef: { current?: { ended(run: AgentRun): void; outcome(run: AgentRun): void } } = {};
  const runFeedbackRef: { current?: { runList(): readonly AgentRun[] } } = {};
  const delegateWorktrees = new DelegateWorktrees(path.join(ctx.userData, 'delegation-worktrees.json'));
  // the question gates ask for a brief before a yes/no question (ADR 0150): the visuals' store exists further down
  const briefRef: { current?: Artifacts } = {};
  const manager = new ChatManager({
    writeDelayMs: 250, // chats.json and agent-runs.json: one asynchronous write per burst (the main-process freezes, 2026-10-27)
    briefReady: chatId => briefRef.current?.hasBrief(chatId) ?? true,
    prepareDelegation: delegateWorktrees.prepare,
    freshSessions: () => true,
    continuationContext: chatId => workflowsRef ? JSON.stringify(workflowsRef.list().filter(row => row.chatIds.includes(chatId))) : null,
    onAutoCloseActivity: id => autoCloseRef.current?.invalidate(id),
    worktrees: gitWorktrees,
    resolveAgent: req => {
      const resolved = agents.resolve(req);
      if (req.roleId === undefined || req.orchestrator) return resolved;
      // only the skills this launch gives exist in its plugin (the role gate refuses the others)
      const runtime = agentPacks.packs.runtime(req.roleId, req.skills ?? [], { query: req.goal ?? req.prompt ?? '', project: req.cwd });
      const resolvedHarness = resolved.request.harness;
      return { ...resolved, launchContext: runtime.context, skills: runtime.skills, assets: { pluginDir: runtime.pluginDir, skillRoot: runtime.skillRoot },
        // Claude loads the plugin itself: its instructions only need the skills' qualified names (issue #101)
        instructions: resolvedHarness === 'cursor' ? `${resolved.instructions}\n\n${runtime.instructions}`
          // and its memory: the plugin carries the skills, not the memory (before, a Claude role never saw it nor its id)
          : [resolved.instructions, qualifiedSkillsLine(runtimePluginName(runtime.pluginDir), runtime.skills), runtime.memory].filter(Boolean).join('\n\n') };
    },
    onRunEnded: run => loopRef.current?.ended(run),
    onRunOutcome: run => { routingVerdict(run); loopRef.current?.outcome(run); },
    roleCatalogBrief: () => roleCatalogBrief(() => agents.list()),
    // the reply language (ADR 0120): the setting, or Windows' language on «Come il sistema», the same as the UI's
    replyLang: uiLang,
    // the estimate task_estimate would give, under the user's request (one model round trip less, ADR 0087)
    requestEstimate: text => {
      if (!runFeedbackRef.current) return null;
      const e = estimateTask(new SimilarIndex(runFeedbackRef.current.runList()), { text });
      for (const r of estimateRecords(e, text, 'per la tua richiesta')) logEvent(r); // the Log page (ADR 0111)
      return estimateLine(e);
    },
    emitter: ctx.emitter,
    userData: ctx.userData,
    env: { [RECALL_ENV]: recall.url() },
    recall: text => hybrid.recall(text),
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
    extMcp: chatId => mcpServers.launch(chatId, browser.mcpUrlFor(null).replace(/\/mcp$/, '')),
    // agents' new chats and turns wait while the machine is busy (ADR 0036); SB_LOAD_FORCE="cpu,freeRam" fixes the load
    // for the e2e suite
    admission: {
      priority: key => {
        if (!workflowsRef) return 2;
        const all = manager.list(); let id: string | undefined = key, priority = 2; const seen = new Set<string>();
        while (id && !seen.has(id)) { seen.add(id); priority = Math.min(priority, workflowsRef.priorityFor(id)); id = all.find(c => c.id === id)?.parentId; }
        return priority;
      },
      sampler: forcedSampler(process.env.SB_LOAD_FORCE) ?? new OsLoadSampler(),
      limits: () => { const st = brain.settings(); return { enabled: st.loadQueue !== false, cpu: st.loadQueueCpu ?? 75, ram: st.loadQueueRam ?? 15 }; },
    },
    // the Orchestrator also gets the app-control tools (create work chats, read the app): /mcp/app on the same server
    appMcpUrl: orchestratorId => browser.mcpUrlFor(null).replace(/\/mcp$/, `/mcp/app/o/${orchestratorId}/${orchestratorTokens.tokenFor(orchestratorId)}`),
    // brain hooks: plan limits, the job ledger (real cost and time), the live feed and notifications
    onRateLimit: msg => brain.ingestRateLimits(msg),
    onModels: (h, list) => { brain.recordModels(h, list); agents.refresh(); },
    acpModelConfig: () => { const r = brain.settings().orchestratorChats; return { reasoning: r.cursorReasoning, fast: r.cursorFast }; },
    onTurnEnd: info => {
      replyRules.turnEnded(info.chatId, info.reply, info.isError);
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
        actual: { usd: job.usd, minutes: Math.round(manager.workMs(info.chatId) / 6000) / 10, minutesKind: 'work', turns: job.turns },
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
    orchestratorDayCompact: () => brain.settings().orchestratorDayCompact !== false,
    checkpoints: () => !process.env.SB_TEST,
    reviewPack: cwd => reviewPack(cwd),
    coldIdleMs: () => coldTest?.[0] ?? (brain.settings().coldHandoffMin ?? 50) * 60_000,
    ...(coldTest ? { cacheTtlMs: coldTest[1], coldEveryMs: coldTest[2] } : {}),
    memTool: () => {
      const root = brain.info().brainRoot;
      const tool = root ? path.join(root, 'ops', 'tools', 'mem.mjs') : null;
      return tool && fs.existsSync(tool) ? tool : null;
    },
    brainRoot: () => brain.info().brainRoot,
  });
  const jobs = new Map<string, { usd: number; turns: number; prompt: string | undefined }>();
  // a routed chat's totals already in the ledger when this run first saw it (after a restart, or its predecessor's)
  const routedBase = new Map<string, { usd: number; turns: number; minutes: number; ctxPeak: number }>();
  const titleOf = (chatId: string) => manager.list().find(c => c.id === chatId)?.title ?? 'Chat';
  isOwn = id => manager.isOwnSession(id);
  setBrowserAccess(id => manager.browserAccess(id));
  setChatToolFilter((id, tool) => manager.chatToolShown(id, tool));
  // a closed chat's browser tabs go away and its per-chat MCP token stops working
  const closeChat = manager.close.bind(manager);
  manager.close = async (chatId: string) => { await closeChat(chatId); browser.forgetChat(chatId); };
  // an archived chat's browser tabs close too; its MCP token and the environment's sign-in stay, so a reopen continues
  const archiveChat = manager.archive.bind(manager);
  manager.archive = async (chatId, o) => {
    const c = await archiveChat(chatId, o);
    if (c.closedAt) for (const t of browser.list()) if (t.ownerChatId === chatId) browser.close(t.id);
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
  browser.setWake((chatId, text) => { void chats.send(chatId, text, undefined, false, 'App', false, { kind: 'app' }).catch(e => log.warn('browser', 'could not wake the chat after a hand-off', { chat: chatId, cause: errText(e), hint: 'the chat is closed or failed to start: open it and tell it yourself' })); });

  // mail between chats in real time: inbox.mjs mail goes to the app's live chats at once, and every chat gets
  // send_to_chat / list_chats on its own MCP endpoint (chats/mail.ts)
  // the words that time the mail to an Orchestrator come from the brain (chats/orchestrator-delivery.ts)
  const classify = brainClassifier(() => { const root = brain.info().brainRoot; return root ? readOrchestratorMail(root) : undefined; });
  const mail = new ChatMail({ root: () => brain.info().brainRoot, chats: manager, instance: path.basename(ctx.userData), classify, holdActivity: id => manager.holdActivity(id) });
  addChatTools(mailTools({ classify,
    root: () => brain.info().brainRoot, chats: () => chats.list(), crossRefusal: (from, to) => crossRefusal(brain.settings(), from, to),
    agentsMayOpen: h => agentsMayOpen(brain.settings(), h),
    deliver: () => { void mail.tick(); }, chainOf: box => mail.chainOf(box),
    sent: (fromId, toId, text) => manager.noteMail(fromId, toId, text), // a worker's report completes its assignment (ADR 0084)
  }));
  mail.start();
  // show_ui on every chat's own endpoint: a visual from the catalog instead of a wall of text (ADR 0033)
  // a brief's screenshot is checked like the card will read it (app:askImage in index.ts: the same allowed folders)
  const appCode = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const artifacts = attachArtifacts(ctx, chats, undefined, p => {
    const r = readAskImage(p, askImageRoots({ userData: ctx.userData, appData: app.getPath('appData'), brainRoot: brain.info().brainRoot,
      repos: [brain.settings().appRepo, fs.existsSync(path.join(appCode, '.git')) ? appCode : null] }));
    return r.kind === 'image' ? null : r.reason;
  });
  briefRef.current = artifacts;
  addChatTools([showUiTool(artifacts)]);

  // a reusable command that ran fine with "Esegui" becomes a brain script by itself (issue #111, ADR 0096)
  const autoScripts = new AutoScripts({ scripts: brainScripts, root: () => brain.info().brainRoot, chatTitle: id => chats.list().find(c => c.id === id)?.title ?? null });
  const runner = commandRunner(ctx, chats, run => { autoScripts.onRun(run); });
  // brain_script_add on every chat's own endpoint: a work chat saves the script it ran with success itself
  addChatTools([chatScriptAddTool(brainScripts, id => chats.list().find(c => c.id === id)?.title ?? null)]);
  // brain_query_add the same way: a query that ran and someone reruns goes to queries/ (ADR 0124)
  addChatTools([chatQueryAddTool(brainQueries, id => chats.list().find(c => c.id === id)?.title ?? null)]);
  const asks = attachCommandAsks(ctx, runner, brain, undefined, chats);
  const keptFile = path.join(ctx.userData, 'auto-close-kept.json');
  let kept: string[] = [], keptProblem = false;
  try {
    const saved = readLocal(keptFile) as { version?: unknown; ids?: unknown } | undefined;
    if (saved !== undefined) {
      if (saved.version !== 1 || !Array.isArray(saved.ids) || saved.ids.length > 1000 || !saved.ids.every(id => typeof id === 'string' && id.length <= 100)) throw new Error('Invalid keep-open state');
      kept = saved.ids as string[];
    }
  } catch { keptProblem = true; }
  // asked several times per open chat at each tick: settings() clones every setting, so it is read at most once a second
  let autoCloseMin = { at: -Infinity, min: 2 };
  const autoCloseDelay = () => {
    const now = Date.now();
    if (now - autoCloseMin.at >= 1000) autoCloseMin = { at: now, min: brain.settings().autoCloseMin ?? 2 };
    return autoCloseMin.min * 60_000;
  };
  const autoCloseService = new AutoCloseService({ now: autoCloseNow,
    delayMs: () => keptProblem ? 0 : autoCloseDelay(),
    // what holds a chat open, named for its "In attesa di…" label (ADR 0084); an open tab alone no longer holds it (the
    // archive closes its tabs): only a hand-off, a dialog or a page still loading
    candidates: () => manager.autoCloseCandidates(id => asks.pending().some(p => p.chatId === id) ? 'command'
      : browser.list().some(t => t.ownerChatId === id && (!!t.handoffId || !!t.dialog)) ? 'browser'
      : runner.list(id).some(r => r.state === 'running') || browser.list().some(t => t.ownerChatId === id && t.loading) ? 'work'
      : mail.hasWork(id) ? 'mail' : false),
    archive: async (id, _reservation, valid) => {
      // hasWork trusts a mailbox listing for BOX_TTL_MS: mail that came in since keeps the chat open
      if (mail.hasWork(id, true)) return false;
      const done = await manager.archiveAutomatic(id, valid);
      if (done) for (const tab of browser.list()) if (tab.ownerChatId === id) browser.close(tab.id);
      return done;
    }, initialKeptOpen: kept,
    saveKeptOpen: ids => { try { writeLocal(keptFile, { version: 1, ids }); } catch (e) { keptProblem = true; throw e; } },
    emit: states => ctx.emitter.emit('chat:autoCloseStatus', states),
    away: () => { const w = ctx.window(); return !w || w.isDestroyed() || !w.isVisible() || w.isMinimized(); },
  });
  autoCloseRef.current = autoCloseService;
  const autoCloseTimer = setInterval(() => { void autoCloseService.tick().catch(e => log.warn('chats', 'automatic archive suspended', { cause: errText(e) })); }, 1000);
  autoCloseTimer.unref();
  agentPacks.learning.evidenceRuns = () => manager.runs.list();
  const routineArchive = createLegacyArchive({ userData: ctx.userData, brainRoot: () => brain.info().brainRoot });
  const routines = createRoutines({ userData: ctx.userData, legacy: routineArchive,
    changed: change => ctx.emitter.emit('routines:progress', change),
    // the '<set-by-user>' secrets the app already holds (owner, 2026-10-27): values go only into the package, each one
    // redacted from the logs; the export never lands in this repo or the brain
    secrets: {
      devopsPat: () => devopsPatFromConnectors(mcpServers.store.servers(), (id, slot) => mcpServers.store.secret(id, slot)),
      // Cursor's MCP config, read only (AGENTS.md rule 6; the owner's request, ADR 0176)
      cursorDevopsPat: organization => {
        let text: string | null = null;
        try { text = fs.readFileSync(path.join(os.homedir(), '.cursor', 'mcp.json'), 'utf8'); } catch { /* no Cursor config */ }
        const r = devopsPatFromCursorConfig(text, organization);
        if ('value' in r) addRedaction(r.value);
        return r;
      },
      siteLogin: origin => { const r = sitePackageLogin(origin); if ('value' in r) addRedaction(r.value.password); return r; },
      testDbLogin: () => {
        const [user, password] = [testDbCredential('SQLCMD_TEST_RO_USER'), testDbCredential('SQLCMD_TEST_RO_PASSWORD')];
        if (!user || !password) return { reason: 'login DB di test non configurato (SQLCMD_TEST_RO_USER/PASSWORD)' };
        addRedaction(password);
        return { value: { user, password } };
      },
    },
    forbiddenRoots: () => [source.repo(), app.getAppPath(), process.cwd(), brain.info().brainRoot],
  });
  const workflows = workflowsRef = new Workflows(path.join(ctx.userData, 'work-threads.json'), rows => ctx.emitter.emit('work:changed', rows), Date.now, row => {
    const linked = chats.list().filter(c => row.chatIds.includes(c.id) && c.plan);
    const approved = linked.filter(c => ['running', 'done'].includes(c.plan!.phase) && (c.run?.plan?.approvedAt ?? 0) > 0);
    return { pending: linked.some(c => !['running', 'done'].includes(c.plan!.phase)), approved: approved.length === linked.length ? approved.map(c => `${c.id} / task ${c.run?.taskVersion ?? 1}: ${c.plan!.steps.map(s => s.title).join('; ')}`).join('\n') : '' };
  });
  // Poll without model calls; relevant events and canonical reports wake the owning Orchestrator.
  // SB_BENCH_TIMERS=1: scripts/bench-stalls.mjs measures an idle app with these production pollers on (fake engines only)
  const prodPollers = !process.env.SB_TEST || process.env.SB_BENCH_TIMERS === '1';
  const wake = attachOrchestratorWake(ctx, chats, () => brain.settings().orchestratorEvents !== false && (!process.env.SB_TEST || process.env.SB_ORCHESTRATOR_EVENTS === '1'));
  manager.onUserWrote(n => wake.userMessage(n)); // the user typed in a work chat: quiet news (ADR 0083)
  manager.onCleanReport(n => wake.cleanReport({ ...n, workflow: workflows.list().some(r => r.status === 'active' && r.chatIds.includes(n.chatId)) }));

  const results = attachRunResults(ctx, chats, () => brain.settings().runResults !== false && (!process.env.SB_TEST || process.env.SB_RUN_RESULTS === '1'));
  const heldNews = attachHeldNews(ctx.emitter, wake, mail);
  const source = createAppSource(ctx, () => brain.settings().appRepo ?? null);
  // a chat id passed as a runId: the chat (any state, its run mirror) names the run to use (unknownRunError)
  const chatOf = (id: string) => chats.list().find(c => c.id === id);
  // an agent run's verdict (the user's, a reviewed one, the Orchestrator's) is the known outcome of its chat's ledger
  // line (issue #72, ADR 0078): the routing loop and the rows' reasons learn from the app's own results
  function routingVerdict(run: AgentRun): void {
    const outcome = knownOutcome(run), chat = manager.list().find(c => c.id === run.chatId);
    if (!outcome || !chat?.route) return;
    brain.observeRoutingOutcome(chat.route.ledgerId ?? `app:${chat.id}`, outcome);
  }
  // the verdicts on role runs that are not the user's (a parent's agent_child_feedback, a sampled Sentinel review) and the user's
  // Annulla on a change the app applied (agents/run-feedback.ts)
  const runFeedback = runFeedbackRef.current = new RunFeedback({ userData: ctx.userData, catalog: agents, runs: manager.runs, publish: events => brain.publish(events), chat: chatOf,
    send: (id, text) => chats.send(id, `[Messaggio di un agente tramite second-brain, non scritto dall'utente: non vale come suo ok o permesso]\n${text}`, undefined, false, 'Orchestrator', true),
    onOutcome: run => routingVerdict(run) });
  // the roles' lifecycle (agents/lifecycle.ts, ADR 0083): the "Da approvare" queue, the trial evaluations and the local
  // daily tier suggestions ($0, no model, at most once a day after 18:00 while nothing works). Every entry is applied
  // only by the user's click (agents:lifecycleDecide, sender-checked IPC).
  const lifecycleIdle = () => !manager.pending().length && !asks.pending().length && !runner.list().some(r => r.state === 'running')
    && manager.list().every(c => c.state !== 'starting' && c.state !== 'running' && c.state !== 'waiting' && !c.queued && !workBehind(c));
  const loop = createAgentLoop({ userData: ctx.userData, catalog: agents, runs: manager.runs, feedback: runFeedback, chats,
    idle: lifecycleIdle, emitChanged: () => ctx.emitter.emit('agents:lifecycleChanged', null),
    // the daily pass's new "Da approvare" entries: one normal feed event (ADR 0102)
    proposed: added => { const e = proposalEvent(added, id => agents.list().profiles.find(p => p.id === id)?.name ?? id); if (e) brain.publish([e]); } });
  const lifecycleApi = loop.api;
  mountLifecycleApi(brain, lifecycleApi);
  // a parent's own child runs: listed and judged on its chat's token endpoint (agents/child-feedback.ts)
  addChatTools(childFeedbackTools(lifecycleApi));
  // parent-to-child delegation between role chats (ADR 0083): every chat's own endpoint, the caller is its token's chat
  addChatTools(delegationTools({
    integrate: async (parent, child) => stageDelegatedChanges(delegateWorktrees.allocation(parent, child), parent, child),
    integrateMany: async (parent, children) => stageDelegatedChangesMany(children.map(child => ({ owned: delegateWorktrees.allocation(parent, child), child })), parent), chats: manager, roles: () => agents.list(), settings: () => checkedDelegation(brain.settings().delegation),
    engineRefusal: (from, to) => openRefusal(brain.settings(), from, to), label: AGENT_LABEL, runs: () => manager.runs.list(), worktrees: gitWorktrees, skillTools,
    remember: (roleId, line, chat) => writeAgentMemory(agentPacks.packs.root(), portableId(roleId), line, { scope: { roleId: portableId(roleId), project: chat.cwd }, sourceRunId: chat.run?.runId ?? `chat:${chat.id}`, sourceEventId: `report:${chat.run?.runId ?? chat.id}` }) }));
  // a Strategist's plan with the user (ADR 0108): proposed on its strip, approved by the user's click, its steps' progress
  addChatTools(strategyTools(manager));
  addChatTools(workDecisionTools({ chats: manager, workflows }));
  // the independent reviews of finished runs (agents/judge-sample.ts): they spend tokens, so they run only in the user's
  // own app, never in tests or an agent's hidden run (judgeSamplingOn, issue #112), and only with the Agenti switch on
  const judgeSampler = new JudgeSampler({ file: path.join(ctx.userData, 'judge-samples.json'), runs: () => manager.runs.list(),
    chat: id => manager.list().find(c => c.id === id), create: req => manager.create(req, 'app'),
    judging: () => {
      const st = brain.settings(), on = st.judging === true;
      let since = Number(st.judgingSince) || 0;
      // on by default with no start yet (a fresh install, an upgrade): from now on, never the runs that ended before
      if (on && !since) { since = Date.now(); void brain.setSettings({ judgingSince: since }).catch(e => log.warn('agents', 'judging start not saved', { cause: errText(e) })); }
      return { on, since };
    },
    judgeEngine: () => agents.list().profiles.find(p => p.id === 'sentinel')?.engine ?? 'claude',
    refusal: h => !engineOn(brain.settings(), h) ? 'engine switched off' : !agentsMayOpen(brain.settings(), h) ? 'agents may not use this engine' : null,
    feedback: (a, by) => runFeedback.recordFeedback(a, by),
    // a run its receipts decide is not reviewed (ADR 0130)
    receipts: (runId, verdict, note) => runFeedback.recordReceipts(runId, verdict, note) });
  const judging = judgeSamplingOn(process.env);
  const judgeTick = () => { void judgeSampler.tick().catch(e => log.warn('agents', 'judge sample tick failed', { cause: errText(e), hint: 'tried again in 30 minutes' })); };
  // a run that ends is reviewed soon after (every run with the switch on; a review's own end frees a slot)
  const judgeSoon = () => { if (judging.on && brain.settings().judging === true) setTimeout(judgeTick, 5_000).unref(); };
  loopRef.current = { ended: run => { loop.hooks.ended(run); void judgeSampler.ended(run).finally(judgeSoon); }, outcome: run => loop.hooks.outcome(run) };
  // first a few minutes after the start (a restart within 30 minutes used to postpone it again), then every 30 minutes
  log.info('agents', judging.on ? 'judge samples scheduled' : 'judge samples off', { data: { why: judging.why } });
  const judgeFirst = judging.on ? setTimeout(judgeTick, 3 * 60_000) : null;
  judgeFirst?.unref();
  const judgeTimer = judging.on ? setInterval(judgeTick, 30 * 60_000) : null;
  judgeTimer?.unref();
  const lifecycleTimer = prodPollers ? setInterval(() => loop.tick(), 10_000) : null;
  lifecycleTimer?.unref();
  // a role chat's route says how its active version has done so far
  const agentStats = (agentId: string, version: number) => agentStatsLine(runMetrics(manager.runs.list(), { rollups: manager.runs.rolledUp() }).find(m => m.agentId === agentId)?.versions.find(v => v.version === version));
  const personalLang = () => { const l = brain.settings().language; return l === 'it' || l === 'en' ? l : systemLang(); };
  const personal = new PersonalBrowser({
    emitter: ctx.emitter, window: ctx.window, userData: ctx.userData, cipher: safeStorageCipher(safeStorage), appName: app.getName(), lang: personalLang,
    // «Affida a un agente» (ADR 0133): only a live chat whose role drives a browser gets the tab, told by an app message
    lend: (chatId, view, back) => ({ tabId: browser.lend!(chatId, view, back).id }),
    reclaim: agentTab => browser.close(agentTab),
    canLend: chatId => {
      const it = personalLang() === 'it';
      const c = chats.list().find(x => x.id === chatId);
      if (!c || c.closedAt || c.quick) return it ? 'Chat non trovata o chiusa.' : 'Chat not found or closed.';
      return manager.browserAccess(chatId) === 'all' ? null : it ? 'Questo agente non usa il browser: scegline un altro.' : 'This agent does not drive a browser: pick another one.';
    },
    tell: (chatId, text) => chats.send(chatId, text),
  });
  const recordings = new RecordingStore(path.join(ctx.userData, 'recordings'));
  // routine packages the Orchestrator authors (ADR 0175): <userData>/routines/<id>/routine.json, the Routine section's store
  const routinePackageStore = createFolderPackageStore(path.join(ctx.userData, 'routines'));
  const appDeps: Parameters<typeof attachAppTools>[1] = { workflows, routinePackages: () => routinePackageStore, personal, recordings, runFeedback, contextSince: id => manager.contextSince(id), resolveRole: req => agents.resolve(req), agentLearning: agentPacks.learning, chats, browser, brain, agents: () => agents.list(), window: ctx.window, version: app.getVersion(), runs: chatId => runner.list(chatId), commandAsks: () => asks.pending(), emitUi: cmd => ctx.emitter.emit('ui:command', cmd), tasks: () => tasks.get(), cloud, agentStats, skillTools, brainScripts: { scripts: brainScripts, changelog: brainChangelog },
    // app_config (ADR 0149): each area through the module the app's own page uses
    config: {
      view: { read: () => readUi(ctx.window(), 'typeof window.__sbView === "function" ? window.__sbView() : null'), apply: patch => readUi(ctx.window(), `typeof window.__sbSetView === "function" ? window.__sbSetView(${JSON.stringify(JSON.stringify(patch))}) : null`) },
      agents: { list: () => agents.list(), save: (draft, id, reason) => agentPacks.learning.save(draft, id, reason), history: id => agents.history(id), restore: (id, version) => agents.restoreVersion(id, version) },
      mcp: { state: () => mcpServers.state(), save: a => mcpServers.save(a), setAccess: a => mcpServers.setAccess(a) },
      later: { get: () => later.get(), set: on => later.set(on) },
    } };
  appDeps.routines = { has: id => routines.has(id), exportForTerminal: id => routines.exportForTerminal(id), snapshot: () => routines.snapshot(), archive: () => routineArchive.snapshot(), run: ref => routines.run(ref) };
  attachAppTools(mcp, appDeps, source, false, orchestratorTokens);

  // Task page: the brain's read-only devops-me.mjs as a Node child (no AI, no tokens); on a timer only when turned on
  const node = electronNode();
  const tasks = new TaskService({
    file: path.join(ctx.userData, 'tasks.json'),
    brainRoot: () => brain.info().brainRoot,
    settings: () => brain.settings().tasks,
    run: (script, args, cwd, ms) => runNode(node, script, args, cwd, ms),
    emit: st => ctx.emitter.emit('tasks:state', st),
    feed: events => brain.publish(events),
  });
  brain.onSettingChange(c => { if (c.key.startsWith('tasks.') || c.key === 'brainRoot') tasks.schedule(); });
  tasks.schedule();
  // Qualità page's app half (/api/quality): this app's turns, the PRs of the last DevOps read, the brain's bug-reopen.mjs
  const quality = new Quality({
    logDir: path.join(ctx.userData, 'logs'), cacheFile: path.join(ctx.userData, 'quality-reopen.json'), brainRoot: () => brain.info().brainRoot,
    tasks: () => tasks.get(), run: (script, args, cwd, ms) => runNode(node, script, args, cwd, ms),
  });
  brain.serveApi('/api/quality', q => quality.get({ fresh: q.get('fresh') === '1' }));
  brain.serveApi('/api/agents/analytics', () => manager.analytics.readModel());

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
  const oneShot = new OneShotService({ userData: ctx.userData, profile: id => agents.list().profiles.find(p => p.id === id),
    settings: () => brain.settings(), registry: () => brain.routingInfo().registry,
    hasKey: id => engines.hasKey(id), addApiSpend: (id, usd) => engines.addSpend(id, usd), fallback: () => brain.settings().jobs?.fallback ?? 'auto',
    headless, text: engines.text, runs: manager.runs });
  // only the user's stable app spends tokens on the brain's rounds (the dev instance is run by agents and tests)
  if (queueAllowed(!!releaseId(), process.env)) compareRuns.start();

  // GitHub sync outcomes + product changes in the brain (stable instance only, never in tests): src/main/sync.ts
  let sync: ProductSync | null = null;
  if (releaseId() && !process.env.SB_TEST && process.env.SB_NO_SYNC !== '1') {
    sync = new ProductSync({ base: sharedDir(), brainRoot: () => brain.info().brainRoot, brain, nodeExe: process.execPath });
    sync.start();
  }

  // the Brain pages (ADR 0077): skills and their agents, rules, memory; maintenance jobs with a change log and undo
  const brainModel = new BrainModelService({ userData: ctx.userData, root: () => brain.info().brainRoot, home: process.env.SB_SKILLS_HOME || os.homedir(),
    catalog: agents, packs: agentPacks.packs, learning: agentPacks.learning, runs: () => manager.runs.list(), runsRevision: () => manager.runs.revision, routing: () => brain.routingInfo(),
    emit: () => ctx.emitter.emit('brainmodel:changed', undefined), auto: !process.env.SB_TEST || process.env.SB_BRAIN_JOBS === '1',
    // the Memoria hub's trash (ADR 0122): a script's file, and the Script tab told at once
    scripts: { file: id => brainScripts.get(id).path, changed: () => { brainScripts.invalidate(); ctx.emitter.emit('scripts:changed', undefined); } },
    // the brain upgrade (ADR 0116): Artisan, with no tools, says which notes' excerpts belong in a new place of the layout
    appVersion: () => app.getVersion(),
    upgradeAsk: async (system, prompt) => { const r = await oneShot.runOnce({ agentId: 'artisan', purpose: 'upgrade', system, prompt, maxOutputTokens: 1200, timeoutMs: 90_000 }); return { ok: r.ok, text: r.text, ...(r.reason ? { reason: r.reason } : {}) }; },
    // the pass the user starts reads the app logs (#150) and makes cards of what it found (ADR 0132)
    logDir: () => log.folder,
    findings: logs => researchRef.current?.afterPass(logs) ?? { bugs: 0, forget: 0 },
    // a pass the app ran by itself: a quiet feed event with Annulla (ADR 0102)
    applied: changes => { const e = maintenanceEvent(changes); if (e) brain.publish([e]); } });
  // its cached state (ADR 0182) is read again after whatever the Brain pages refresh on
  ctx.emitter.tap(ch => { if (ch === 'brainmodel:changed' || ch === 'agents:changed') brainModel.invalidate(); });
  brainModelRef.current = brainModel;
  // the one-click maintenance (ADR 0132, 0153): the free cleanup, the invisible research chat, its cards in Proposte
  const issuesUrl = issuesUrlOf(app.getAppPath()), appIssuesUrl = () => issuesUrl;
  const research = new ResearchService({ userData: ctx.userData, lang: uiLang, root: () => brain.info().brainRoot, appVersion: () => app.getVersion(), issuesUrl: appIssuesUrl, appDir: () => app.getAppPath(),
    // engines that are on, read files (an API engine has no tools here) and report their cost (the cap is enforced on
    // it: Codex and the ACP engines report none, so the research would run to the hour with "0 $" on screen)
    engines: () => engineInfos().filter(e => e.kind !== 'api' && e.caps.cost && e.caps.tools && engineOn(brain.settings(), e.id)).map(e => ({ harness: e.id, label: e.label, web: true, effort: e.caps.effort })),
    // the Claude CLI's «opus» is its strongest model, whatever its version; the others start on their CLI's default
    bestModel: h => (engineOf(h)?.kind === 'claude' ? 'opus' : null),
    runs: () => manager.runs.list(), roles: () => agents.list().profiles.filter(p => p.scope === 'role'),
    brain: { state: () => brainModel.state(), apply: p => brainModel.applyResearch(p), noise: (key, known) => { brainModel.noise(key, known); }, maintain: () => brainModel.maintain() },
    chats: { create: req => manager.create(req, 'app'), get: id => manager.list().find(c => c.id === id), stop: id => manager.stop(id) },
    // an approved «Apri issue» card: gh with the user's own login, else GitHub's new-issue page already filled in; an
    // agent's hidden run never reaches GitHub (it records the page like any link it would open)
    issues: { open: (repo, issue) => openIssue(repo, issue, hiddenRun()
      ? { run: () => Promise.reject(new Error('hidden run')), openUrl: async url => { hiddenOpened.push(`external ${url}`); } }
      : { run: ghRun, openUrl: url => shell.openExternal(url) }) },
    saveIdea: idea => saveAiIdea({ root: brain.info().brainRoot, userData: ctx.userData, ...idea, source: 'Manutenzione' }),
    changed: () => ctx.emitter.emit('maintenance:changed', undefined),
    done: d => ctx.emitter.emit('maintenance:done', d) });
  researchRef.current = research;
  // Impara (ADR 0185): each lesson is written by hidden read-only runs (compare/headless.ts) on the best engine that is
  // on and reads files (Claude first, its strongest model), the material gathered by the app with the user's own gh / git
  const teachers = () => engineInfos().filter(e => e.kind !== 'api' && e.caps.tools && engineOn(brain.settings(), e.id));
  const teacher = () => { const all = teachers(); return all.find(e => e.kind === 'claude') ?? all[0] ?? null; };
  const learn = new LearnService({
    store: new LessonStore(path.join(ctx.userData, 'learn')), lang: uiLang, run: runRead,
    devops: () => { const t = tasks.get(); return { prs: t.prs, repoDirs: t.repoDirs }; },
    cannotTeach: () => (teacher() ? null : 'Per preparare una lezione serve un motore acceso che legge i file (Impostazioni → Motori).'),
    teach: async (r: TeachRun) => {
      const e = teacher();
      if (!e) return { ok: false, error: 'nessun motore acceso' };
      const out = await headless.run({ engine: e.id, model: e.kind === 'claude' ? 'opus' : null, effort: e.caps.effort ? r.effort : null, cwd: r.cwd, prompt: r.prompt, round: r.round, timeoutMs: r.timeoutMs });
      return out.ok ? { ok: true, text: out.text, costUsd: out.costUsd, engine: e.id, model: out.model } : { ok: false, error: out.error };
    },
    changed: (state, lesson) => ctx.emitter.emit('impara:changed', { state, ...(lesson ? { lesson } : {}) }),
  });
  ctx.emitter.tap((channel, payload) => { if (channel === 'chat:updated') research.chatUpdated(payload as ChatSummary); });
  addChatTools(researchTools(research));
  const replayRoot = () => { const root = brain.info().brainRoot; return root ? fs.realpathSync(root) : null; };
  const executeReplay = replayExecutor({ root: replayRoot, runs: () => manager.runs.list(),
    roleEngine: role => agents.list().profiles.find(p => p.id === role)?.engine ?? 'claude',
    create: request => manager.create(request, 'app'), feedback: args => runFeedback.recordFeedback(args, 'evaluation-replay') });
  const learningReview = new LearningReviewService({ lessonSources: () => agentPacks.learning.waiting().flatMap(p => p.assessment?.state === 'supported' ? p.assessment.sources.map(source => source.runId) : []), userData: ctx.userData, root: replayRoot, log: brainModel.log, runs: () => manager.runs.list(),
    execute: request => { if (request.brainRoot !== replayRoot()) throw new Error('Brain changed before replay.'); return executeReplay(request); } });
  brainModel.start();
  // the morning block ("Mentre eri via", ADR 0102): zero tokens, from what the app holds
  const morning = new MorningService({ file: path.join(ctx.userData, 'morning.json'), chats: () => manager.list(), runs: () => manager.runs.list(),
    pending: () => manager.pending().length + asks.pending().length,
    approvals: () => agents.list().profiles.filter(p => p.scope === 'role' && p.trial).length + lifecycleApi.read({}).proposals.filter(p => p.kind === 'tier').length,
    tasks: () => tasks.get(), cloud: () => cloud.state().agents, changes: () => brainModel.changes(), api: p => brain.api(p),
    stallMin: () => checkedDelegation(brain.settings().delegation).stallMin, lastEventAt: id => manager.lastEventAt(id) });

  return {
    workflows, routineArchive, routines, brainModel, research, memoryReview, learningReview, queries: brainQueries,
    morning,
    mcpServers,
    cloud, chats, browser, personal, recordings, learn, brain, mcp, runner, asks, wake, heldNews, tasks, skills, source, later, engines, agents, runFeedback, agentLifecycle: lifecycleApi, agentPacks, oneShot, agentRuns: manager.runs, autoClose: autoCloseService, progress: progressService, hybrid,
    updateChats: {
      problem: () => manager.updateReadiness() ?? (runner.list().some(r => r.state === 'running') ? 'Un comando è ancora in esecuzione.' : asks.pending().length ? 'Ci sono comandi da verificare prima di aggiornare.' : compareRuns.working ? 'Un confronto tra modelli è ancora in corso.' : null),
      checkpoint: () => manager.checkpointForUpdate(),
    },
    setup: new SetupService(ctx.userData, chats.list().length > 0 || !!brain.settings().brainRoot),
    // computed once in the background at start (spawning the CLIs takes seconds); cli:status gives a fresh one
    cli: () => cliCache ? { ...cliCache, ...engineReadiness() } : Object.keys(engineReadiness()).length ? engineReadiness() : null,
    shutdown: async () => { routines.stop(); mcpServers.stop(); brainModel.stop(); cloud.shutdown(); clearInterval(autoCloseTimer); if (lifecycleTimer) clearInterval(lifecycleTimer); hybrid.stop(); engines.stop(); sweeper.stop(); artifacts.stop(); sync?.stop(); mail.stop(); asks.stop(); wake.stop(); results.stop(); runner.shutdown(); tasks.shutdown(); await Promise.allSettled([compareRuns.stop(), chats.shutdown(), browser.shutdown(), personal.shutdown(), brain.shutdown()]); },
    killNow: () => { compareRuns.killNow(); manager.killAll(); runner.shutdown(); },
  };
}
