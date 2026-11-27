// ChatManager layer (ADR 0200): engine sessions. Starting a chat's engine (sessions.ts, the launch options: mode, MCP
// endpoints, extra arguments, the compaction window), the warm pool and prewarm, releasing idle engines, killing
// the process trees on quit, get_usage, the browser access and tool visibility a chat has.
import crypto from 'node:crypto';
import fs from 'node:fs';
import type { ChatItem, CliStatus, CursorReasoning, Harness, PermissionMode } from '../../shared/contract';
import { errText, log } from '../log';
import { cliVersion, killTrees, killTreesWithin, resolveClaude } from './cli';
import { reapAfterQuit } from './proctree';
import { jobGuard } from './jobguard';
import { engineEnv } from './engine-env';
import { coldArmed, coldRoute, type ColdView } from './continuity';
import { isSessionId, isUuid, type HarnessSession, type SessionOptions, type SessionSink } from './session';
import { updateActivity } from '../update/activity';
import { BufferedSink, PLAIN_LAUNCH, type WarmEngine, type WarmLaunch } from './warm';
import { AgentMayNotWake } from '../engines/policy';
import { appAsks, engineOf, engineOrThrow } from '../engines/registry';
import { sessionFor } from '../engines/sessions';
import { findTranscript } from './transcript';
import { aboveCeiling, browserAccess, claudeDefaultMode, claudeDefaultSetting, type AgentPolicy, type BrowserAccess } from '../agents/tool-policy';
import { TurnToolBudget } from '../agents/orchestrator-budget';
import { APP_CHAT_TOOLS } from './app-tool-approval';
import { needView, toolShownToChat, toolShownToUnknown, toolShownToWarm } from './tool-visibility';
import { ORCHESTRATOR_APP_REQUIRED, requiredTools } from '../../shared/role-tools';
import { saysToolMissing, toolAction, type ToolAction } from './tool-check';
import { toolCliEnv, toolCliHint } from './tool-cli';
import { codeModeFor, CODE_MODE_HIDDEN, RUN_CODE } from '../code-mode/policy';
import { AgentChildrenReducer } from './agent-children';
import { initialEffort } from './effort';
import type { Rec } from './manager-types';
import { PREWARM_UNUSED_MS, workBehind, subagentGateFor } from './manager-helpers';
import { ManagerPersistence } from './manager-persistence';

/** The catalog role a chat runs as (its card's launch switches: Code Mode, Cursor's fast); undefined = no role. */
const catalogRole = (s: Rec['s']): string | undefined => s.agent?.source === 'catalog' ? s.agent.id : undefined;

/** A work chat that delivered its result releases its idle engine after this long (#360). */
export const DELIVERED_RELEASE_MS = 5 * 60_000;

/** Engine sessions: start, launch options, warm engines, the kill on quit, the per-chat MCP and tool visibility. */
/** Every assistant text of the last turn (since the last user item): a model may say a tool is missing, try something
 *  else and end with a short line. */
const turnAnswers = (items: readonly ChatItem[]): string => {
  const out: string[] = [];
  for (let i = items.length - 1; i >= 0 && items[i]!.kind !== 'user'; i--) { const it = items[i]!; if (it.kind === 'assistant') out.unshift(it.text); }
  return out.join('\n\n');
};

/** The engine is handed the app's MCP endpoint for sure (ADR 0356): Claude and Codex always; an ACP engine only when
 *  the app knows it takes an http server (mcpHttp). An API engine has no tools and no shell, so nothing is checked; an
 *  ACP engine that may not take it is checked only from the lists it really read (no reload for a list never read). */
const endpointGiven = (e: ReturnType<typeof engineOf>): boolean => !!e && (e.kind === 'claude' || e.kind === 'codex' || (e.kind === 'acp' && !!e.mcpHttp));

export abstract class ManagerSessions extends ManagerPersistence {

  /** The engines running now and their chats, the waiting warm engine included (its chat id is the next chat's), plus
   *  the chats still open (the orphan sweep's owners, sweep.ts). */
  engines(): { live: { chatId: string; pid: number }[]; open: string[] } {
    const all = [...this.chats.values()];
    return {
      live: all.flatMap(r => (r.session?.alive && r.session.pid ? [{ chatId: r.s.id, pid: r.session.pid }] : []))
        .concat(this.warm.engines.flatMap(w => (w.session.alive && w.session.pid ? [{ chatId: w.chatId, pid: w.session.pid }] : []))),
      open: all.filter(r => !r.s.closedAt).map(r => r.s.id),
    };
  }

