// ChatManager's bottom layer (ADR 0200: the class is split in layers, one concern per file, each extending the one
// before; manager.ts is the top and the only one others import): every field and the constructor (restores the saved
// chats, starts the timers), a chat's summary update and its items (streamed items coalesced per frame), the brain
// hooks' guard. The methods of later layers it calls are declared abstract at its end.
import fs from 'node:fs';
import type { ChatItem, ChatSummary } from '../../shared/contract';
import { errText, log } from '../log';
import { resolveClaude } from './cli';
import { HandoffStore } from './handoff';
import { ContextCounters } from './context-stats';
import { ChatStore, type HeldChildResult, type StoredChat } from './store';
import { updateActivity } from '../update/activity';
import { WarmPool, type WarmEngine, type WarmLaunch } from './warm';
import { AdmissionQueue } from './admission';
import { engineOf } from '../engines/registry';
import { claudeHome } from './transcript';
import type { AgentRun } from '../../shared/agents';
import { AgentRunStore } from '../agents/runs';
import { AgentAnalyticsCollector } from '../agents/collector';
import { slug as slugTitle } from './mail';
import type { ResultIndex, ChatManagerOptions, Rec, CleanReportNote, UserWroteNote } from './manager-types';
import { setInterval, clearTimeout, ITEM_FRAME_MS } from './manager-helpers';

/** The chat manager's state (every field, the constructor) and the chat record basics: find, update, items, hooks. */
export abstract class ManagerCore {
  readonly submissionReceipts = true;
  readonly analytics: AgentAnalyticsCollector;
  /** agent-runs.json: the runs of chats started from catalog agents (AGENTS-DESIGN §1.2, §5) */
  readonly runs: AgentRunStore;
  protected runTimer: NodeJS.Timeout | null = null;
  protected chats = new Map<string, Rec>();
  protected deliveries = new Map<string, Promise<void>>();
  protected synthesizing = new Set<string>();
  protected synthesisRetry = new Map<string, NodeJS.Timeout>();
  /** Flash moving to its card's engine (flashFollow): the new chat's id, for a question sent meanwhile */
  protected flashMoving: Promise<string> | undefined;
  /** notes for a chat's next message (the user wrote in one of its delegated children): they ride along, no turn of their own */
  protected notesFor = new Map<string, string[]>();
  protected userWroteListeners: ((n: UserWroteNote) => void)[] = [];
  protected cleanReportListeners: ((n: CleanReportNote) => boolean)[] = [];
  /** children's results waiting for their siblings', per parent (queueChildResult) */
  protected childResults = new Map<string, { items: HeldChildResult[]; timer: NodeJS.Timeout | null }>();
  /** "Riprendi" in flight per old chat: a double click or two agents get the same new chat, never two. */
  protected continuing = new Map<string, Promise<ChatSummary>>();
  protected store: ChatStore;
  protected handoffs: HandoffStore;
  protected home: string;
  protected max: number;
  protected version: string | null = null;
  protected probing = false;
  protected killedPids = new Set<number>();
  protected quitting = false; // shutdown started: a CLI exit now is the quit's, its cut turn resumes on the next start
  private coalesce = new Map<string, { items: Map<string, ChatItem>; timer: NodeJS.Timeout }>();
  protected lastUsageAt = 0;
  protected usageTimer: NodeJS.Timeout | null = null;
  protected lastUsageChat: string | null = null;
  protected coldTimer: NodeJS.Timeout | null = null;
  protected readonly counters: ContextCounters;
  protected readonly onExit = (): void => { this.killAll(true); this.flushWrites(); };
  /** the CPU queue (ADR 0036); null = not wired: everything runs at once */
  protected readonly admission: AdmissionQueue | null;
  // no engine is started ahead while the machine is busy or chats wait in the CPU queue (ADR 0036)
  /** the chat id of the warm engine being spawned now (spawnWarm), before the pool holds it */
  protected warmChat: string | null = null;
  /** the launch of each waiting engine by its chat id, until a chat adopts it */
  protected readonly warmViews = new Map<string, WarmLaunch>();
  protected readonly warm = new WarmPool({ spawn: (cwd, launch) => this.spawnWarm(cwd, launch), enabled: () => !!this.opts.prewarm && !this.quitting && !updateActivity.frozen && !this.admission?.busy() && this.opts.engineOn?.('claude') !== false });

