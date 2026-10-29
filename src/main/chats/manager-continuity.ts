// ChatManager layer (ADR 0200): long chats (ADR 0031, 0051). The hand-off note (handoff.ts) and «Riprendi»
// (continueChat), the cold note written while the cache is warm and the cold switch to a fresh session, fresh sessions
// on a context budget, the Orchestrator's day compaction, quiet turns and the context counters.
import crypto from 'node:crypto';
import type { ModelTier } from '../../shared/roles';
import type { AgentContextSnapshot } from '../../shared/agent-context';
import type { ChatSummary, ContextStats, HandoffInfo, NewChat } from '../../shared/contract';
import { sysEn } from '../../shared/sys';
import { errText, log } from '../log';
import { AFTER_CALLS, CACHE_TTL_MS, coldArmed, coldRoute, continuityStep, type ColdView, ORCHESTRATOR_COMPACT, ORCHESTRATOR_PAUSE_COMPACT, romeDay } from './continuity';
import { autoHandoff, contextBudgetDue, continuePrompt, FRESH_HANDOFF_MARK, FRESH_IDLE_MS, protectedHandoff, extractHandoff, handoffRequest, nextTitle } from './handoff';
import { isUuid, nextId, type HarnessSession } from './session';
import { updateActivity } from '../update/activity';
import { plainOwner } from '../agents/catalog';
import type { AgentPolicy } from '../agents/tool-policy';
import type { AgentOwnerSnapshot } from '../../shared/agents';
import type { RunLinks } from '../agents/runs';
import type { HandoffOptions, Rec, ColdStep } from './manager-types';
import { clearTimeout, workBehind, coldDivider, sysItem } from './manager-helpers';
import { ManagerRequests } from './manager-requests';

/** Long chats: hand-offs, «Riprendi», cold notes and cold switches, fresh sessions, the Orchestrator's day compaction. */
export abstract class ManagerContinuity extends ManagerRequests {

  // ---- long chats: hand-off and "Riprendi" ----

  /** The saved hand-off of a chat, or null. */
  readHandoff(chatId: string, session?: string): HandoffInfo | null {
    this.need(chatId);
    return this.handoffs.read(chatId, session);
  }

  /** The chat writes its hand-off now: one short turn, its answer saved as <userData>/handoffs/<chatId>.md. A chat that
   *  cannot be asked (no turn yet, a stopped engine with allowStart false, a failed or malformed answer) gets a
   *  token-free note built by the app (source 'auto'). Refused while the chat works or waits for the user. */
  async handoff(chatId: string, opts: HandoffOptions = {}): Promise<HandoffInfo> {
    const r = this.need(chatId);
    if (r.s.routineArchived) throw new Error('Archived routine chats are read-only.');
    if (r.handoffTurn) throw new Error('La chat sta già facendo un turno breve dell’app (passaggio di consegne o riassunto): riprova tra poco.');
    this.ensureHistory(r);
    const hasTurns = r.lastTurnAt > 0 || r.items.some(i => i.kind === 'result' || i.kind === 'user');
    if (hasTurns && (r.session?.busy || r.pending.size > 0)) throw new Error('La chat sta lavorando o ti aspetta: il passaggio si scrive quando ha finito il turno.');
    // an archived chat is never started for its hand-off (it has no tile for the turn): the app writes the note
    const canAsk = hasTurns && !r.s.closedAt && opts.ask !== false && (opts.allowStart !== false || !!r.session?.alive);
    let text: string | null = null;
    if (canAsk) {
      try { text = await this.askHandoff(r, opts.reason ?? 'manual'); } catch (e) {
        log.warn('chats', 'hand-off turn failed', { chat: chatId, data: errText(e) });
      }
    }
    if (this.chats.get(chatId) !== r) throw new Error('Chat chiusa mentre scriveva il passaggio.');
    // "Riprendi" whose hand-off turn was stopped or failed: nothing saved (a later "Riprendi" asks the chat again)
    if (r.handoffStopped && opts.reason === 'continue') throw new Error('Ripresa annullata: il passaggio di consegne si è interrotto (fermato o in errore). Riprova quando vuoi.');
    const info = this.handoffs.write(chatId, {
      title: r.s.title, text: text ?? autoHandoff(r.s, r.items), at: Date.now(), source: text ? 'chat' : 'auto',
      ...(r.s.contextTokens ? { contextTokens: r.s.contextTokens } : {}),
    });
    r.s.handoffAt = info.at; r.s.handoffSource = info.source;
    {
      const code = info.source === 'chat' ? 'handoffSavedChat' : 'handoffSavedAuto';
      this.addItem(r, { kind: 'system', id: nextId('s'), at: info.at, level: 'info', text: sysEn(code), code }, false);
    }
    this.persist();
    this.updated(r);
    log.info('chats', 'hand-off saved', { chat: chatId, data: { source: info.source, reason: opts.reason ?? 'manual', chars: info.text.length, contextTokens: r.s.contextTokens ?? null } });
    return info;
  }