  /** Ends the engines of chats idle for `idleMs` (setting engineIdleMin): no turn, question, queue, background task or
   *  hand-off, never an Orchestrator; idle counts from the last send, turn or end of a background task (activeAt). The chat stays on the grid as idle; its next message resumes it (ensureSession). Each
   *  engine ends like a ✕ (its tools reaped, its job released). Returns how many were released. */
  releaseIdle(idleMs: number, now = Date.now()): number {
    if (idleMs <= 0 || this.quitting || updateActivity.frozen) return 0;
    let n = 0;
    for (const r of this.chats.values()) {
      const sess = r.session;
      // sub-agents as the auto-close counts them (childrenDone): the CLI engines never report a complete census, so
      // asking for one (unsettledChildren) kept every Claude engine alive forever (#360: 34 idle claude processes, 7 GB)
      if (!sess?.alive || sess.busy || r.releasing || r.archiving || r.opening || r.switching || r.autoClosing || (r.deliveryHolds ?? 0) > 0 || !this.childrenDone(r) || this.observedChildrenBusy(r) || r.handoffTurn || r.s.closedAt || r.s.isOrchestrator) continue;
      if (r.s.state !== 'idle' || r.pending.size > 0 || workBehind(r.s)) continue;
      // a work chat that delivered its result has nothing left to do: its engine goes after a few minutes, not the
      // setting's half hour (#360), even when something else keeps the chat itself open
      const delivered = !!r.s.delegation?.result || r.s.work?.status === 'completed';
      if (now - Math.max(r.activeAt ?? 0, r.lastTurnAt) < (delivered ? Math.min(idleMs, DELIVERED_RELEASE_MS) : idleMs)) continue;
      // a long chat waiting for its cold note keeps its engine: a resumed one would miss the cache (ADR 0031)
      if (this.coldOn() && coldArmed(this.coldView(r), now, this.ttl())) continue;
      n++;
      log.info('chats', 'idle engine released', { chat: r.s.id, data: { idleMin: Math.round((now - Math.max(r.activeAt ?? 0, r.lastTurnAt)) / 60000), pid: sess.pid, delivered } });
      // an idle engine ends like a close: the tools it started (test runners, shells, MCP servers) end with it, kept
      // ones of earlier engines too (#350: test runners of idle chats ran for hours and kept the CPU at 100%)
      r.releasing = sess.close().then(() => this.reapKept(r)).finally(() => { r.releasing = undefined; });
    }
    return n;
  }

  /** Synchronous last resort (before app.exit, will-quit, process exit): a detached taskkill /T for every CLI process
   *  still alive, never waited for (it finishes the tree after the app is gone; the CLI itself dies with libuv's
   *  kill-on-close job). Never blocks: the bounded wait is shutdown's (killLeft). No-op when nothing is alive.
   *  `sync`: the process exits right now (its 'exit' event). Otherwise (before app.exit: shutdown may have hit its cap
   *  before killLeft) the guard's helper stays for the quit's booster (jobguard.ts quit). */
  override killAll(sync = false): void {
    const loose = this.takeLeft(sync);
    if (loose.length) killTrees(loose.map(x => x.pid), { fallback: () => { for (const x of loose) x.killNow(); } });
  }

  /** shutdown's last kill: like killAll, then waits (without blocking) at most `ms` for those processes to die; the
   *  ones still alive go with what `kids` pictured them starting. */
  protected async killLeft(ms: number, kids: (pid: number) => number[], spawnMs: number): Promise<void> {
    const loose = this.takeLeft(false);
    const started = new Map(loose.map(x => [x.pid, x.startedAt ?? 0]));
    // their tree kill (taskkill /T) already runs since shutdown's killNow: no second one to spawn
    if (loose.length) await killTreesWithin(loose.map(x => x.pid), ms, { started: { spawnMs }, kids, after: (pids, at) => reapAfterQuit(pids.map(pid => ({ pid, created: started.get(pid) ?? 0, exited: at }))) });
  }

  /** The CLI processes still alive and not killed yet, marked killed; engines in a Job Object end with the guard's
   *  handles (kill-on-close, no taskkill), so only the others ("loose") are returned. `sync`: no await may follow
   *  (process exit), so the guard's helper is ended at once; otherwise it closes the jobs and stays for the quit's
   *  booster (jobguard.ts quit). */
  private takeLeft(sync: boolean): HarnessSession[] {
    // a killed pid stays "alive" until the loop runs 'close' again: never taskkill it twice (1-40 s each)
    const left = [...this.chats.values()].map(r => r.session).concat(this.warm.engines.map(w => w.session)).filter((x): x is HarnessSession => !!x && x.alive && !x.gone && !!x.pid && !this.killedPids.has(x.pid));
    if (!left.length) return [];
    log.warn('chats', 'killing CLI processes still alive at quit', { data: { pids: left.map(x => x.pid) } });
    for (const x of left) if (x.pid) this.killedPids.add(x.pid);
    const loose = left.filter(x => !jobGuard.has(x.jobHandle));
    if (loose.length < left.length) { if (sync) jobGuard.stop(); else void jobGuard.closeAll(); }
    return loose;
  }

  /** Claude engine status: found, path, version (from a session or the background `claude --version`). */
  cliStatus(): CliStatus {
    const p = resolveClaude(this.opts.enginePaths?.claude ?? null)?.path ?? null;
    const found = !!p && fs.existsSync(p);
    if (found && !this.version && !this.probing) {
      this.probing = true;
      void cliVersion(p).then(v => { if (v && !this.version) { this.version = v; log.info('chats', 'claude CLI', { data: { path: p, version: v } }); } });
    }
    return { found, path: p, version: this.version, loggedIn: null };
  }

  /** The app runs this session (full id or an id prefix of 8+ chars, as chats.mjs prints): the brain's poll skips it. */
  isOwnSession(idOrPrefix: string): boolean {
    const p = String(idOrPrefix ?? '').trim().toLowerCase();
    if (p.length < 8) return false;
    return [...this.chats.values()].some(r => !!r.s.sessionId && r.s.sessionId.toLowerCase().startsWith(p));
  }

  /** First send of a job: the first prompt for the ledger. */
  protected startJob(r: Rec, prompt: string): void {
    r.jobNew = false;
    r.firstPrompt = prompt;
  }

  /** Starts the chat's engine if it is not running (a resumed Cursor chat: waits until its replayed past has landed). */
  protected async ensureSession(r: Rec): Promise<void> {
    updateActivity.assertOpen();
    if (r.releasing) await r.releasing; // never into an engine released for idleness: it ends, then this resumes
    if (!r.session) {
      this.needOn(r.s.harness);
      this.startSession(r);
      // a resumed chat on an engine that replays its past while it opens (ACP): let it land before this message, in order
      const started = r.session as HarnessSession | null;
      if (started?.ready && engineOf(r.s.harness)?.caps.transcript === false && isSessionId(r.s.sessionId)) r.opening = started.ready;
    }
    if (r.opening) { await r.opening; r.opening = undefined; }
  }