  constructor(protected readonly opts: ChatManagerOptions) {
    this.analytics = new AgentAnalyticsCollector(opts.userData, Date.now, opts.writeDelayMs ? Math.max(1000, opts.writeDelayMs) : 0);
    this.runs = new AgentRunStore(opts.userData);
    if (this.runs.problem) log.warn('chats', 'agent runs file unreadable', { cause: this.runs.problem, hint: 'move agent-runs.json (or app.db, ADR 0199) aside to record runs again' });
    // a pruned run lives on in the rollups only: a chat mirror of it would be adopted back and counted twice
    this.runs.onPrune = ids => {
      let any = false;
      for (const r of this.chats.values()) if (r.s.run && ids.has(r.s.run.runId)) { r.runPruned = r.s.run.runId; delete r.s.run; delete r.runningSince; any = true; this.updated(r); }
      if (any) this.persist();
    };
    this.store = new ChatStore(opts.userData);
    this.admission = opts.admission ? new AdmissionQueue({ ...opts.admission, onChange: () => this.refreshQueued() }) : null;
    this.handoffs = new HandoffStore(opts.userData);
    this.counters = new ContextCounters(opts.userData);
    this.home = opts.claudeHome ?? claudeHome();
    this.max = opts.maxItems ?? 2000;
    const stored = this.store.load();
    // Existing chat metadata is already loaded. Archive the full routine tree without reading any routine file.
    const archived = new Set(stored.filter(c => c.routineArchived || c.routine || c.routinePackage).map(c => c.id));
    let added = true;
    while (added) { added = false; for (const c of stored) if (c.parentId && archived.has(c.parentId) && !archived.has(c.id)) { archived.add(c.id); added = true; } }
    for (const c of stored) this.chats.set(c.id, this.restore(archived.has(c.id) ? { ...c, routineArchived: true } : c));
    if (stored.some(c => !c.agent)) this.persist();
    process.on('exit', this.onExit); // Windows keeps orphaned children alive: kill them when the app dies
    // the plan windows stay fresh in the top bar even while a long turn runs (get_usage spends no model call)
    if (opts.onRateLimit) { this.usageTimer = setInterval(() => this.askUsage(), opts.usageEveryMs ?? 60000); this.usageTimer.unref?.(); }
    if ((opts.coldEveryMs ?? 60_000) > 0) { this.coldTimer = setInterval(() => this.coldTick(), opts.coldEveryMs ?? 60_000); this.coldTimer.unref?.(); }
    if ((opts.runEveryMs ?? 600_000) > 0) { this.runTimer = setInterval(() => this.staleRuns(), opts.runEveryMs ?? 600_000); this.runTimer.unref?.(); }
    if (opts.prewarm) {
      const last = [...this.chats.values()].filter(r => !r.s.routineArchived && !!engineOf(r.s.harness)?.caps.warm && r.s.origin === 'app' && !r.s.isOrchestrator).sort((a, b) => b.createdAt - a.createdAt)[0];
      if (last && fs.existsSync(last.s.cwd)) this.warm.schedule(last.s.cwd, opts.prewarmDelayMs ?? 20000);
      // the Orchestrator's engine resumes ahead of the user's first message of the day: no 10-17 s start then, and an idle
      // engine makes no model call
      const t = setTimeout(() => this.prewarmOrchestrator(), opts.prewarmDelayMs ?? 20000);
      t.unref?.();
    }
    // every log line about a chat carries the agent run it is (ADR 0192: npm run logs -- --run <id>)
    log.correlate(chatId => this.chats.get(chatId)?.s.run?.runId);
    const claude = resolveClaude(opts.enginePaths?.claude ?? null);
    log.info('chats', 'manager ready', { data: { restored: this.chats.size, claude: claude ? `${claude.source}: ${claude.path}` : 'not found', overrides: opts.enginePaths ?? null } });
  }