  /** "Riprendi": a NEW chat on the same engine, folder and choices that starts from the hand-off (written first when
   *  missing or older than the last turn). The old chat's process ends; it stays readable, linked both ways.
   *  promptPrefix: a label put before the prompt (an agent's request is marked as not the user's). */
  continueChat(chatId: string, opts: { allowStart?: boolean; promptPrefix?: string } = {}): Promise<ChatSummary> {
    const running = this.continuing.get(chatId);
    if (running) return running;
    const p = this.doContinue(chatId, opts).finally(() => this.continuing.delete(chatId));
    this.continuing.set(chatId, p);
    return p;
  }

  private async doContinue(chatId: string, opts: { allowStart?: boolean; promptPrefix?: string }): Promise<ChatSummary> {
    const r = this.need(chatId);
    if (r.s.routineArchived) throw new Error('Archived routine chats are read-only.');
    if (r.s.isOrchestrator) throw new Error('L’Orchestrator non si riprende così: usa «Ricomincia da capo» dal suo menu.');
    const next = r.s.continuedBy && this.chats.get(r.s.continuedBy.id);
    if (next) return { ...next.s };
    // never two agents on the same files: the old chat must have finished its turn (a fresh note does not cover this one)
    const hasTurns = r.lastTurnAt > 0 || r.items.some(i => i.kind === 'result' || i.kind === 'user');
    if (r.handoffTurn || (hasTurns && (r.session?.busy || r.pending.size > 0))) throw new Error('La chat sta lavorando o ti aspetta: si riprende quando ha finito il turno.');
    const saved = this.handoffs.read(chatId);
    const fresh = saved && saved.at >= r.lastTurnAt ? saved : null;
    r.handoffStopped = false;
    const h = fresh ?? await this.handoff(chatId, { reason: 'continue', ...(opts.allowStart === false ? { allowStart: false } : {}) });
    const taken = [...this.chats.values()].map(x => x.s.title);
    // a delegated chat goes on as the same child: under its parent, with its contract, its result still the parent's
    // (never a root chat that escapes the limits or that the Orchestrator could read, ADR 0083)
    const parentRec = r.s.parentId ? this.chats.get(r.s.parentId) : undefined;
    if (r.s.parentId && !parentRec) throw new Error('La chat che l’ha delegata non c’è più: questa non si riprende da sola.');
    const c = await this.create({
      harness: r.s.harness, cwd: r.s.cwd, title: nextTitle(r.s.title, taken),
      ...(r.choice.model ? { model: r.choice.model } : {}), ...(r.choice.effort ? { effort: r.choice.effort } : {}), ...(r.choice.permissionMode ? { permissionMode: r.choice.permissionMode } : {}),
      // a routed job stays one outcome across hand-offs: the new chat writes on the first chat's ledger line
      ...(r.s.route ? { route: { ...r.s.route, ledgerId: r.s.route.ledgerId ?? `app:${r.s.id}`, handoffs: (r.s.route.handoffs ?? 0) + 1 } } : {}),
      prompt: `${opts.promptPrefix ? `${opts.promptPrefix}\n\n` : ''}${continuePrompt({ ...r.s, ...(r.inWorktree ? { inWorktree: true } : {}) }, h)}`,
      ...(parentRec ? { parentId: parentRec.s.id, ...(r.s.delegation ? { delegation: structuredClone(r.s.delegation) } : {}) } : {}),
    }, 'user', { ...(r.s.launchContext ? { launchContext: r.s.launchContext } : {}), ...(r.s.run?.tier ? { tier: r.s.run.tier } : {}), ...(r.s.routinePackage ? { routinePackage: r.s.routinePackage, routinePromptHash: r.s.routinePromptHash } : {}), owner: r.s.agent ?? plainOwner(r.s.harness, r.choice.model), instructions: r.agentInstructions ?? '', policy: r.policy ?? null, assets: r.agentAssets, ...(r.skills ? { skills: [...r.skills] } : {}), ...(r.maxContext ? { maxContext: r.maxContext } : {}) },
    {}, { ...(r.s.routine ? { routine: r.s.routine } : {}), continuation: !!parentRec, continuationOf: r.s.id });
    const nr = this.chats.get(c.id);
    // the worktree hint follows the chain (A → B → C)
    if (nr) { nr.s.continuedFrom = { id: r.s.id, title: r.s.title }; if (r.inWorktree) nr.inWorktree = true; this.updated(nr); }
    // the agent's work goes on in a new run: the old one counts as reworked (§5)
    if (nr?.s.run && r.s.run && this.runs.get(r.s.run.runId)) { nr.s.run.continuedFrom = r.s.run.runId; this.runSave(); }
    r.s.continuedBy = { id: c.id, title: c.title };
    this.addItem(r, sysItem('continuedIn', { title: c.title }, 'info'), false);
    this.persist();
    this.updated(r);
    // its context is not re-read any more: the process ends now, or when the turn that just wrote the hand-off settles
    if (r.session && !r.session.busy) await this.closeKeeping(r, r.session);
    else if (r.session) r.reopen = true;
    log.info('chats', 'chat continued in a new one', { chat: chatId, data: { next: c.id, handoff: h.source, fresh: !!fresh } });
    return { ...(nr?.s ?? c) };
  }