  /** Asks a live Claude session for get_usage, at most once per usageEveryMs: the plan windows for the top bar and, in
   *  a running turn, its real cost so far (claude.ts). Busy chats take turns, so each one's live cost gets corrected. */
  protected override askUsage(prefer?: Rec): void {
    const rate = this.opts.onRateLimit;
    if (!rate || Date.now() - this.lastUsageAt < (this.opts.usageEveryMs ?? 60000)) return;
    const live = (x: Rec | undefined): x is Rec => !!x?.session?.alive && !!engineOf(x.s.harness)?.caps.usage;
    const all = [...this.chats.values()].filter(live);
    const busy = all.filter(x => x.session?.busy);
    const next = busy.length ? busy[(busy.findIndex(x => x.s.id === this.lastUsageChat) + 1) % busy.length] : undefined;
    const r = live(prefer) ? prefer : next ?? all[0];
    if (!r?.session) return;
    this.lastUsageAt = Date.now();
    this.lastUsageChat = r.s.id;
    r.session.usage().then(u => { if (u) this.hook('onRateLimit', () => rate(u)); })
      .catch(e => log.debug('chats', 'get_usage not answered', { chat: r.s.id, data: errText(e) }));
  }

  /** Starts the open Orchestrator's engine (a resume, no message) when it has none: what the user writes first finds it up. */
  protected override prewarmOrchestrator(): void {
    const r = [...this.chats.values()].find(x => x.s.isOrchestrator && !x.s.closedAt);
    if (!r || r.session || this.quitting || updateActivity.frozen || !engineOf(r.s.harness)?.caps.warm || this.opts.engineOn?.(r.s.harness) === false || !fs.existsSync(r.s.cwd)) return;
    log.info('chats', 'Orchestrator engine started ahead of the first message', { chat: r.s.id });
    this.ensureSession(r).catch(e => log.warn('chats', 'Orchestrator engine not started ahead', { chat: r.s.id, cause: errText(e), hint: 'it starts with the first message as before' }));
  }

  /** The user started typing in a chat with no engine (restored after a restart, or its engine ended): it resumes
   *  now (a resume, no message, no tokens), so the CLI's start-up (10-25 s measured in ADR 0025, more on a busy Windows
   *  PC) runs while the user types instead of after the Enter. Never for a chat whose next message goes, or will soon
   *  go, to a fresh session (coldRoute: the switch starts that one), nor for one closed, queued, closing or opening.
   *  An engine nobody writes to within PREWARM_UNUSED_MS ends again (no Claude engine is released for idleness while
   *  its sub-agents cannot be observed, so nothing else would end it). True = an engine starts. */
  prewarm(chatId: string): boolean {
    const r = this.chats.get(chatId);
    if (!r || r.session || r.releasing || r.archiving || r.switching || r.opening || r.s.closedAt || r.s.state === 'error') return false;
    if (this.quitting || updateActivity.frozen || this.admission?.entry(r.s.id)) return false;
    if (!engineOf(r.s.harness)?.caps.warm || this.opts.engineOn?.(r.s.harness) === false || !isUuid(r.s.sessionId) || !fs.existsSync(r.s.cwd)) return false;
    const now = Date.now();
    if (this.coldOn() && coldRoute(this.coldView(r), now + (this.opts.prewarmUnusedMs ?? PREWARM_UNUSED_MS), this.ttl())) return false;
    // never a quiet cold-note turn on an engine started only for this: without it the chat could not write one either
    r.coldAskedFor = r.lastTurnAt;
    r.activeAt = now;
    const turns = r.lastTurnAt;
    log.info('chats', 'engine started while the user types', { chat: r.s.id });
    this.ensureSession(r).catch(e => log.warn('chats', 'engine not started ahead of the message', { chat: r.s.id, cause: errText(e), hint: 'it starts with the message, as before' }));
    const sess = r.session as HarnessSession | null;
    const unused = (): void => {
      if (this.quitting || this.chats.get(chatId) !== r || r.session !== sess || !sess!.alive || r.working || r.lastTurnAt !== turns) return;
      // still starting, or briefly held: look again later instead of leaving the engine running for good
      if (sess!.busy || r.releasing || r.archiving || r.switching || r.pending.size > 0 || (r.deliveryHolds ?? 0) > 0 || this.deliveries.has(chatId)) {
        setTimeout(unused, this.opts.prewarmUnusedMs ?? PREWARM_UNUSED_MS).unref(); return;
      }
      log.info('chats', 'engine started while typing ended unused', { chat: r.s.id });
      // it never ran a turn, so it started no dev server to keep: its MCP servers end with it (a kept one was reaped
      // only when the chat really closed, so every unused prewarm left its tools running until then)
      r.releasing = sess!.close().finally(() => { r.releasing = undefined; });
    };
    if (sess) setTimeout(unused, this.opts.prewarmUnusedMs ?? PREWARM_UNUSED_MS).unref();
    return true;
  }

