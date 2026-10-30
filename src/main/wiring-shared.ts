// The construction steps shared by the real wiring (wiring.ts) and the demo's (demo-wiring.ts): the app-control MCP
// tools, «Rispondi dopo», the «Esegui» runner and its requests, the emitter taps (Orchestrator wake, run results,
// show_ui visuals), «Aggiorna» from GitHub and the role catalog. Each takes what it needs; none keeps state here.
import { app } from 'electron';
import type { CliStatus, Harness, RunInfo } from '../shared/contract';
import { SEND_MODE_RULE } from '../shared/newchat';
import { engineInfos, engineOf, priceEnginesOf } from './engines/registry';
import { withApiModels } from './engines/sessions';
import { AgentCatalogService } from './agents/catalog';
import { tierModel } from './agents/model-tier';
import { CATALOG_GUIDANCE } from './agents/discovery';
import { agentsMayOpen, engineOn } from './engines/policy';
import type { EnginesApi } from './engines/service';
import type { BrainService, ChatService } from './services';
import type { McpServer, McpTool, ToolOutput } from './mcp/server';
import { type ToolDef, type ToolOut, appControlTools, orchestratorEndpointAuth } from './appctl/tools';
import type { EndpointTokens } from './mcp/tokens';
import fs from 'node:fs';
import { CommandRunner } from './run/runner';
import { CommandAsks } from './run/asks';
import { RunResults } from './run/results';
import { OrchestratorWake } from './chats/orchestrator-wake';
import { AppSourceService, cleanEnv, findNode } from './update/source';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { errText, log } from './log';
import { AnswerLaterStore } from './later';
import { Artifacts } from './genui/artifacts';
import { releaseId } from './release';
import { launcherName, restartWaiter, sharedDir } from './platform';
import type { Ctx } from './wiring-types';

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
    tierModel: (engine, tier) => tierModel(engine, tier, brain.modelRegistry(), brain.settings().modelTiers),
    pulsePreset: () => {
      const choices = engineInfos();
      const e = choices.find(e => e.kind === 'api' && agentsMayOpen(brain.settings(), e.id) && engines.hasKey(e.id))
        ?? choices.find(e => e.kind === 'claude');
      const model = e ? brain.modelRegistry()?.models.find(m => priceEnginesOf(e).includes(m.harness) && m.tier === 'mid')?.id ?? (e.kind === 'claude' ? 'sonnet' : null) : null;
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