  /** Writes the hand-off when it is missing or older than the last turn (the auto-close calls it before archiving). */
  async ensureHandoff(chatId: string, opts: HandoffOptions = {}): Promise<HandoffInfo> {
    const r = this.need(chatId);
    const saved = this.handoffs.read(chatId);
    if (saved && saved.at >= r.lastTurnAt) return saved;
    return this.handoff(chatId, { reason: 'finished', ...opts });
  }

  // ---- cold chats: the invisible continuation (ADR 0031) ----

  /** How the Claude chats used their context (zero tokens: from the usage the engines report). */
  contextStats(): ContextStats { return this.counters.snapshot(); }

  protected override coldOn(): boolean { return !!this.opts.coldHandoff?.(); }
  protected override ttl(): number { return this.opts.cacheTtlMs ?? CACHE_TTL_MS; }

  /** Budget freshness uses the existing auto-close observed-idle boundary for live Claude, not a fictitious
   *  complete census. Running/waiting/unknown observations and app/background work still block. The older cache
   *  expiry path keeps its stricter complete-census guard. Recheck all guards at delivery. */
  private freshWorkBehind(r: Rec): boolean {
    const justAssigned = r.freshAssignmentRun && r.s.run?.runId === r.freshAssignmentRun && r.s.work?.status === 'assigned';
    return (r.s.background ?? 0) > 0 || !!r.s.waitsOnWork || (!!r.s.work && r.s.work.status !== 'completed' && !justAssigned);
  }

  protected freshReady(r: Rec, now: number): boolean {
    return !!this.opts.freshSessions?.() && r.s.harness === 'claude' && !r.s.isOrchestrator && !r.s.quick
      && !r.s.closedAt && !r.s.continuedBy && r.s.state === 'idle' && !r.working && !r.session?.busy
      && !r.pending.size && !r.commandsOpen?.size && !r.handoffTurn && !r.archiving && !r.autoClosing && !r.releasing && !r.opening && !r.s.queued && (r.deliveryHolds ?? 0) <= 1
      && !r.askedParentAt && !this.freshWorkBehind(r) && !r.s.waitsOn && r.s.plan?.phase !== 'proposed'
      && !r.unfinished && !r.s.lastError && !!r.s.lastResult && !r.s.lastResult.isError && !r.s.lastResult.interrupted
      && r.s.agentChildren?.coverage !== 'unknown' && this.childrenDone(r) && !this.observedChildrenBusy(r)
      && !!r.lastTurnAt && now - r.lastTurnAt >= FRESH_IDLE_MS && contextBudgetDue(r.s);
  }