  /** The mode a session really starts with (ADR 0290). A Claude chat with no mode of its own starts in «default»,
   *  never in the engine's own default: there every request reaches the app, which lets it through unless a rule of
   *  the user's brain holds it (auto-permit.ts, ADR 0254). Left to the engine, a user whose Claude Code default is
   *  «auto» had its classifier refuse the agents before the app was asked (about 600 refusals in a month of the
   *  owner's chats, 128 of the 136 sessions with one were in auto). A mode the user picks on the chat still wins,
   *  and so does «plan» as their engine default; this default is not a choice, so it never narrows a child (modeFor
   *  is what the delegation reads). A waiting engine starts with no mode and gets this one when a chat takes it. */
  protected launchMode(r: Rec): PermissionMode | null {
    const mode = this.modeFor(r);
    if (mode || engineOf(r.s.harness)?.kind !== 'claude') return mode;
    // only over a default the app knows and that asks no less than «default». «plan», a mode it does not know
    // («dontAsk») or settings it cannot read stay the engine's: there the user asked for less, or the app cannot tell
    const own = claudeDefaultSetting(r.s.cwd, { ...process.env, ...this.opts.env });
    if (own !== 'plan' && own !== 'unknown') return 'default';
    log.info('chats', 'chat left in the engine\'s own default mode', { chat: r.s.id, data: { default: own } });
    return null;
  }

  /** The chat's mode as chosen: min(ceiling, Brother's mode), null = no choice and nothing to clamp. Brother's mode is
   *  the chat's choice, or for Claude the default of his settings (a ceiling clamps that too); other engines narrow
   *  through their own options (ceiling). What a session starts with is launchMode. */
  protected modeFor(r: Rec): PermissionMode | null {
    const ceiling = r.policy?.ceiling ?? null, chosen = r.choice.permissionMode;
    if (!ceiling) return chosen;
    const brother = chosen ?? (engineOf(r.s.harness)?.kind === 'claude' ? claudeDefaultMode(r.s.cwd, { ...process.env, ...this.opts.env }) : null);
    return brother && aboveCeiling(brother, ceiling) ? ceiling : chosen;
  }

  /** The mode of r that bounds its children (ADR 0085, 0290): its chosen mode or its ceiling's clamp, but never a
   *  «default» picked on the chat. That pick narrows nothing for the chat itself (the app answers its requests, ADR
   *  0254), so it narrows no child; a role limited to «Chiede conferma» still does, through its policy. */
  protected boundMode(r: Rec): PermissionMode | null {
    const mode = this.modeFor(r);
    return mode === 'default' ? null : mode;
  }

  /** Which of the app's browser tools the chat's role may use (tool-policy.ts browserAccess): the per-chat MCP serves
   *  all of them, only the reading ones, or none. */
  browserAccess(chatId: string): BrowserAccess {
    const r = this.chats.get(chatId);
    // the Orchestrator delegates browsing like any other work (ADR 0090, 0099): its 24 browser tools (~4 200 tokens of schemas)
    // were in every one of its calls
    if (r?.s.isOrchestrator) return 'none';
    const warm = r ? undefined : this.warmViews.get(chatId);
    if (warm?.view) return browserAccess({ tools: warm.toolPolicy ?? null, ceiling: warm.ceiling ?? null });
    return browserAccess(r?.policy);
  }

  /** Whether a chat sees one of the tools added to its own endpoint: only those its kind could never use are left out
   *  (refused for that kind of chat, or already on its own endpoint), so nothing that works today is lost. The
   *  Orchestrator opens root chats with app_create_chat, reports to no one and has catalog and lessons on its own
   *  endpoint (second-brain-app); a chat with no parent has no one to ask. */
  chatToolShown(chatId: string, tool: string): boolean {
    const r = this.chats.get(chatId);
    // run_code only for a chat whose engine was started in Code Mode (ADR 0331): off = the tool does not exist for it
    if (tool === RUN_CODE) return r ? r.codeMode === true : this.warmViews.get(chatId)?.codeMode === true;
    if (r) return toolShownToChat(r.s, r.launches, tool, appAsks(engineOf(r.s.harness)));
    const warm = this.warmViews.get(chatId)?.view;
    return warm ? toolShownToWarm(warm, tool) : toolShownToUnknown(tool);
  }

  /** The tools this chat's role must have (shared/role-tools.ts, ADR 0356); [] for a chat the app does not know. */
  requiredToolsOf(chatId: string): string[] {
    const r = this.chats.get(chatId);
    return r ? requiredTools(needView(r.s, r.launches, appAsks(engineOf(r.s.harness)))) : [];
  }

  /** The chat endpoint served a tool list to the chat's engine (browser/service.ts): the session's check runs. */
  toolsServed(chatId: string, names: readonly string[]): void {
    const r = this.chats.get(chatId);
    // a waiting engine's list (warm.ts): the chat that adopts it takes it (adoptWarm)
    if (!r && this.warmViews.has(chatId)) { this.warmServed.set(chatId, [...names]); return; }
    if (!r?.toolSession) return;
    r.toolSession.served = [...names];
    this.toolCheck(r);
  }

  /** The Orchestrator's app-control endpoint (second-brain-app) served a tool list: the session's check runs. */
  appToolsServed(chatId: string, names: readonly string[]): void {
    const r = this.chats.get(chatId);
    if (!r?.toolSession) return;
    r.toolSession.appServed = [...names];
    this.toolCheck(r);
  }

  /** App-control tools required on second-brain-app (Orchestrator only; empty for every other chat). */
  private appRequiredOf(r: Rec): readonly string[] {
    return r.s.isOrchestrator && this.appMcpFor(r) ? ORCHESTRATOR_APP_REQUIRED : [];
  }

  /** the tool lists a waiting engine read before a chat adopted it */
  private readonly warmServed = new Map<string, string[]>();

