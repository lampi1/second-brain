// ChatManager layer (ADR 0200): engine sessions. Starting a chat's engine (sessions.ts, the launch options: mode, MCP
// endpoints, extra arguments, the compaction window), the warm pool and prewarm, releasing idle engines, killing
// the process trees on quit, get_usage, the browser access and tool visibility a chat has.
import crypto from 'node:crypto';
import fs from 'node:fs';
import type { CliStatus, CursorReasoning, Harness, PermissionMode } from '../../shared/contract';
import { errText, log } from '../log';
import { cliVersion, killTrees, killTreesWithin, resolveClaude } from './cli';
import { reapAfterQuit } from './proctree';
import { jobGuard } from './jobguard';
import { coldArmed, coldRoute, type ColdView } from './continuity';
import { isUuid, type HarnessSession, type SessionOptions, type SessionSink } from './session';
import { updateActivity } from '../update/activity';
import { BufferedSink, PLAIN_LAUNCH, type WarmEngine, type WarmLaunch } from './warm';
import { AgentMayNotWake } from '../engines/policy';
import { engineOf, engineOrThrow } from '../engines/registry';
import { sessionFor } from '../engines/sessions';
import { findTranscript } from './transcript';
import { aboveCeiling, browserAccess, claudeDefaultMode, type AgentPolicy, type BrowserAccess } from '../agents/tool-policy';
import { TurnToolBudget } from '../agents/orchestrator-budget';
import { APP_CHAT_TOOLS } from './app-tool-approval';
import { toolShownToChat, toolShownToUnknown, toolShownToWarm } from './tool-visibility';
import { AgentChildrenReducer } from './agent-children';
import { initialEffort } from './effort';
import type { Rec } from './manager-types';
import { PREWARM_UNUSED_MS, workBehind, subagentGateFor } from './manager-helpers';
import { ManagerPersistence } from './manager-persistence';