  /** Deterministic state, rebuilt immediately before switching so an intervening user decision cannot go stale. */
  private freshHandoff(r: Rec): HandoffInfo | null {
    this.ensureHistory(r);
    // Never assume evicted history or image context can be reconstructed from a partial text note.
    if (r.continuityUnsafe || r.userTaskEvents?.latestSeq === Number.MAX_SAFE_INTEGER || (!r.s.run?.taskContract && !r.items.some(i => i.kind === 'user'))) return null;
    let workflow: string | null;
    try { workflow = this.opts.continuationContext?.(r.s.id) ?? null; } catch { return null; }
    if (workflow === null) return null;
    const text = protectedHandoff(r.s, r.items, {
      chatId: r.s.id, cwd: r.s.cwd, parentId: r.s.parentId, delegation: r.s.delegation,
      run: r.s.run, userEvents: r.userTaskEvents, plan: r.s.plan, privateDecisions: r.continuationDecisions,
      // Keep visible messages absent from the event ledger (e.g. original delegated assignment) and their provenance.
      messages: r.items.filter(i => i.kind === 'user'),
    }, workflow);
    if (!text) return null;
    const info = this.handoffs.write(r.s.id, { title: r.s.title, text, at: Date.now(), source: 'auto', ...(r.s.contextTokens !== undefined ? { contextTokens: r.s.contextTokens } : {}) });
    r.s.handoffAt = info.at; r.s.handoffSource = info.source; r.coldNoteAt = info.at;
    this.persist(); this.updated(r);
    return info;
  }

  protected override coldView(r: Rec): ColdView {
    return {
      harness: r.s.harness, isOrchestrator: r.s.isOrchestrator, continuedBy: r.s.continuedBy,
      // an archived chat kept alive for its note counts as idle (archive: closeAfterCold)
      state: r.closeAfterCold && r.s.closedAt && r.s.state === 'closed' ? 'idle' : r.s.state,
      // a final answer that waits for its work counts as one more background task: no note, no fresh session
      pending: r.pending.size, background: (r.s.background ?? 0) + (r.s.waitsOnWork ? 1 : 0) + (r.s.work && r.s.work.status !== 'completed' ? 1 : 0) + (this.observedChildrenBusy(r) ? 1 : 0), busy: !!r.session?.busy, alive: !!r.session?.alive, handoffTurn: !!r.handoffTurn,
      contextTokens: r.s.contextTokens ?? 0, lastTurnAt: r.lastTurnAt, noteAt: r.coldNoteAt ?? 0,
      lastCallAt: Math.max(r.lastTurnAt, r.coldNoteAt ?? 0), askedFor: r.coldAskedFor,
    };
  }

  /** Every minute (coldEveryMs): each idle long Claude chat whose cache is about to expire writes its note quietly;
   *  an archived chat kept for its note whose chance passed ends its engine. Returns how many were asked. */
  override coldTick(now = Date.now()): number {
    if (updateActivity.frozen) return 0;
    if (this.quitting) return 0;
    const on = this.coldOn(), idle = this.opts.coldIdleMs?.() ?? 50 * 60_000, day = !!this.opts.orchestratorDayCompact?.();
    let n = 0;
    for (const r of this.chats.values()) {
      if (r.s.routineArchived) continue;
      if ((r.deliveryHolds ?? 0) > 0 || this.observedChildrenBusy(r)) continue;
      if (this.freshReady(r, now)) {
        const existing = this.handoffs.read(r.s.id);
        if (existing?.text.startsWith(FRESH_HANDOFF_MARK) && existing.at >= r.lastTurnAt) continue;
        if (this.freshHandoff(r)) { n++; continue; }
      }
      if (this.opts.freshSessions?.() && contextBudgetDue(r.s) && now - r.lastTurnAt >= FRESH_IDLE_MS) {
        const reason = this.freshReady(r, now) ? 'protected-context-unavailable-or-too-large' : 'chat-not-idle-or-unsettled-work';
        const key = `${r.s.sessionId}:${reason}`;
        if (r.freshDeferred !== key) { r.freshDeferred = key; log.info('chats', 'fresh session deferred', { chat: r.s.id, data: { reason, coverage: r.s.agentChildren?.coverage ?? 'unknown' } }); }
      }
      const v = this.coldView(r);
      const step = continuityStep({ ...v, ctxSince: r.ctxSince, askedOn: r.dayCompactOn }, now, { cold: on, day, idleMs: idle, ttlMs: this.ttl() });
      if (step === 'note') { n++; void this.coldNote(r); continue; }
      if (step === 'compact') { n++; void this.orchestratorCompact(r, now); continue; }
      if (step === 'pause') { n++; r.coldAskedFor = r.lastTurnAt; void this.orchestratorCompact(r, now, ORCHESTRATOR_PAUSE_COMPACT); continue; }
      if (r.closeAfterCold && !r.handoffTurn && (!on || !coldArmed(v, now, this.ttl()))) void this.endKept(r);
    }
    return n;
  }