  /** The engine said which tools it loaded (Claude's init `tools`): the session's check runs. */
  protected toolsLoaded(r: Rec, names: readonly string[]): void {
    if (!r.toolSession) return;
    r.toolSession.engineSaw = [...names];
    this.toolCheck(r);
  }

  /** A turn of this session ended: an engine that never read its endpoint(s) is found now, and so is a model that says a
   *  required tool is not among its own (agy drops them when its MCP preload times out, with the list served: 2026-11-25) */
  protected toolTurnEnded(r: Rec): void {
    const s = r.toolSession;
    if (!s) return;
    // only where the app cannot see what the engine loaded (ACP and Codex engines: no init list of tools)
    const kind = engineOf(r.s.harness)?.kind;
    const said = s.acted === 'fallback' || s.engineSaw || (kind !== 'acp' && kind !== 'codex') ? [] : saysToolMissing(turnAnswers(r.items), [...this.requiredToolsOf(r.s.id), ...this.appRequiredOf(r)]);
    if (said.length) s.saidMissing = said;
    if (s.turnEnded && !said.length) return;
    s.turnEnded = true;
    this.toolCheck(r);
  }

  /** On an engine with a tight schema budget (Antigravity) the fallback command goes with the role's text, before any
   *  tool is missed (ADR 0356): a drop inside the engine is not always seen by the app. */
  protected compactToolHint(r: Rec): string {
    const s = r.toolSession;
    if (!s || s.hinted || !engineOf(r.s.harness)?.mcpCompact) return '';
    const need = [...this.appRequiredOf(r).slice(0, 4), ...this.requiredToolsOf(r.s.id)];
    if (!need.length) return '';
    s.hinted = true;
    return `${toolCliHint(need)}\n\n`;
  }

  private toolCheck(r: Rec): void {
    const s = r.toolSession;
    if (!s) return;
    const eng = engineOf(r.s.harness);
    const hasChat = !!this.opts.mcpUrlFor?.(r.s.id) && (endpointGiven(eng) || !!s.served);
    const hasApp = !!this.appMcpFor(r) && (endpointGiven(eng) || !!s.served || !!s.appServed);
    const a = toolAction(this.requiredToolsOf(r.s.id), s, r.toolReloads ?? 0, hasChat, this.appRequiredOf(r), hasApp);
    if (a.kind === 'ok' || a.kind === 'wait') return;
    s.acted = a.kind;
    if (a.kind === 'reload') r.toolReloads = (r.toolReloads ?? 0) + 1;
    log.warn('chats', a.kind === 'reload' ? 'required tools missing: reloading the session' : 'required tools missing: fallback command given', { chat: r.s.id,
      cause: `${a.missing.join(', ')}: ${a.why}`, hint: a.kind === 'reload' ? 'the next turn starts a fresh engine process on the same session' : 'the chat calls them with sb-tool (chats/tool-cli.ts)',
      data: { harness: r.s.harness, missing: a.missing, served: s.served?.length ?? null, appServed: s.appServed?.length ?? null, engineSaw: s.engineSaw?.length ?? null } });
    this.toolGap(r, a);
  }

  /** What the manager does with a gap (ChatManager): reload the session, or tell the chat the fallback command. */
  protected abstract toolGap(r: Rec, a: Extract<ToolAction, { missing: string[] }>): void;

  /** Whether this chat's engine needs compact MCP tool descriptions on its chat endpoint (ADR 0332). */
  chatToolsCompact(chatId: string): boolean {
    const r = this.chats.get(chatId);
    return !!r && engineOf(r.s.harness)?.mcpCompact === true;
  }

  private mcpConfig(chatId: string): string | null {
    const url = this.opts.mcpUrlFor?.(chatId) ?? null;
    const app = this.appMcpFor(this.chats.get(chatId));
    const servers: Record<string, { type: 'http'; url: string }> = {};
    // no server-wide alwaysLoad: only each chat's required tools carry _meta anthropic/alwaysLoad (ADR 0371 point 2,
    // browser/service.ts and wiring-shared.ts); the rest stay behind ToolSearch, as the minimal harness wants
    if (url) servers['second-brain'] = { type: 'http', url };
    if (app) servers['second-brain-app'] = { type: 'http', url: app };
    for (const ext of this.opts.extMcp?.(chatId).servers ?? []) servers[ext.name] ??= { type: 'http', url: ext.url };
    return Object.keys(servers).length ? JSON.stringify({ mcpServers: servers }) : null;
  }

  /** The chat as the MCP access sees it (ADR 0086): its role and each parent's, own first, and its tool policy; null =
   *  not a chat of this app. A chat whose parent is gone keeps the parent's place as no role (its policy, narrowed at
   *  start by that parent, still holds). */
  mcpContext(chatId: string, seen = new Set<string>()): { roles: (string | null)[]; policy: AgentPolicy | null } | null {
    const r = this.chats.get(chatId);
    // a warm engine's chat does not exist yet: no role and no parent until a chat adopts it (a role's launch only fixes
    // its tool list, which the engine enforces itself); once adopted, its real role is read at every gateway call
    if (!r) {
      const warm = this.warmViews.get(chatId);
      if (warm?.view && (this.warmChat === chatId || this.warm.has(chatId))) return { roles: [warm.view.role, ...(warm.view.child?.ancestors ?? [])], policy: { tools: warm.toolPolicy ?? null, ceiling: warm.ceiling ?? null } };
      return this.warmChat === chatId || this.warm.has(chatId) ? { roles: [null], policy: null } : null;
    }
    const policy = r.policy ?? null, own = r.s.agent?.source === 'catalog' ? r.s.agent.id : null;
    if (!r.s.parentId) return { roles: [own], policy };
    // a child is bounded by its ancestors' roles: the chain frozen at its creation, else (saved before it existed) the
    // live parents; a parent that is gone with no frozen chain = fail closed (no managed server), never a wider child
    if (r.mcpAncestors) return { roles: [own, ...r.mcpAncestors], policy };
    seen.add(chatId);
    if (seen.has(r.s.parentId) || seen.size > 16) return null;
    const up = this.mcpContext(r.s.parentId, seen);
    return up ? { roles: [own, ...up.roles], policy } : null;
  }