  /** The finished canonical results a chat can still show: a user chat's own root runs, and for the Orchestrator the
   *  root runs it started in top-level chats. One pass over the runs, kept in their order, and only when the runs changed
   *  (runs.revision): summary() runs for every open chat every second and updated() several times per assistant message,
   *  and a pass over up to 5000 runs each time grew with the day's history (2026-10-29). Which chat a run belongs to
   *  (routine archive, delegated child) is checked when it is read, so the cached index never goes stale on a chat. */
  private resultCache: { rev: number; index: ResultIndex } | null = null;
  protected resultIndex(): ResultIndex {
    const rev = this.runs.revision;
    if (this.resultCache?.rev === rev) return this.resultCache.index;
    const byChat = new Map<string, AgentRun[]>(), roots: AgentRun[] = [];
    for (const run of this.runs.list()) {
      if (run.parentRunId || !run.report?.canonical) continue;
      if (run.startedBy === 'user') { const l = byChat.get(run.chatId); if (l) l.push(run); else byChat.set(run.chatId, [run]); }
      else if (run.startedBy === 'orchestrator') roots.push(run);
    }
    const index = { byChat, roots };
    this.resultCache = { rev, index };
    return index;
  }
  protected refreshTaskSummary(r: Rec, index: ResultIndex = this.resultIndex()): void {
    if (r.userTaskEvents) r.s.userEvents = { latestSeq: r.userTaskEvents.latestSeq, acknowledgedSeq: r.userTaskEvents.acknowledgedSeq };
    const shown = (run: AgentRun): boolean => { const c = this.chats.get(run.chatId)?.s; return !c?.routineArchived && (!r.s.isOrchestrator || !c?.parentId); };
    const runs = (r.s.isOrchestrator ? index.roots : r.s.routineArchived ? [] : index.byChat.get(r.s.id) ?? []).filter(shown);
    r.s.availableResultIds = runs.filter(run => !run.delivery?.synthesisSubmittedAt).map(run => run.runId);
    r.s.pendingResultIds = runs.filter(run => !run.delivery?.displayedAt || run.delivery?.synthesisPending).map(run => run.runId);
  }

  /** a turn runs in a live engine: a message joins it (a chat cut by a restart has working set but no engine) */
  protected midTurn(r: Rec): boolean {
    return !!r.session && (r.working === true || r.session.busy);
  }

  /** The queue moved or the load changed: each chat's "In coda" line follows. */
  private refreshQueued(): void {
    const adm = this.admission;
    if (!adm) return;
    const load = adm.load();
    const waiting = new Map(adm.list().map(e => [e.key, e]));
    for (const r of this.chats.values()) {
      const e = waiting.get(r.s.id);
      const was = r.s.queued;
      if (!e) { if (was) { delete r.s.queued; this.updated(r); } continue; }
      if (was && was.position === e.position && was.kind === e.kind && was.cpu === load.cpu && was.freeRam === load.freeRam) continue;
      r.s.queued = { kind: e.kind, position: e.position, since: e.since, cpu: load.cpu, freeRam: load.freeRam };
      this.updated(r);
    }
  }
  protected readonly treeActivity = new Map<string, number>();

  // ---- internals ----

  /** Calls a brain hook; a hook that throws is logged and never breaks the chat. */
  protected hook(name: string, fn: () => void): void {
    try { fn(); } catch (e) {
      log.error('chats', `hook ${name} failed`, { cause: errText(e), hint: 'fix the listener wired in src/main/wiring.ts; the chat itself is unaffected' });
    }
  }
  /** one deferred agent-runs.json write within `ms` (an earlier one already due stays) */
  protected runWriteTimer: ReturnType<typeof setTimeout> | undefined;
  /** one deferred chats.json write within `ms`, of the chats as they are then (an earlier one already due stays) */
  protected persistTimer: ReturnType<typeof setTimeout> | undefined;
  /** Failed deferred writes in a row, per file: a failure is tried again on its own (no later change may come to
   *  trigger it), after writeRetryMs doubling up to 60 s; a success resets it. */
  protected readonly writeFails = { chats: 0, runs: 0 };
  /** The per-turn run changes (cost, tokens, turns, skills used) are written once per RUN_SAVE_MS, not at each event:
   *  agent-runs.json grows to RUNS_BYTES (7 MB) and every write is a synchronous serialize + write + rename on the main
   *  process, i.e. the window's UI thread. Written at every settled turn of every chat, it froze the app for 50-250 ms
   *  each time (measured 2026-10-27: 45 ms a write at 7 MB on a fast Linux disk, 236 ms with a prune; slower on Windows
   *  with an antivirus scanning each new file): the owner's "va a scatti … si freeza senza loader". Starts and ends also use
   *  the deferred writer; their chat checkpoints retain the run mirror. Only shutdown/exit flush synchronously. */
  protected runSaveTimer: ReturnType<typeof setTimeout> | undefined;

  protected need(chatId: string): Rec {
    const r = this.chats.get(chatId);
    if (!r) throw new Error('Chat non trovata.');
    return r;
  }

  protected updated(r: Rec): void {
    this.refreshTaskSummary(r);
    const now = Date.now();
    r.s.updatedAt = now;
    // work time: starting or running counts; waiting for the user, idle, closed do not
    const working = (r.s.state === 'starting' || r.s.state === 'running') && !r.handoffTurn; // a hand-off turn is no work of the job
    if (working && r.s.workSince === undefined) r.s.workSince = now;
    else if (!working && r.s.workSince !== undefined) {
      r.s.workMs = (r.s.workMs ?? 0) + now - r.s.workSince;
      delete r.s.workSince;
    }
    this.flushItems(r.s.id); // streamed words held for the next step reach the UI before the new state ("finito")
    this.opts.emitter.emit('chat:updated', { ...r.s });
  }