  /** One quiet hand-off turn on the warm cache: nothing shows in the tile; the note is saved only when the chat wrote
   *  it (a token-free note is no base for a continuation: the next message then resumes the old session). */
  private async coldNote(r: Rec): Promise<void> {
    r.coldAskedFor = r.lastTurnAt;
    const ctx = r.s.contextTokens ?? 0;
    log.info('chats', 'cold chat: asking its note while the cache is warm', { chat: r.s.id, data: { contextTokens: ctx, idleMin: Math.round((Date.now() - Math.max(r.lastTurnAt, r.coldNoteAt ?? 0)) / 60000) } });
    let text: string | null = null;
    try { text = await this.askHandoff(r, 'cold', true); } catch (e) {
      log.warn('chats', 'cold note turn failed', { chat: r.s.id, cause: errText(e), hint: 'the next message resumes the old session (one cold re-read)' });
    }
    if (this.chats.get(r.s.id) !== r) return;
    if (text) {
      const info = this.handoffs.write(r.s.id, { title: r.s.title, text, at: Date.now(), source: 'chat', ...(ctx ? { contextTokens: ctx } : {}) });
      r.s.handoffAt = info.at; r.s.handoffSource = 'chat';
      // a message queued behind the quiet turn goes on in the old session: the note is no base for it
      if (!r.working) r.coldNoteAt = info.at;
      this.counters.note(r.s.id, 'written', { contextTokens: ctx, chars: info.text.length });
      this.persist();
      this.updated(r);
    } else log.info('chats', 'cold note not written', { chat: r.s.id, data: { stopped: !!r.handoffStopped } });
    if (r.closeAfterCold) await this.endKept(r);
  }

  /** An Orchestrator's day compaction (continuity.ts orchestratorDayDue): one quiet `/compact` turn with what to keep; the engine's compact_boundary
   *  shows in the tile («Contesto compattato») and starts its context's day again. Same chat, same session. */
  private async orchestratorCompact(r: Rec, now: number, prompt = ORCHESTRATOR_COMPACT): Promise<void> {
    r.dayCompactOn = romeDay(now);
    const sess = r.session;
    if (!sess) return;
    log.info('chats', 'Orchestrator: compacting a context from an earlier day', { chat: r.s.id, data: { contextTokens: r.s.contextTokens ?? null, since: r.ctxSince ?? null } });
    this.addItem(r, sysItem('dayCompactStart', undefined, 'info'), false);
    const out = await this.quietTurn(r, sess, prompt, true).catch((e: unknown) => {
      log.warn('chats', 'Orchestrator day compaction not sent', { chat: r.s.id, cause: errText(e), hint: 'it still compacts by itself at its window (compactWindowTokens); tomorrow it tries again' });
      return null;
    });
    if (out !== null) return;
    log.info('chats', 'Orchestrator day compaction did not finish', { chat: r.s.id, data: { contextTokens: r.s.contextTokens ?? null } });
    this.addItem(r, sysItem('dayCompactFailed', undefined, 'warn'), false);
  }

  /** The engine an auto-close kept for the cold note ends now (the chat stays archived). */
  private async endKept(r: Rec): Promise<void> {
    r.closeAfterCold = false;
    const sess = r.session;
    // the note's result comes a moment before the engine reports idle
    for (let i = 0; i < 50 && sess?.busy && r.session === sess && r.s.closedAt; i++) await new Promise(res => setTimeout(res, 200));
    if (!r.s.closedAt || !sess || sess.busy || r.session !== sess || r.pending.size > 0 || (r.deliveryHolds ?? 0) > 0 || this.unsettledChildren(r)) return;
    await sess.close();
    this.reapKept(r);
  }