  /** the app-control endpoint of an Orchestrator, null for any other chat */
  private appMcpFor(r: Rec | undefined): string | null {
    if (!r) return null;
    if (r.s.isOrchestrator) return this.opts.appMcpUrl?.(r.s.id) ?? null;
    return null;
  }

  protected startSession(r: Rec): void {
    r.s.effortStatus = initialEffort(!!engineOf(r.s.harness)?.caps.effort, r.choice.effort);
    const chatId = r.s.id;
    let sessionId = r.s.sessionId;
    let resume = false, fork = false;
    const engine = engineOrThrow(r.s.harness);

    if (!engine.caps.transcript) resume = isSessionId(sessionId); // session/load (OpenCode: ses_…); a new one gets its id from session/new
    else if (!sessionId && r.forkFrom) { sessionId = r.forkFrom; resume = true; fork = true; }
    else if (isUuid(sessionId) && findTranscript(sessionId, r.s.cwd, this.home)) resume = true;
    else if (!isUuid(sessionId)) { sessionId = crypto.randomUUID(); r.s.sessionId = sessionId; this.persist(); }
    // the role text is in the context only when this very session resumes (a fork of an external one never had it)
    if (!resume || fork || !r.rolePrimed || r.rolePrimed.session !== sessionId) r.rolePrimed = undefined;
    r.roleChecked = false;
    // the previous engine's sub-agents it never saw end ('unknown') died with it: a new engine cannot settle them
    const before = resume ? r.children?.snapshot() : undefined;
    const past = before ? { ...before, children: before.children.filter(x => x.state !== 'unknown') } : undefined;
    r.children = new AgentChildrenReducer(past);
    r.children.coverage(engine.kind === 'api' ? 'complete' : 'unknown');
    r.s.agentChildren = r.children.snapshot();
    // per role (its card, ADR 0331 since 2026-11-23): a chat with no catalog role runs without it
    r.codeMode = codeModeFor(r.s, this.opts.codeMode?.(catalogRole(r.s)) === true);
    const extraArgs = this.extraArgsFor(r.s.harness, chatId, r);
    // kept on the chat too: run_code's internal calls pass the same hook (decideFor, ADR 0331)
    const preToolUse = engine.kind !== 'claude' ? null : r.s.isOrchestrator ? new TurnToolBudget() : subagentGateFor(r.policy?.tools, r.s.cwd).preToolUse ?? null;
    r.preToolUse = preToolUse;
    const opts: SessionOptions = {
      chatId, cwd: r.s.cwd, model: r.choice.model, effort: r.choice.effort, permissionMode: this.launchMode(r), title: r.s.title,
      ...(r.policy ? { toolPolicy: r.policy.tools, ceiling: r.policy.ceiling } : {}),
      ...(r.agentAssets ? { agentAssets: r.agentAssets } : {}),
      // the Orchestrator's turn stays short: a few workspace calls, then it delegates (ADR 0090, issue #98)
      // a role chat with the sub-agent tool: only the Explore search (and an AI-DLC project's own aidlc-* agents), since
      // Claude asks no permission to start one
      ...(preToolUse ? { preToolUse } : {}),
      ...(r.codeMode ? { codeMode: true } : {}),
      sessionId, resume, fork, worktree: r.worktree && !resume, ...(r.worktree || r.inWorktree ? { inWorktree: true } : {}), mcpConfig: this.mcpConfig(chatId), costBaseUsd: r.costTotalUsd,
      compactWindowTokens: r.maxContext ?? this.compactWindow(),
      // Native subagents inherit this environment: a per-chat model cannot prove a memory event's producer.
      env: this.chatEnv(chatId), ...(extraArgs ? { extraArgs } : {}),
      // the Orchestrator may turn on Remote Control (ADR 0229): its engine echoes queued messages, the phone's included
      ...(r.s.isOrchestrator && engine.kind === 'claude' ? { remoteControl: true } : {}),
    };
    r.worktree = false; // created once; a resume re-enters it
    // a new session: its required tools are checked again (ADR 0356: at every start, resume and engine change)
    r.toolSession = { startedAt: Date.now() };
    let sess: HarnessSession | null = null;
    const sink = this.sinkFor(r, () => sess);
    r.s.state = 'starting';
    r.activeAt = Date.now();
    delete r.s.lastError;
    sess = this.newSession(engine.id, opts, sink, r);
    r.session = sess;
    this.updated(r);
    sess.start();
    this.remoteAfterStart(r, sess);
  }

  /** A chat engine's environment: the app's, and the fallback tool command bound to this chat (chats/tool-cli.ts). */
  private chatEnv(chatId: string): NodeJS.ProcessEnv {
    const base = { ...engineEnv(), ...this.opts.env, SB_EVENT_CONTEXT: '' };
    // every session spreads this over the app's own environment: PATH is the app's, with the command's folder first
    return { ...base, ...toolCliEnv({ ...process.env, ...base }, this.opts.toolCliDir ?? null, this.opts.mcpUrlFor?.(chatId) ?? null, this.appMcpFor(this.chats.get(chatId))) };
  }