/** Engine sessions: start, launch options, warm engines, the kill on quit, the per-chat MCP and tool visibility. */
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
      if (!sess?.alive || sess.busy || r.releasing || r.archiving || r.opening || r.switching || r.autoClosing || (r.deliveryHolds ?? 0) > 0 || this.unsettledChildren(r) || r.handoffTurn || r.s.closedAt || r.s.isOrchestrator || r.s.quick) continue;
      if (r.s.state !== 'idle' || r.pending.size > 0 || workBehind(r.s)) continue;
      if (now - Math.max(r.activeAt ?? 0, r.lastTurnAt) < idleMs) continue;
      // a long chat waiting for its cold note keeps its engine: a resumed one would miss the cache (ADR 0031)
      if (this.coldOn() && coldArmed(this.coldView(r), now, this.ttl())) continue;
      n++;
      log.info('chats', 'idle engine released', { chat: r.s.id, data: { idleMin: Math.round((now - Math.max(r.activeAt ?? 0, r.lastTurnAt)) / 60000), pid: sess.pid } });
      // like a model change: a dev server or local stack it started stays until the chat really closes (reapKept)
      r.releasing = this.closeKeeping(r, sess).finally(() => { r.releasing = undefined; });
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
    if (r.s.routineArchived) throw new Error('Archived routine chats are read-only.');
    updateActivity.assertOpen();
    if (r.releasing) await r.releasing; // never into an engine released for idleness: it ends, then this resumes
    if (!r.session) {
      this.needOn(r.s.harness);
      this.startSession(r);
      // a resumed chat on an engine that replays its past while it opens (ACP): let it land before this message, in order
      const started = r.session as HarnessSession | null;
      if (started?.ready && engineOf(r.s.harness)?.caps.transcript === false && isUuid(r.s.sessionId)) r.opening = started.ready;
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
    const lampo = [...this.chats.values()].find(x => x.s.quick && !x.s.closedAt);
    if (lampo && !lampo.session && !this.quitting && engineOf(lampo.s.harness)?.caps.warm && this.opts.engineOn?.(lampo.s.harness) !== false && fs.existsSync(lampo.s.cwd))
      this.ensureSession(lampo).catch(e => log.warn('chats', 'Lampo engine not started ahead', { chat: lampo.s.id, cause: errText(e), hint: 'it starts with the first message' }));
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

  /** min(ceiling, Brother's mode) for this start. Claude without a chat choice follows his settings, so their default is
   *  read here (passing --permission-mode replaces it); other engines narrow through their own options (ceiling). */
  protected modeFor(r: Rec): PermissionMode | null {
    const ceiling = r.policy?.ceiling ?? null, chosen = r.choice.permissionMode;
    if (!ceiling) return chosen;
    const brother = chosen ?? (engineOf(r.s.harness)?.kind === 'claude' ? claudeDefaultMode(r.s.cwd, { ...process.env, ...this.opts.env }) : null);
    return brother && aboveCeiling(brother, ceiling) ? ceiling : chosen;
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
    if (r) return toolShownToChat(r.s, r.launches, tool);
    const warm = this.warmViews.get(chatId)?.view;
    return warm ? toolShownToWarm(warm, tool) : toolShownToUnknown(tool);
  }

  private mcpConfig(chatId: string): string | null {
    const url = this.opts.mcpUrlFor?.(chatId) ?? null;
    const app = this.appMcpFor(this.chats.get(chatId));
    const servers: Record<string, { type: 'http'; url: string }> = {};
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
    if (r.s.routineArchived) throw new Error('Archived routine chats are read-only.');
    r.s.effortStatus = initialEffort(!!engineOf(r.s.harness)?.caps.effort, r.choice.effort);
    const chatId = r.s.id;
    let sessionId = r.s.sessionId;
    let resume = false, fork = false;
    const engine = engineOrThrow(r.s.harness);

    if (!engine.caps.transcript) resume = isUuid(sessionId); // session/load; a new one gets its id from session/new
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
    const extraArgs = this.extraArgsFor(r.s.harness, chatId, r);
    const opts: SessionOptions = {
      chatId, cwd: r.s.cwd, model: r.choice.model, effort: r.choice.effort, permissionMode: this.modeFor(r), title: r.s.title,
      ...(r.policy ? { toolPolicy: r.policy.tools, ceiling: r.policy.ceiling } : {}),
      ...(r.agentAssets ? { agentAssets: r.agentAssets } : {}),
      // the Orchestrator's turn stays short: a few workspace calls, then it delegates (ADR 0090, issue #98)
      // a role chat with the sub-agent tool: only the Explore search, since Claude asks no permission to start one
      ...(engine.kind !== 'claude' ? {} : r.s.isOrchestrator ? { preToolUse: new TurnToolBudget() }
        : subagentGateFor(r.policy?.tools)),
      sessionId, resume, fork, worktree: r.worktree && !resume, mcpConfig: this.mcpConfig(chatId), costBaseUsd: r.costTotalUsd,
      compactWindowTokens: r.maxContext ?? this.compactWindow(),
      // Native subagents inherit this environment: a per-chat model cannot prove a memory event's producer.
      env: { ...this.opts.env, SB_EVENT_CONTEXT: '' }, ...(extraArgs ? { extraArgs } : {}),
    };
    r.worktree = false; // created once; a resume re-enters it
    let sess: HarnessSession | null = null;
    const sink = this.sinkFor(r, () => sess);
    r.s.state = 'starting';
    r.activeAt = Date.now();
    delete r.s.lastError;
    sess = this.newSession(engine.id, opts, sink, r);
    r.session = sess;
    this.updated(r);
    sess.start();
  }

  /** pre-allowed on Claude: the Orchestrator's app-control tools (/mcp/app), and every chat's mail to other chats and
   *  delegation tools (app-tool-approval.ts; mail is text only, labelled as not the user's; the auto-mode classifier sometimes refused the same message sent
   *  with Bash, 12/10). r = undefined: a warm engine (warm.ts), never an Orchestrator. */
  private extraArgsFor(harness: Harness, chatId: string, r: Rec | undefined): string[] | null {
    const allowed = !engineOf(harness)?.caps.preAllow ? [] : [
      ...(this.appMcpFor(r) ? ['mcp__second-brain-app'] : []),
      ...(this.opts.mcpUrlFor?.(chatId) && !r?.s.quick ? APP_CHAT_TOOLS.map(t => `mcp__second-brain__${t}`) : []),
    ];
    // the managed MCP servers this chat may not use: refused by name, also when the user's own Claude config has one so named
    const denied = engineOf(harness)?.kind === 'claude' ? (this.opts.extMcp?.(chatId).denied ?? []).map(id => `mcp__${id}`) : [];
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
    if (this.opts.sessionFactory) return this.opts.sessionFactory(harness, opts, sink);
    const override = this.opts.enginePaths?.[harness];
    return sessionFor(engineOrThrow(harness), opts, sink, {
      userData: this.opts.userData, mcpUrl: this.opts.mcpUrlFor?.(opts.chatId) ?? null, appMcpUrl: this.appMcpFor(r),
      extMcp: this.opts.extMcp?.(opts.chatId).servers ?? [],
      showReplay: !r?.items.length, acpModelConfig: this.acpModelConfig(), key: () => this.opts.keyFor?.(harness) ?? null,
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
    const extraArgs = this.extraArgsFor('claude', chatId, undefined);
    const opts: SessionOptions = {
      chatId, cwd, model: null, effort: null, permissionMode: null, title: null, sessionId, resume: false, fork: false, worktree: false,
      ...(launch.toolPolicy !== undefined || launch.ceiling !== undefined ? { toolPolicy: launch.toolPolicy ?? null, ceiling: launch.ceiling ?? null } : {}),
      ...(launch.agentAssets ? { agentAssets: launch.agentAssets } : {}), ...subagentGateFor(launch.toolPolicy),
      mcpConfig: this.mcpConfig(chatId), costBaseUsd: 0, compactWindowTokens: launch.compactWindowTokens ?? this.compactWindow(),
      env: { ...this.opts.env, SB_EVENT_CONTEXT: '' }, ...(extraArgs ? { extraArgs } : {}),
    };
    const sink = new BufferedSink();
    const session = this.newSession('claude', opts, sink, undefined);
    session.start();
    return { chatId, sessionId, cwd, session, sink, at: Date.now() };
  }

  /** How a chat's engine is launched, as far as a waiting engine must match it: its role's tools and ceiling, its skills
   *  plugin and its own context window; nothing of these = a plain launch (sig ''). */
  protected warmLaunch(policy: AgentPolicy | null | undefined, assets: { pluginDir: string; skillRoot: string } | undefined, maxContext: number | undefined, view?: WarmLaunch['view']): WarmLaunch {
    if (!policy && !assets && !maxContext && !view) return PLAIN_LAUNCH;
    const fields = { toolPolicy: policy?.tools ?? null, ceiling: policy?.ceiling ?? null, ...(assets ? { agentAssets: assets } : {}), ...(maxContext ? { compactWindowTokens: maxContext } : {}), ...(view ? { view } : {}) };
    return { sig: crypto.createHash('sha256').update(JSON.stringify(fields)).digest('hex').slice(0, 16), ...fields };
  }

  /** The new chat r takes the waiting engine: what it reported so far is replayed into the chat, then the chat's own
   *  choices go as control requests; a send waits for them (r.opening). A refused choice → a fresh engine with flags. */
  protected adoptWarm(r: Rec, w: WarmEngine): void {
    const sess = w.session;
    this.warmViews.delete(w.chatId);
    r.session = sess;
    r.s.state = 'starting';
    r.activeAt = Date.now();
    delete r.s.lastError;
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
        // the mode the chat would be launched with (its choice, or the user's default clamped to its ceiling: a
        // delegated chat's is its parent's mode), never the waiting engine's default above that ceiling
        const mode = this.modeFor(r);
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

  private acpModelConfig(): { reasoning: CursorReasoning | ''; fast: boolean } | null {
    try { return this.opts.acpModelConfig?.() ?? null; } catch (e) { log.warn('chats', 'ACP model settings not read', { data: errText(e) }); return null; }
  }

  // ---- implemented in a later layer (ADR 0200: manager.ts and its manager-*.ts layers)
  protected abstract unsettledChildren(r: Rec): boolean;
  protected abstract coldOn(): boolean;
  protected abstract coldView(r: Rec): ColdView;
  protected abstract ttl(): number;
  protected abstract sinkFor(r: Rec, current: () => HarnessSession | null): SessionSink;
}