  /** A message to a cold chat whose cache expired: the old session ends, a fresh one (new session id, same chat,
   *  title and choices) will start from the note. Returns the step the first message carries (send commits it with
   *  coldDone once the engine started, or undoes it with coldUndo when it did not), null when the chat
   *  goes on as usual. A second message meanwhile waits for the switch. */
  protected async coldSwitch(r: Rec): Promise<ColdStep | null> {
    if (r.switching) { await r.switching; return null; }
    const fresh = this.freshReady(r, Date.now());
    if (!fresh && (!this.coldOn() || this.unsettledChildren(r) || !coldRoute(this.coldView(r), Date.now(), this.ttl()))) return null;
    let h = fresh ? this.freshHandoff(r) : this.handoffs.read(r.s.id);
    if (!h || (!fresh && h.source !== 'chat') || h.at < r.lastTurnAt) { r.coldNoteAt = undefined; return null; }
    const run = (async (): Promise<ColdStep | null> => {
      if (r.releasing) await r.releasing;
      if (fresh ? !this.freshReady(r, Date.now()) : this.unsettledChildren(r) || !coldRoute(this.coldView(r), Date.now(), this.ttl())) return null;
      const revision = r.activityRevision;
      if (r.session) {
        r.autoEnding = true;
        try { await this.closeKeeping(r, r.session); } finally { r.autoEnding = false; }
      }
      if (r.activityRevision !== revision || (fresh ? !this.childrenDone(r) || this.observedChildrenBusy(r) || !!r.s.lastError : this.unsettledChildren(r)) || r.pending.size > 0 || r.commandsOpen?.size || (fresh ? this.freshWorkBehind(r) : workBehind(r.s))) return null;
      // Closing can await provider teardown while a workflow decision changes; use the latest durable snapshot.
      if (fresh) { h = this.freshHandoff(r); if (!h) return null; }
      const now = Date.now(), old = r.s.sessionId;
      if (!h) return null;
      const step: ColdStep = {
        h, old, at: now, idleMin: Math.round((now - Math.max(r.lastTurnAt, r.coldNoteAt ?? 0)) / 60000),
        prev: { forkFrom: r.forkFrom, costTotalUsd: r.costTotalUsd, contextTokens: r.s.contextTokens, contextMaxTokens: r.s.contextMaxTokens, coldNoteAt: r.coldNoteAt, after: r.after, ctxSince: r.ctxSince },
        notePath: isUuid(old) ? this.handoffs.archive(r.s.id, old) : h.path,
      };
      // Never commit a new session without its immutable recovery note (the best-effort archive may fail).
      if (isUuid(old)) {
        const archived = this.handoffs.read(r.s.id, old);
        if (!archived || archived.at !== h.at || archived.text !== h.text) return null;
      }
      if (isUuid(old)) { (r.pastSessions ??= []).push({ sessionId: old, at: now, notePath: step.notePath }); r.pastSessions.splice(0, Math.max(0, r.pastSessions.length - 20)); }
      r.s.sessionId = crypto.randomUUID();
      // Durable before the new engine starts. A send/start failure or process restart must never lose the handoff.
      if (isUuid(old)) r.continuationPending = old;
      delete r.forkFrom;
      r.costTotalUsd = 0; // the new session's own running total starts from zero
      delete r.s.contextTokens; delete r.s.contextMaxTokens;
      r.coldNoteAt = undefined; r.ctxSince = undefined;
      r.after = { kind: 'continuation', left: AFTER_CALLS };
      this.persist(true);
      return step;
    })();
    r.switching = run;
    try { return await run; } finally { r.switching = undefined; }
  }

  /** The fresh session started: the divider folds the old session, the note counts as used. */
  protected coldDone(r: Rec, c: ColdStep): void {
    this.addItem(r, coldDivider(c.old ?? 'x', c.at, c.notePath), false);
    this.counters.note(r.s.id, 'used', { idleMin: c.idleMin, contextTokens: c.h.contextTokens ?? null });
    this.persist();
    this.updated(r);
    log.info('chats', 'cold chat continued in a fresh session', { chat: r.s.id, data: { idleMin: c.idleMin, from: c.old, to: r.s.sessionId, contextTokens: c.h.contextTokens ?? null } });
  }

  /** The fresh session did not start: back to the old one, the note kept for the next message. */
  protected coldUndo(r: Rec, c: ColdStep): void {
    if (r.session) return; // an engine on the new id runs: keep it
    if (c.old) r.s.sessionId = c.old;
    r.continuationPending = undefined;
    if (isUuid(c.old)) r.pastSessions?.pop();
    if (c.prev.forkFrom) r.forkFrom = c.prev.forkFrom;
    r.costTotalUsd = c.prev.costTotalUsd;
    if (c.prev.contextTokens !== undefined) r.s.contextTokens = c.prev.contextTokens;
    if (c.prev.contextMaxTokens !== undefined) r.s.contextMaxTokens = c.prev.contextMaxTokens;
    r.coldNoteAt = c.prev.coldNoteAt;
    r.after = c.prev.after; r.ctxSince = c.prev.ctxSince;
    this.persist();
    this.updated(r);
    log.warn('chats', 'cold continuation not started', { chat: r.s.id, cause: r.s.lastError ?? 'engine did not start', hint: 'the note stays: the next message tries the fresh session again' });
  }