  /** pre-allowed on Claude: the Orchestrator's app-control tools (/mcp/app), and every chat's mail to other chats and
   *  delegation tools (app-tool-approval.ts; mail is text only, labelled as not the user's; the auto-mode classifier sometimes refused the same message sent
   *  with Bash, 12/10). r = undefined: a warm engine (warm.ts), never an Orchestrator. */
  private extraArgsFor(harness: Harness, chatId: string, r: Rec | undefined, codeMode = r?.codeMode === true): string[] | null {
    const claude = engineOf(harness)?.kind === 'claude';
    const url = this.opts.mcpUrlFor?.(chatId);
    const allowed = !engineOf(harness)?.caps.preAllow ? [] : [
      ...(this.appMcpFor(r) ? ['mcp__second-brain-app'] : []),
      ...(url ? APP_CHAT_TOOLS.map(t => `mcp__second-brain__${t}`) : []),
      // Code Mode (ADR 0331): run_code asks no permission of the engine, each of its internal calls passes the app's own
      ...(url && codeMode ? [`mcp__second-brain__${RUN_CODE}`] : []),
    ];
    // the managed MCP servers this chat may not use: refused by name, also when the user's own Claude config has one so
    // named; in Code Mode Claude's own file and shell tools too (run_code's wrappers do their work)
    const denied = claude ? [...(this.opts.extMcp?.(chatId).denied ?? []).map(id => `mcp__${id}`), ...(codeMode && url ? CODE_MODE_HIDDEN : [])] : [];
    // no system-prompt line: run_code's _meta anthropic/alwaysLoad (code-mode/tool.ts) loads it upfront (ADR 0331 point 6)
    const extra = [...(allowed.length ? ['--allowedTools', allowed.join(',')] : []), ...(denied.length ? ['--disallowedTools', denied.join(',')] : [])];
    return this.opts.extraArgs || extra.length ? [...(this.opts.extraArgs ?? []), ...extra] : null;
  }

  /** An agent's message (from = its sender) never wakes a stopped chat (closed, or its engine released for idleness) on
   *  an engine the Orchestrators may not use: it would resume that engine for an agent. A running chat gets it as before. */
  protected needAgentMay(r: Rec, from: string | undefined): void {
    if (from === undefined || r.session || this.opts.agentsMayOpen?.(r.s.harness) !== false) return;
    throw new AgentMayNotWake(r.s.harness);
  }

  /** Refuses an engine the user switched off (Impostazioni → Motori): nothing starts on it, whoever asks. */
  protected needOn(h: Harness): void {
    if (this.opts.engineOn?.(h) === false) throw new Error(`${engineOrThrow(h).label} è spento nelle impostazioni: riaccendilo in Impostazioni → Motori.`);
  }

  /** A session on an engine: the test factory if given, else the engine's own adapter (engines/sessions.ts). The Orchestrator
   *  on any engine gets the app-control tools (app_create_chat…); r = undefined: a warm engine, never an Orchestrator. */
  private newSession(harness: Harness, opts: SessionOptions, sink: SessionSink, r: Rec | undefined): HarnessSession {
    const brief = this.opts.briefReady;
    if (brief) opts = { ...opts, briefReady: () => brief(opts.chatId) };
    const options = this.opts.briefOptions;
    if (options) opts = { ...opts, briefOptions: () => options(opts.chatId) };
    if (this.opts.sessionFactory) return this.opts.sessionFactory(harness, opts, sink);
    const override = this.opts.enginePaths?.[harness];
    return sessionFor(engineOrThrow(harness), opts, sink, {
      userData: this.opts.userData, mcpUrl: this.opts.mcpUrlFor?.(opts.chatId) ?? null, appMcpUrl: this.appMcpFor(r),
      extMcp: this.opts.extMcp?.(opts.chatId).servers ?? [],
      showReplay: !r?.items.length, acpModelConfig: this.acpModelConfig(r ? catalogRole(r.s) : undefined), key: () => this.opts.keyFor?.(harness) ?? null, brainRoot: this.opts.brainRoot?.() ?? null,
      ...(override ? { path: override } : {}), ...(this.opts.appVersion ? { appVersion: this.opts.appVersion } : {}),
    });
  }

  /** A Claude engine for the next new chat in cwd: its chat id, session id and MCP endpoint are chosen now; no model,
   *  effort, mode or title (the user's defaults until the chat sends its own as control requests). */
  protected override spawnWarm(cwd: string, launch: WarmLaunch): WarmEngine | null {
    if (updateActivity.frozen) return null;
    const chatId = `c_${crypto.randomBytes(5).toString('hex')}`;
    const sessionId = crypto.randomUUID();
    // its launch asks mcpContext before the pool holds it: the id is known as the warm engine's meanwhile
    this.warmChat = chatId;
    // its endpoint lists tools for the launch's role until a chat adopts it (chatToolShown, browserAccess, mcpContext)
    this.warmViews.set(chatId, launch);
    for (const k of [...this.warmViews.keys()].slice(0, Math.max(0, this.warmViews.size - 8))) this.warmViews.delete(k);
    try { return this.spawnWarmAs(chatId, sessionId, cwd, launch); } finally { this.warmChat = null; }
  }

