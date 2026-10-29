// ChatManager layer (ADR 0200): persistence. A saved chat restored as a record, the rows written to chats.json
// (store.ts) at once or deferred (writeDelayMs), agent-runs.json through the run store (start, end, deferred saves),
// the update checkpoint, the history read back from the transcript, archive bookkeeping (unarchive, prune).
import fs from 'node:fs';
import path from 'node:path';
import type { ChatItem } from '../../shared/contract';
import { errText, log } from '../log';
import type { HarnessSession } from './session';
import type { StoredChat } from './store';
import { updateActivity } from '../update/activity';
import { engineOf } from '../engines/registry';
import { findTranscript, readHistory } from './transcript';
import type { AgentRun, AgentRunEnd } from '../../shared/agents';
import type { AgentRunStore} from '../agents/runs';
import { endRun } from '../agents/runs';
import { AgentChildrenReducer } from './agent-children';
import { initialEffort } from './effort';
import type { Rec } from './manager-types';
import { clearTimeout, workBehind, storedResult, coldDivider, LAMPO_TITLE, MAX_ARCHIVED, RUN_SAVE_MS, restoredOwner } from './manager-helpers';
import { ManagerCore } from './manager-core';

/** chats.json and agent-runs.json: restore, save (deferred or strict), the agent runs' start and end, archived chats. */
export abstract class ManagerPersistence extends ManagerCore {

  /** The Orchestrator role moves elsewhere: the chat stays as a normal one. Its live process keeps the app-control tools it
   *  was started with, so it is closed now (idle) or after this turn: the next message resumes it without them. */
  protected demoteOrchestrator(r: Rec): void {
    r.s.isOrchestrator = false;
    this.persist();
    const sess = r.session;
    if (sess && !sess.busy && r.pending.size === 0) void this.closeKeeping(r, sess);
    else if (sess) r.reopen = true;
    log.info('chats', 'orchestrator role moved away', { chat: r.s.id });
    this.updated(r);
  }

  protected unarchive(r: Rec): void {
    // an engine the auto-close kept for its cold note is live again: idle release and the cold timer see it
    if (r.closeAfterCold && r.session?.alive && r.s.state === 'closed') r.s.state = r.session.busy ? 'running' : 'idle';
    r.closeAfterCold = false;
    delete r.s.closedAt;
    delete r.s.closedBy;
    this.persist();
    log.info('chats', 'chat reopened', { chat: r.s.id });
    this.updated(r);
  }

  /** Only the newest MAX_ARCHIVED archived chats stay in the app. */
  protected pruneArchived(): void {
    const old = [...this.chats.values()].filter(r => r.s.closedAt).sort((a, b) => (b.s.closedAt ?? 0) - (a.s.closedAt ?? 0)).slice(MAX_ARCHIVED);
    for (const r of old) {
      this.reapKept(r);
      this.chats.delete(r.s.id);
      this.opts.emitter.emit('chat:removed', { chatId: r.s.id });
    }
  }

  /** A chat started from a role is a run; a store that cannot record leaves the chat as it is (logged). */
  protected startRun(r: Rec, s: Omit<Parameters<AgentRunStore['start']>[0], 'chatId' | 'startedAt'>): void {
    if (this.runs.problem) return;
    try {
      r.s.run = this.runs.start({ ...s, chatId: r.s.id, startedAt: r.createdAt }, !this.deferWrites());
      const brainRoot = this.opts.brainRoot?.();
      if (brainRoot) r.s.run.scope = { brainRoot: path.resolve(brainRoot), projectRoot: path.resolve(r.s.cwd) };
      r.s.run.taskId = r.s.run.runId; r.s.run.taskVersion = 1;
      this.runSave();
      r.idleSince = r.createdAt;
    } catch (e) { log.warn('chats', 'agent run not recorded', { chat: r.s.id, cause: errText(e), hint: 'the chat works; this run is missing from the agent metrics' }); }
  }