  /** One hand-off turn: the request goes to the chat (shown as a short line, not as the user's message) and the
   *  answer's text between the markers comes back; null when the chat ended, timed out or answered off format. */
  private async askHandoff(r: Rec, reason: NonNullable<HandoffOptions['reason']>, quiet = false): Promise<string | null> {
    await this.ensureSession(r);
    const sess = r.session;
    if (!sess) return null;
    // a cold note never runs a tool (no now.md line): one short answer on a warm cache
    const text = handoffRequest({ title: r.s.title, reason, contextTokens: r.s.contextTokens ?? null, memTool: quiet ? null : this.opts.memTool?.() ?? null });
    const out = await this.quietTurn(r, sess, text, quiet, () => {
      if (quiet) return;
      r.s.handoffBusy = true;
      this.addItem(r, sysItem('handoffAsking', undefined, 'info'), false);
      this.updated(r);
    });
    return out === null ? null : extractHandoff(out);
  }

  /** One turn of the app's own (a hand-off, an Orchestrator's day compaction), not of the job: its assistant texts come back
   *  joined, null when it was stopped, failed or timed out (then interrupted, its late items still swallowed); `quiet` =
   *  its items stay out of the tile but the system lines. `before` runs once the turn is armed, before the text goes. */
  private quietTurn(r: Rec, sess: HarnessSession, text: string, quiet: boolean, before?: () => void): Promise<string | null> {
    const answer = new Promise<string | null>(resolve => {
      // no answer in time (e.g. a permission nobody answers): the turn is stopped, so a late answer is never taken as a real turn
      const timer = setTimeout(() => {
        finish(null);
        // the stopped turn's last items still belong to the hand-off (markers hidden, not a job turn), then it is over
        // (never for long: a failed interrupt or a CLI that never answers must not block the chat's next turns)
        const drain = (): void => { clearTimeout(expire); if (r.handoffTurn?.done === drain) r.handoffTurn = undefined; };
        const expire = setTimeout(drain, 30_000);
        expire.unref();
        r.handoffTurn = { texts: new Map(), done: drain, ...(quiet ? { quiet } : {}) };
        sess.interrupt().catch(e => { drain(); log.debug('chats', 'hand-off turn not interrupted', { chat: r.s.id, data: errText(e) }); });
      }, this.opts.handoffTimeoutMs ?? 300_000);
      timer.unref();
      const finish = (t: string | null): void => {
        clearTimeout(timer);
        if (r.handoffTurn?.done !== finish) return;
        r.handoffTurn = undefined;
        delete r.s.handoffBusy;
        this.updated(r);
        resolve(t);
      };
      r.handoffTurn = { texts: new Map(), done: finish, ...(quiet ? { quiet } : {}) };
    });
    before?.();
    try { sess.send(text); } catch (e) { r.handoffTurn?.done(null); return Promise.reject(e); }
    return answer;
  }

  /** When this chat's context last began again (a new session or a compaction); undefined = unknown. */
  contextSince(chatId: string): number | undefined { return this.chats.get(chatId)?.ctxSince; }

  // ---- implemented in a later layer (ADR 0200: manager.ts and its manager-*.ts layers)
  abstract create(req: NewChat, by?: 'user' | 'agent' | 'app', inherited?: { launchContext?: AgentContextSnapshot; tier?: ModelTier; routinePackage?: string; owner: AgentOwnerSnapshot; instructions: string; policy?: AgentPolicy | null; assets?: { pluginDir: string; skillRoot: string }; skills?: string[]; maxContext?: number }, links?: RunLinks, opts?: { routine?: ChatSummary['routine']; boundByOrchestrator?: boolean; continuation?: boolean; continuationOf?: string }): Promise<ChatSummary>;
  protected abstract childrenDone(r: Rec): boolean;
  protected abstract observedChildrenBusy(r: Rec): boolean;
}