  private spawnWarmAs(chatId: string, sessionId: string, cwd: string, launch: WarmLaunch): WarmEngine {
    const extraArgs = this.extraArgsFor('claude', chatId, undefined, launch.codeMode === true);
    const opts: SessionOptions = {
      chatId, cwd, model: null, effort: null, permissionMode: null, title: null, sessionId, resume: false, fork: false, worktree: false,
      ...(launch.toolPolicy !== undefined || launch.ceiling !== undefined ? { toolPolicy: launch.toolPolicy ?? null, ceiling: launch.ceiling ?? null } : {}),
      ...(launch.agentAssets ? { agentAssets: launch.agentAssets } : {}), ...subagentGateFor(launch.toolPolicy, cwd),
      mcpConfig: this.mcpConfig(chatId), costBaseUsd: 0, compactWindowTokens: launch.compactWindowTokens ?? this.compactWindow(),
      env: this.chatEnv(chatId), ...(extraArgs ? { extraArgs } : {}),
    };
    const sink = new BufferedSink();
    const session = this.newSession('claude', opts, sink, undefined);
    session.start();
    return { chatId, sessionId, cwd, session, sink, at: Date.now() };
  }

  /** How a chat's engine is launched, as far as a waiting engine must match it: its role's tools and ceiling, its skills
   *  plugin and its own context window; nothing of these = a plain launch (sig ''). */
  protected warmLaunch(policy: AgentPolicy | null | undefined, assets: { pluginDir: string; skillRoot: string } | undefined, maxContext: number | undefined, view?: WarmLaunch['view'], codeMode = false): WarmLaunch {
    if (!policy && !assets && !maxContext && !view && !codeMode) return PLAIN_LAUNCH;
    const fields = { toolPolicy: policy?.tools ?? null, ceiling: policy?.ceiling ?? null, ...(assets ? { agentAssets: assets } : {}), ...(maxContext ? { compactWindowTokens: maxContext } : {}), ...(view ? { view } : {}), ...(codeMode ? { codeMode: true as const } : {}) };
    return { sig: crypto.createHash('sha256').update(JSON.stringify(fields)).digest('hex').slice(0, 16), ...fields };
  }

  /** The new chat r takes the waiting engine: what it reported so far is replayed into the chat, then the chat's own
   *  choices go as control requests; a send waits for them (r.opening). A refused choice → a fresh engine with flags. */
  protected adoptWarm(r: Rec, w: WarmEngine): void {
    const sess = w.session;
    this.warmViews.delete(w.chatId);
    // launched for Code Mode or not (its launch signature, ADR 0331): the chat is what its engine is
    r.codeMode = w.launch?.codeMode === true;
    // a warm engine's own hook is a role's sub-agent gate (spawnWarmAs): it guards only the native Agent tool, which no
    // script can call, so its internal calls lose nothing without it
    r.preToolUse = null;
    r.session = sess;
    r.s.state = 'starting';
    r.activeAt = Date.now();
    delete r.s.lastError;
    // its tools are checked like a new session's, with the list the waiting engine already read (ADR 0356)
    const served = this.warmServed.get(w.chatId);
    this.warmServed.delete(w.chatId);
    r.toolSession = { startedAt: Date.now(), ...(served ? { served } : {}) };
    w.sink.attach(this.sinkFor(r, () => sess));
    this.updated(r);
    const c = r.choice;
    const title = r.s.title !== 'Nuova chat' ? r.s.title : null;
    log.info('chats', 'warm engine adopted', { chat: r.s.id, data: { waitedMs: Date.now() - w.at, state: sess.state, model: c.model, effort: c.effort, permissionMode: c.permissionMode } });
    r.opening = (async () => {
      try {
        // a warm engine still starting: its start-up must not eat the controls' own timeout
        await sess.ready;
        if (c.model) await sess.setModel(c.model);
        if (c.effort) await sess.setEffort(c.effort);
        // the mode the chat would be launched with (launchMode: its choice, the ceiling's clamp, or «default» for a
        // chat with no choice); null leaves the waiting engine in the user's own default («plan», or one the app
        // cannot read)
        const mode = this.launchMode(r);
        if (mode) await sess.setPermissionMode(mode);
      } catch (e) {
        log.warn('chats', 'warm engine refused the chat choices: starting a fresh one', { chat: r.s.id, data: errText(e) });
        if (r.session === sess) {
          r.session = null;
          void sess.close();
          r.s.sessionId = crypto.randomUUID(); // never two engines on one session id
          this.startSession(r);
        }
        return;
      }
      // the name the CLI keeps for /resume (a cold start passes --name); never blocks the first message
      if (title) sess.rename(title).catch(e => log.warn('chats', 'warm engine rename failed', { chat: r.s.id, data: errText(e) }));
    })();
  }

  /** the compaction window for the next Claude engine (setting compactWindowTokens; 0 = the user's settings) */
  private compactWindow(): number {
    try { return this.opts.compactWindowTokens?.() ?? 0; } catch { return 0; }
  }

  private acpModelConfig(roleId: string | undefined): { reasoning: CursorReasoning | ''; fast: boolean } | null {
    try { return this.opts.acpModelConfig?.(roleId) ?? null; } catch (e) { log.warn('chats', 'ACP model settings not read', { data: errText(e) }); return null; }
  }

  // ---- implemented in a later layer (ADR 0200: manager.ts and its manager-*.ts layers)
  protected abstract unsettledChildren(r: Rec): boolean;
  protected abstract childrenDone(r: Rec): boolean;
  protected abstract observedChildrenBusy(r: Rec): boolean;
  protected abstract coldOn(): boolean;
  protected abstract coldView(r: Rec): ColdView;
  protected abstract ttl(): number;
  protected abstract sinkFor(r: Rec, current: () => HarnessSession | null): SessionSink;
  /** a new engine of r started: Remote Control comes back if it was on (manager-remote.ts, ADR 0229) */
  protected abstract remoteAfterStart(r: Rec, sess: HarnessSession): void;
}