  /** Ends a run and, below it, every open run it spawned (a child never ends its parent). */
  protected finishRun(run: AgentRun | undefined, reason: AgentRunEnd, at = Date.now()): void {
    if (!run || run.endedAt !== undefined) return;
    const r = this.chats.get(run.chatId), mine = !!r && r.s.run === run;
    if (r?.s.routineArchived) return;
    if (mine) this.ranUntil(r!, at);
    endRun(run, reason, at);
    // the receipts' verdict now, unless a turn's files are still coming (receiptTurn settles it then)
    if (mine && !r!.receiptsBusy && r!.turnAt === undefined) this.settleReceipts(run);
    this.hook('agent lifecycle', () => this.opts.onRunEnded?.(structuredClone(run)));
    log.info('chats', 'agent run ended', { chat: run.chatId, data: { runId: run.runId, reason } });
    for (const child of this.runs.children(run.runId)) this.finishRun(child, 'closed', at);
    if (!mine) return;
    // its cost, tokens and time now live in the run: the analytics row may be pruned when the archive is full
    this.hook('analytics', () => this.analytics.rolledUp(r!.s));
    this.updated(r!);
  }
  /** A running turn of the open run stops counting at `at` (a state change, or the run's end). */
  protected ranUntil(r: Rec, at: number): void {
    const run = r.s.run, since = r.runningSince;
    delete r.runningSince;
    if (since === undefined || !run || run.endedAt !== undefined || typeof run.executionMs !== 'number') return;
    run.executionMs += Math.max(0, at - since);
    this.runs.touch();
  }
  protected endRunOf(r: Rec, reason: AgentRunEnd, at = Date.now()): void {
    if (!r.s.run || r.s.run.endedAt !== undefined) return;
    this.finishRun(r.s.run, reason, at);
    this.runSave();
  }
  /** Nothing waits on the user any more: an open run's stale clock starts again from now (kept in chats.json). */
  protected override idleAgain(r: Rec): void {
    r.idleSince = Date.now();
    if (r.s.run && r.s.run.endedAt === undefined) this.persist();
  }
  protected runSave(): void {
    if (this.runs.problem) return;
    if (this.deferWrites()) { this.runs.touch(); this.runWriteSoon(this.opts.writeDelayMs!); return; }
    try { this.runs.save(); } catch (e) { log.warn('chats', 'agent runs not saved', { cause: errText(e), hint: 'the next run change writes them again' }); }
  }
  /** writeDelayMs set and not quitting: saves are coalesced and asynchronous */
  protected deferWrites(): boolean { return (this.opts.writeDelayMs ?? 0) > 0 && !this.quitting; }
  private runWriteSoon(ms: number): void {
    if (this.runWriteTimer) return;
    this.runWriteTimer = setTimeout(() => { this.runWriteTimer = undefined; this.deferredRunWrite(); }, ms);
    this.runWriteTimer.unref?.();
  }
  private persistSoon(ms: number): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => { this.persistTimer = undefined; this.deferredChatWrite(); }, ms);
    this.persistTimer.unref?.();
  }
  private retryDelay(fails: number): number { return Math.min(60_000, (this.opts.writeRetryMs ?? 2_000) * 2 ** (fails - 1)); }
  private deferredRunWrite(): void {
    void this.runs.saveAsync().then(ok => {
      if (ok) { this.writeFails.runs = 0; return; }
      if (this.deferWrites() && !this.runs.problem) this.runWriteSoon(this.retryDelay(++this.writeFails.runs));
    });
  }
  private deferredChatWrite(): void {
    void this.store.saveAsync(this.rows()).then(ok => {
      if (ok) { this.writeFails.chats = 0; return; }
      if (this.deferWrites()) this.persistSoon(this.retryDelay(++this.writeFails.chats));
    });
  }

  /** Everything still waiting or being written, now and synchronously: the quit, the process exit, a test. A failure
   *  is logged (the next start reads the last good write), never thrown. */
  override flushWrites(): void {
    try { this.analytics.flush(); } catch (e) { log.warn('chats', 'analytics not saved at quit', { cause: errText(e) }); }
    if (this.persistTimer) { clearTimeout(this.persistTimer); this.persistTimer = undefined; }
    if (this.runWriteTimer) { clearTimeout(this.runWriteTimer); this.runWriteTimer = undefined; }
    if (this.runSaveTimer) { clearTimeout(this.runSaveTimer); this.runSaveTimer = undefined; }
    this.store.save(this.rows());
    if (!this.runs.problem) try { this.runs.flush(); } catch (e) { log.warn('chats', 'agent runs not saved at quit', { cause: errText(e) }); }
  }
  protected runSaveSoon(): void {
    if (this.runs.problem) return;
    this.runs.touch();
    if (this.runSaveTimer) return;
    this.runSaveTimer = setTimeout(() => {
      this.runSaveTimer = undefined;
      if (this.deferWrites()) { this.deferredRunWrite(); return; }
      try { this.runs.flush(); } catch (e) { log.warn('chats', 'agent runs not saved', { cause: errText(e), hint: 'the next run change writes them again' }); }
    }, RUN_SAVE_MS);
    this.runSaveTimer.unref?.();
  }

  protected override restore(c: StoredChat): Rec {
    if (c.routineArchived || c.routine || c.routinePackage) c = { ...c, routineArchived: true, closedAt: c.closedAt ?? c.createdAt, closedBy: 'auto' };
    const restored = new AgentChildrenReducer(c.agentChildren);
    restored.end();
    const children = new AgentChildrenReducer(restored.snapshot());
    if (engineOf(c.harness)?.kind === 'api') children.coverage('complete');
    // agent-runs.json is the source of truth; a mirror it does not know (a lost or reset file) is taken back
    // (not one already pruned into the rollups: that mirror is dropped, and the chat remembers it was pruned)
    const run = c.run && (this.runs.get(c.run.runId) ?? (this.runs.problem ? c.run : this.runs.adopt(c.run)));
    const runPruned = run ? undefined : c.run ? c.run.runId : c.runPruned;
    return {
      ...(runPruned ? { runPruned } : {}),
      s: {
        agent: restoredOwner(c),
        ...(c.launchContext ? { launchContext: c.launchContext } : {}),
        ...(c.routineArchived ? { routineArchived: true as const } : {}),
        ...(c.routine ? { routine: c.routine } : {}),
        ...(c.routinePackage ? { routinePackage: c.routinePackage, routinePromptHash: c.routinePromptHash } : {}),
        ...(run ? { run } : {}),
        ...(c.work ? {work:c.work} : {}),
        effortStatus: initialEffort(!!engineOf(c.harness)?.caps.effort, c.effort),
        agentChildren: children.snapshot(),
        id: c.id, harness: c.harness, origin: 'app', title: c.quick ? LAMPO_TITLE : c.title, cwd: c.cwd, sessionId: c.sessionId, model: c.model, effort: c.effort,
        permissionMode: c.permissionMode, state: 'closed', costUsd: 0, pending: 0, isOrchestrator: c.isOrchestrator, ...(c.quick ? { quick: true } : {}), ...(c.research ? { research: true } : {}), lastText: '', updatedAt: c.closedAt ?? c.createdAt, browserTabIds: [],
        ...(engineOf(c.harness)?.caps.cost ? {} : { costKnown: false as const }),
        ...(c.context ? { contextTokens: c.context.tokens, ...(c.context.max ? { contextMaxTokens: c.context.max } : {}), ...(c.context.estimated ? { contextEstimated: true } : {}) } : {}),
        ...(c.handoffAt ? { handoffAt: c.handoffAt, handoffSource: c.handoffSource ?? 'chat' } : {}),
        ...(c.continuedFrom ? { continuedFrom: c.continuedFrom } : {}), ...(c.continuedBy ? { continuedBy: c.continuedBy } : {}),
        ...(c.closedAt ? { closedAt: c.closedAt, closedBy: c.closedBy ?? 'auto' } : {}),
        ...(c.route ? { route: c.route } : {}),
        ...(c.parentId ? { parentId: c.parentId } : {}),
        ...(c.delegation ? { delegation: c.delegation } : {}),
        ...(c.plan ? { plan: c.plan } : {}),
        ...(c.waitsOn ? { waitsOn: c.waitsOn } : {}), ...(c.waitsOnWork ? { waitsOnWork: true } : {}),
      },
      createdAt: c.createdAt,
      agentInstructions: c.agentInstructions ?? '',
      ...(c.agentAssets ? { agentAssets: c.agentAssets } : {}),
      ...(c.agentSkills ? { skills: c.agentSkills } : {}),
      ...(c.agentPolicy ? { policy: c.agentPolicy } : {}),
      ...(c.agentMaxContext ? { maxContext: c.agentMaxContext } : {}),
      children,
      choice: { model: c.model, effort: c.effort, permissionMode: c.permissionMode },
      ...(c.forkFrom ? { forkFrom: c.forkFrom } : {}),
      worktree: false,
      ...(c.inWorktree ? { inWorktree: true } : {}),
      costTotalUsd: c.costTotalUsd ?? 0,
      ...(c.userTaskEvents ? { userTaskEvents: c.userTaskEvents } : {}),
      ...(c.heldResult ? { heldResult: c.heldResult } : {}),
      ...(c.rootReportAt ? { rootReportAt: c.rootReportAt } : {}),
      ...(c.userWaits ? { userWaits: true } : {}),
      ...(c.autoCompleted ? { autoCompleted: true } : {}),
      working: c.working === true, ...(c.heldResults?.length ? { heldResults: c.heldResults } : {}),
      ...(c.unfinished ? { unfinished: true } : {}), ...(c.lastResult ? { savedResult: c.lastResult } : {}),
      items: [], pending: new Map(), session: null, historyLoaded: false,
      jobNew: false, firstPrompt: null, turnSinceDone: false, // a restored chat continues a job begun in an earlier run
      lastTurnAt: c.lastTurnAt ?? 0,
      ...(c.run && c.runIdleSince ? { idleSince: c.runIdleSince } : {}),
      ...(c.coldNoteAt ? { coldNoteAt: c.coldNoteAt } : {}),
      ...(c.continuationPending ? { continuationPending: c.continuationPending } : {}),
      ...(c.continuationDecisions ? { continuationDecisions: c.continuationDecisions } : {}),
      ...(c.continuityUnsafe ? { continuityUnsafe: true as const } : {}),
      // saved before ctxSince existed: its last turn is the latest its context can have begun
      ...(c.ctxSince || (c.lastTurnAt && !c.continuationPending) ? { ctxSince: c.ctxSince ?? c.lastTurnAt } : {}),
      ...(c.rolePrimed ? { rolePrimed: c.rolePrimed } : {}),
      ...(c.replyLang ? { replyLang: c.replyLang } : {}),
      ...(c.pastSessions?.length ? { pastSessions: c.pastSessions } : {}),
      ...(c.mcpAncestors ? { mcpAncestors: c.mcpAncestors } : {}),
    };
  }

  protected override persist(strict = false): void {
    if (strict || !this.deferWrites()) {
      if (this.persistTimer) { clearTimeout(this.persistTimer); this.persistTimer = undefined; }
      if (strict) this.store.checkpoint(this.rows()); else this.store.save(this.rows());
      return;
    }
    // persist runs from ~60 places, often several times per event: one write per burst, of the state as it is then
    this.persistSoon(this.opts.writeDelayMs!);
  }

  private rows(): StoredChat[] {
    return [...this.chats.values()].map(r => ({
      ...(r.s.launchContext ? { launchContext: r.s.launchContext } : {}),
      id: r.s.id, harness: r.s.harness, cwd: r.s.cwd, sessionId: r.s.sessionId, ...(r.forkFrom ? { forkFrom: r.forkFrom } : {}),
      ...(r.s.routineArchived ? { routineArchived: true as const } : {}),
      ...(r.s.routine ? { routine: r.s.routine } : {}),
      ...(r.s.routinePackage ? { routinePackage: r.s.routinePackage, routinePromptHash: r.s.routinePromptHash } : {}),
      ...(r.s.agent ? { agent: r.s.agent, agentInstructions: r.agentInstructions ?? '' } : {}),
      ...(r.agentAssets ? { agentAssets: r.agentAssets } : {}),
      ...(r.skills ? { agentSkills: r.skills } : {}),
      ...(r.policy ? { agentPolicy: r.policy } : {}),
      ...(r.maxContext ? { agentMaxContext: r.maxContext } : {}),
      ...(r.s.run ? { run: r.s.run, ...(r.idleSince ? { runIdleSince: r.idleSince } : {}) } : r.runPruned ? { runPruned: r.runPruned } : {}),
      ...(r.s.agentChildren ? { agentChildren: r.s.agentChildren } : {}),
      ...(r.s.work ? {work:r.s.work} : {}),
      title: r.s.title, model: r.choice.model, effort: r.choice.effort, permissionMode: r.choice.permissionMode, isOrchestrator: r.s.isOrchestrator,
      ...(r.s.quick ? { quick: true as const } : {}),
      ...(r.s.research ? { research: true as const } : {}),
      createdAt: r.createdAt, costTotalUsd: r.costTotalUsd, ...(r.inWorktree ? { inWorktree: true } : {}),
      ...(r.lastTurnAt ? { lastTurnAt: r.lastTurnAt } : {}),
      ...(r.coldNoteAt ? { coldNoteAt: r.coldNoteAt } : {}),
      ...(r.continuationPending ? { continuationPending: r.continuationPending } : {}),
      ...(r.continuationDecisions ? { continuationDecisions: r.continuationDecisions } : {}),
      ...(r.continuityUnsafe ? { continuityUnsafe: true as const } : {}),
      ...(r.ctxSince ? { ctxSince: r.ctxSince } : {}),
      ...(r.rolePrimed?.session ? { rolePrimed: r.rolePrimed } : {}),
      ...(r.replyLang ? { replyLang: r.replyLang } : {}),
      ...(r.pastSessions?.length ? { pastSessions: r.pastSessions } : {}),
      ...(r.s.contextTokens ? { context: { tokens: r.s.contextTokens, ...(r.s.contextMaxTokens ? { max: r.s.contextMaxTokens } : {}), ...(r.s.contextEstimated ? { estimated: true } : {}) } } : {}),
      ...(r.s.handoffAt ? { handoffAt: r.s.handoffAt, handoffSource: r.s.handoffSource ?? 'chat' } : {}),
      ...(r.s.continuedFrom ? { continuedFrom: r.s.continuedFrom } : {}), ...(r.s.continuedBy ? { continuedBy: r.s.continuedBy } : {}),
      ...(r.s.closedAt ? { closedAt: r.s.closedAt, closedBy: r.s.closedBy ?? 'auto' } : {}),
      ...(r.working ? { working: true as const } : {}),
      ...storedResult(r.s.lastResult ?? r.savedResult),
      ...(r.s.waitsOn ? { waitsOn: r.s.waitsOn } : {}), ...(r.s.waitsOnWork ? { waitsOnWork: true as const } : {}),
      ...(r.unfinished ? { unfinished: true as const } : {}),
      ...(r.userTaskEvents ? { userTaskEvents: r.userTaskEvents } : {}),
      ...(r.heldResult ? { heldResult: r.heldResult } : {}),
      ...(r.rootReportAt ? { rootReportAt: r.rootReportAt } : {}),
      ...(r.userWaits ? { userWaits: true } : {}),
      ...(r.autoCompleted ? { autoCompleted: true } : {}),
      ...(r.heldResults?.length ? { heldResults: r.heldResults } : {}),
      ...(r.s.route ? { route: r.s.route } : {}),
      ...(r.s.parentId ? { parentId: r.s.parentId } : {}),
      ...(r.s.delegation ? { delegation: r.s.delegation } : {}),
      ...(r.s.plan ? { plan: r.s.plan } : {}),
      ...(r.mcpAncestors ? { mcpAncestors: r.mcpAncestors } : {}),
    }));
  }

  /** Explicit update consent permits closing idle CLI sessions, including partially observable providers.
   * Unlike automatic archive, this does not assert a complete child census or delete/archive any chat. */
  updateReadiness(): string | null {
    for (const r of this.chats.values()) {
      const c = r.s;
      if (r.working || r.session?.busy || c.state === 'running' || c.state === 'starting' || c.pending || c.queued || workBehind(c) ||
        r.pending.size || r.deliveryHolds || r.opening || r.releasing || r.switching || r.archiving || r.handoffTurn ||
        c.agentChildren?.children.some(x => x.state === 'running' || x.state === 'waiting')) return 'Una chat ha attività o richieste in corso. Attendi prima di aggiornare.';
    }
    return null;
  }
  checkpointForUpdate(): void {
    if (!updateActivity.frozen) throw new Error('Salvataggio chat richiesto senza pausa aggiornamento.');
    const problem = this.updateReadiness(); if (problem) throw new Error(problem);
    for (const id of this.chats.keys()) this.flushItems(id);
    this.persist(true);
  }

  /** Loads the transcript's past once (resumed or forked chats), before any new item. */
  protected ensureHistory(r: Rec): void {
    if (r.historyLoaded) return;
    r.historyLoaded = true;
    if (!engineOf(r.s.harness)?.caps.transcript) return;
    // the sessions before its cold continuations come first, each closed by its divider (ADR 0031)
    const past: ChatItem[] = [];
    for (const p of r.pastSessions ?? []) {
      const f = findTranscript(p.sessionId, r.s.cwd, this.home);
      try {
        if (f) {
          const h = readHistory(f, { cwd: r.s.cwd, maxItems: this.max });
          if (fs.statSync(f).size > 4 * 1024 * 1024 || h.items.length >= this.max || h.items.some(i => i.kind === 'user' && !!i.images)) r.continuityUnsafe = true;
          past.push(...h.items);
        } else r.continuityUnsafe = true;
      } catch (e) {
        r.continuityUnsafe = true;
        log.warn('chats', 'past session not readable', { chat: r.s.id, data: { file: f, error: errText(e) } });
      }
      past.push(coldDivider(p.sessionId, p.at, p.notePath));
    }
    if (past.length + r.items.length >= this.max || (r.pastSessions?.length ?? 0) >= 20) r.continuityUnsafe = true;
    if (past.length) r.items = [...past, ...r.items].slice(-this.max);
    const sid = r.s.sessionId ?? r.forkFrom;
    if (!sid) return;
    const file = findTranscript(sid, r.s.cwd, this.home);
    if (!file) {
      // A known historical session with no readable transcript cannot prove that old images/questions survived.
      // Brand-new sessions legitimately have no transcript before their first turn.
      if (r.lastTurnAt > 0 || r.forkFrom) r.continuityUnsafe = true;
      return;
    }
    try {
      const h = readHistory(file, { cwd: r.s.cwd, maxItems: this.max });
      if (!h.items.length && (r.lastTurnAt > 0 || r.forkFrom)) r.continuityUnsafe = true;
      if (fs.statSync(file).size > 4 * 1024 * 1024 || past.length + h.items.length >= this.max || h.items.some(i => i.kind === 'user' && !!i.images)) r.continuityUnsafe = true;
      r.items = [...past, ...h.items, ...r.items.slice(past.length)].slice(-this.max);
      if (!r.s.lastText && h.lastText) r.s.lastText = h.lastText;
      // the CLI restores a session's spend on resume (2.1.277+): its total is the baseline for per-turn costs
      if (h.costTotalUsd !== null && !r.costTotalUsd) r.costTotalUsd = h.costTotalUsd;
      if (h.title && (r.s.title === 'Nuova chat' || r.s.title === 'Fork')) r.s.title = this.uniqueTitle(r.forkFrom ? `${h.title} (fork)` : h.title, r.s.id);
      log.info('chats', 'history loaded', { chat: r.s.id, data: { items: h.items.length, file: path.basename(file) } });
    } catch (e) {
      r.continuityUnsafe = true;
      log.warn('chats', 'history not readable', { chat: r.s.id, data: { file, error: errText(e) } });
    }
  }

  // ---- implemented in a later layer (ADR 0200: manager.ts and its manager-*.ts layers)
  protected abstract closeKeeping(r: Rec, sess: HarnessSession): Promise<void>;
  protected abstract reapKept(r: Rec): void;
  protected abstract settleReceipts(run: AgentRun): void;
}