  /** When the chat last produced anything: a transcript item, a state change or a send (agents/delegation.ts stalledMin). */
  lastEventAt(chatId: string): number | undefined {
    const r = this.chats.get(chatId);
    return r ? Math.max(r.eventAt ?? 0, r.activeAt ?? 0, r.s.updatedAt) : undefined;
  }

  /** Work time so far (the span in progress included). */
  workMs(chatId: string): number {
    const s = this.chats.get(chatId)?.s;
    return s ? (s.workMs ?? 0) + (s.workSince !== undefined ? Date.now() - s.workSince : 0) : 0;
  }

  protected addItem(r: Rec, item: ChatItem, replace: boolean): void {
    r.eventAt = Date.now();
    if (item.kind === 'user' && item.images && !r.continuityUnsafe) { r.continuityUnsafe = true; this.persist(); }
    let rep = false;
    if (replace) {
      for (let i = r.items.length - 1; i >= 0; i--) if (r.items[i]?.id === item.id) { r.items[i] = item; rep = true; break; }
    }
    if (!rep) {
      r.items.push(item);
      if (r.items.length > this.max) { r.continuityUnsafe = true; r.items.splice(0, r.items.length - this.max); this.persist(); }
    }
    this.emitItem(r.s.id, item, rep);
  }

  /** Streaming without flooding IPC: newer versions of the same item within one frame (ITEM_FRAME_MS) collapse into
   *  one event, so words reach the screen as they come, not in 100 ms steps (owner 2026-10-27: «una parola alla volta
   *  come su claude»; it was 100 ms since "Lag nell'app" 2026-10-12). Nothing waits for the screen: the engine's output
   *  is read as fast as before. A new item first flushes what is pending, so the order on screen is kept. */
  private emitItem(chatId: string, item: ChatItem, replace: boolean): void {
    if (replace) {
      let b = this.coalesce.get(chatId);
      if (!b) {
        const timer = setTimeout(() => this.flushItems(chatId), ITEM_FRAME_MS);
        timer.unref();
        b = { items: new Map(), timer };
        this.coalesce.set(chatId, b);
      }
      b.items.set(item.id, item);
      return;
    }
    this.flushItems(chatId);
    this.opts.emitter.emit('chat:item', { chatId, item, replace: false });
  }

  protected flushItems(chatId: string): void {
    const b = this.coalesce.get(chatId);
    if (!b) return;
    clearTimeout(b.timer);
    this.coalesce.delete(chatId);
    for (const item of b.items.values()) this.opts.emitter.emit('chat:item', { chatId, item, replace: true });
  }

  protected dropPending(r: Rec, requestId: string): void {
    if (!r.pending.delete(requestId)) return;
    if (!r.pending.size && !r.commandsOpen?.size) this.idleAgain(r);
    this.hook('analytics', () => this.analytics.resolved(r.s, requestId));
    r.s.pending = r.pending.size;
    this.opts.emitter.emit('pending:resolved', { chatId: r.s.id, requestId });
    this.updated(r);
  }

  /** `title`, or `title · 2`, `· 3`… when another open chat already has its mail box (the slug of its title): two live
   *  chats with one box would hold their mail until someone renamed one (#187). */
  protected uniqueTitle(title: string, self?: string): string {
    const taken = new Set([...this.chats.values()].filter(x => x.s.id !== self && !x.s.closedAt).map(x => slugTitle(x.s.title)));
    if (!taken.has(slugTitle(title))) return title;
    let n = 2;
    while (taken.has(slugTitle(`${title} · ${n}`))) n++;
    return `${title} · ${n}`;
  }

  // ---- implemented in a later layer (ADR 0200: manager.ts and its manager-*.ts layers)
  abstract killAll(sync?: boolean): void;
  abstract flushWrites(): void;
  protected abstract spawnWarm(cwd: string, launch: WarmLaunch): WarmEngine | null;
  protected abstract persist(strict?: boolean): void;
  protected abstract restore(c: StoredChat): Rec;
  protected abstract askUsage(prefer?: Rec): void;
  abstract coldTick(now?: number): number;
  abstract staleRuns(now?: number): number;
  protected abstract prewarmOrchestrator(): void;
  protected abstract idleAgain(r: Rec): void;
}
