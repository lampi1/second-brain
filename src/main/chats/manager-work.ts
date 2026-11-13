// ChatManager layer (ADR 0200): the work. Assignments (assignTask), the user's messages in a work chat (userWrote:
// notes for the Orchestrator and the parent, user events), corrections after a report, the user's verdict on a run and
// the run metrics, the Strategist's plan (ADR 0108: propose, update, approve or change).
import crypto from 'node:crypto';
import path from 'node:path';
import type { ChatSummary } from '../../shared/contract';
import { errText, log } from '../log';
import type { UserTaskEvents, AgentRun, AgentRunOutcome } from '../../shared/agents';
import { ownerSource, type TaskAssignmentOptions } from '../../shared/delegation';
import { PLAN_APPROVED, planChange, askingPlan, strategyPrompt, withAdded, withDelegated, withStep, type PlanStep, type StepState, type StrategyPlan } from '../../shared/strategy';
import { runMetrics } from '../agents/run-metrics';
import { standings, withStandings } from '../agents/standing';
import { isCorrection } from '../../shared/correction';
import type { SubmissionReceipt, Rec, CleanReportNote, UserWroteNote, TurnEndInfo } from './manager-types';
import { sysItem, userNoteLine } from './manager-helpers';
import { phoneTime } from './phone-reply';
import { ManagerLifecycle } from './manager-lifecycle';
import type { AppAsk } from './session';
import { proposalHash } from '../coordination/store';
import type { RequestKey } from '../coordination/model';

/** The work on a chat: assignments, the user's own messages and corrections, run verdicts and metrics, the Strategist's plan. */
export abstract class ManagerWork extends ManagerLifecycle {
  override async shutdown(graceMs?: number, capMs?: number): Promise<void> {
    try { await super.shutdown(graceMs, capMs); } finally { this.closeCoordination(); }
  }

  private planRequestKey(r: Rec, plan: StrategyPlan): RequestKey {
    const originalRequestId = `plan:${plan.at}`;
    // A later workflow link does not change the job on whose behalf this exact proposal was issued.
    const jobId = this.coordination.original(r.s.id, originalRequestId)?.key.jobId ?? this.coordination.jobFor(r.s.id) ?? r.s.run?.taskId ?? `chat:${r.s.id}`;
    return { originalRequestId, jobId, chatId: r.s.id,
      runId: r.s.run?.runId ?? null, taskVersion: r.s.run?.taskVersion ?? 1, proposalRevision: plan.at,
      proposalHash: proposalHash({ steps: plan.steps, clarified: plan.clarified, doneWhen: plan.doneWhen, pcOnly: plan.pcOnly }) };
  }

  /** Full instructions plus an optimistic cursor; reading never marks them acknowledged. */
  userEvents(chatId: string, afterSeq = 0): UserTaskEvents {
    const ledger = this.need(chatId).userTaskEvents ?? { events: [], latestSeq: 0, acknowledgedSeq: 0 };
    if (ledger.latestSeq === Number.MAX_SAFE_INTEGER) throw new Error('The persisted user event ledger is invalid; restore it before assigning work.');
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0 || afterSeq > ledger.latestSeq) throw new Error('Invalid event cursor.');
    return structuredClone({ ...ledger, events: ledger.events.filter(event => event.seq > afterSeq) });
  }

  /** ask_user (chats/ask-tool.ts): a yes/no question on a chat whose engine's question tool may not reach the model (ACP).
   *  null = shown; a string = refused, with how to ask. */
  async askUser(chatId: string, q: AppAsk): Promise<string | null> {
    const r = this.need(chatId);
    if (!r.session?.askUser) return 'ask_user: this chat\'s engine asks with its own question tool (AskUserQuestion on Claude).';
    return r.session.askUser(q);
  }

  /** plan_propose (agents/strategy-tools.ts): the Strategist's plan waits for the user's ok on its strip. */
  planPropose(chatId: string, steps: PlanStep[], doneWhen?: string, map?: string): StrategyPlan {
    const r = this.need(chatId), plan = r.s.plan;
    if (!plan) throw new Error('plan_propose: only a Strategist the Orchestrator or the user started has a plan with the user.');
    if (plan.phase === 'running' || plan.phase === 'done') throw new Error('plan_propose: the plan is approved and under way; update its steps with plan_update.');
    // «Modalità notte» (ADR 0191): nobody will click «Approva e parti», so the plan starts as proposed (its recommended
    // choice) and the tool says so; the recap tells the user
    const away = !!this.opts.away?.();
    const proposed: StrategyPlan = { phase: away ? 'running' : 'proposed', clarified: plan.clarified, ...(plan.pcOnly ? { pcOnly: true } : {}), ...(plan.asked ? { asked: plan.asked } : {}), ...(plan.enough ? { enough: true } : {}), steps, ...(doneWhen ? { doneWhen } : {}), ...(map ? { map } : {}), at: Math.max(Date.now(), plan.at + 1) };
    const store = this.coordination;
    const key = this.planRequestKey(r, proposed);
    const prior = store.original(r.s.id, key.originalRequestId);
    if (prior && proposalHash(prior.key) !== proposalHash(key)) throw new Error('Plan revision reused with changed scope; propose a fresh revision.');
    store.register({ key, kind: 'plan', at: proposed.at, payload: proposed }, `plan:${plan.at}`);
    const accepted = away ? store.resolve(key, { kind: 'policy', policy: 'away-plan' }, { decision: 'approve' }) : undefined;
    r.s.plan = proposed;
    // the run keeps the plan's fate: a decision signal for the Orchestrator (standing.ts, ADR 0131)
    const run = r.s.run;
    if (run && run.endedAt === undefined) { run.plan = { ...(run.plan ?? { proposals: 0, changes: 0 }), proposals: (run.plan?.proposals ?? 0) + 1 }; this.runSave(); }
    if (away) {
      if (run && run.endedAt === undefined) { run.plan = { ...run.plan!, approvedAt: Date.now(), byApp: true }; this.runSave(); }
      this.addItem(r, sysItem('awayPlan', { steps: steps.length }, 'info'), false);
      this.hook('onAway', () => this.opts.onAway?.({ kind: 'plan', chatId, title: r.s.title || 'Strategist', text: steps.map(x => x.title).join(' · ') }));
    }
    this.persist(away);
    if (accepted) store.recordApplication(accepted.id);
    this.updated(r);
    log.info('chats', 'plan proposed', { chat: chatId, data: { steps: steps.length } });
    return structuredClone(r.s.plan);
  }

  /** plan_update: a step the Strategist does itself (or corrects) moves on. */
  planUpdate(chatId: string, i: number, state: StepState): StrategyPlan {
    const r = this.need(chatId), plan = r.s.plan;
    if (!plan || (plan.phase !== 'running' && plan.phase !== 'done')) throw new Error('plan_update: the user has not approved a plan yet.');
    r.s.plan = withStep(plan, i, state, Date.now());
    this.persist();
    this.updated(r);
    return structuredClone(r.s.plan);
  }

  /** plan_update add (ADR 0276): a piece found on the way joins the approved plan as one more step; no new approval. */
  planAdd(chatId: string, step: PlanStep): StrategyPlan {
    const r = this.need(chatId), plan = r.s.plan;
    if (!plan) throw new Error('plan_update add: only a Strategist with a plan approved by the user has steps.');
    r.s.plan = withAdded(plan, step, Date.now());
    this.persist();
    this.updated(r);
    log.info('chats', 'plan step added on the way', { chat: chatId, data: { steps: r.s.plan.steps.length } });
    return structuredClone(r.s.plan);
  }

  /** The plan of a chat (agent_delegate reads it: no delegation before the user's ok, a `step` within its steps). */
  planOf(chatId: string): StrategyPlan | null { const p = this.chats.get(chatId)?.s.plan; return p ? structuredClone(p) : null; }

  /** agent_delegate with a `step`: those children work on it. */
  planDelegated(chatId: string, i: number, chatIds: string[]): void {
    const r = this.chats.get(chatId), plan = r?.s.plan;
    if (!r || !plan || !plan.steps[i] || !chatIds.length) return;
    // A new execution of this step must not wait on siblings from an older parent assignment.
    const current = { ...plan, steps: plan.steps.map((step, k) => k !== i || !step.chatIds ? step : { ...step, chatIds: step.chatIds.filter(id => chatIds.includes(id) || this.chats.get(id)?.s.run?.parentRunId === r.s.run?.runId) }) };
    r.s.plan = withDelegated(current, i, chatIds, Date.now());
    this.persist();
    this.updated(r);
  }

  /** The user's click on a proposed plan (chat:plan): «Approva e parti» or «Cambia qualcosa» with what to change; the
   *  Strategist gets it as the user's message. «Basta domande» is an answer to its open question (renderer).
   *  by 'phone' = a button on the paired phone (chats/phone-port.ts): the same checks, a «Risposto dal telefono» line. */
  async planDecide(chatId: string, decision: 'approve' | 'change', at: number, text?: string, by: 'pc' | 'phone' = 'pc'): Promise<void> {
    return this.decidePlan(chatId, decision, at, text, undefined, undefined, false, by);
  }

  /** Decision commits before delivery. A delivery failure never rolls accepted consent back into a fresh question. */
  protected override async decidePlan(chatId: string, decision: 'approve' | 'change', at: number, text?: string, message?: string, receipt?: SubmissionReceipt, byApp = false, by: 'pc' | 'phone' = 'pc'): Promise<void> {
    const r = this.need(chatId), plan = r.s.plan;
    if (!plan || plan.phase !== 'proposed') throw new Error('Questo piano non aspetta più una risposta.');
    if (plan.at !== at) throw new Error('Il piano è cambiato nel frattempo: rileggilo.');
    const change = typeof text === 'string' ? text.trim() : '';
    if (decision === 'change' && (!change || change.length > 2000)) throw new Error('Scrivi cosa cambiare (al massimo 2000 caratteri).');
    if (decision !== 'approve' && decision !== 'change') throw new Error('Scelta non valida.');
    const store = this.coordination;
    const key = this.planRequestKey(r, plan);
    // One-time migration for a proposed plan restored from pre-journal chats.json. Existing receipts are never rebound.
    if (!store.original(r.s.id, key.originalRequestId)) store.register({ key, kind: 'plan', at: plan.at, payload: plan });
    const accepted = store.resolve(key, byApp ? { kind: 'policy', policy: 'away-plan' } : { kind: 'user', channel: by }, { decision, text: change });
    const delivery = store.beginDelivery(accepted.id);
    // The phase is a chat mirror, not the decision journal. A crash here leaves an accepted, unconfirmed delivery.
    r.s.plan = { ...plan, phase: decision === 'approve' ? 'running' : 'revising', at: Math.max(Date.now(), plan.at + 1) };
    this.persist();
    this.updated(r);
    let settled = false;
    const finishDelivery = (state: 'delivered' | 'uncertain') => { if (!settled) { store.finishDelivery(delivery.id, state); settled = true; } };
    const tracked: SubmissionReceipt = {
      beforeSubmit: () => receipt?.beforeSubmit(),
      submitted: () => { finishDelivery('delivered'); receipt?.submitted(); },
      failed: error => { finishDelivery('uncertain'); receipt?.failed(error); },
    };
    await this.send(chatId, message ?? (decision === 'approve' ? PLAN_APPROVED : planChange(change)), undefined, false, undefined, false, { kind: byApp ? 'app' : 'user' }, tracked);
    if (by === 'phone') { this.addItem(r, sysItem('phoneDecided', { time: phoneTime(Date.now()), what: 'plan' }, 'info'), false); this.updated(r); }
    // the user's click on the run's plan: approved as proposed, or a change asked (standing.ts decisionSignals, ADR 0131)
    const run = r.s.run;
    if (run && run.endedAt === undefined) {
      const p = run.plan ?? { proposals: 1, changes: 0 };
      run.plan = decision === 'approve' ? { ...p, approvedAt: p.approvedAt ?? Date.now(), ...(byApp ? { byApp: true } : {}) } : { ...p, changes: p.changes + 1 };
      this.runSave();
    }
    log.info('chats', 'plan decided', { chat: chatId, data: { decision, ...(by === 'phone' ? { by } : {}) } });
  }

  /** The user typed in this chat himself (chat:send only, ADR 0083): so that nothing conflicts, the Orchestrator learns it
   *  as quiet news (orchestrator-wake.ts, its own listener) and, for a delegated chat, its parent gets the same note with
   *  its next message (and a line in its transcript now). The user's own words go, never the child's. */
  /** true = recorded and checkpointed (chats.json written); false = not a chat that keeps the user's events. */
  override userWrote(chatId: string, text: string): boolean {
    const r = this.chats.get(chatId);
    if (!r || r.s.isOrchestrator || r.s.quick) return false;
    const ledger = r.userTaskEvents ?? { events: [], latestSeq: 0, acknowledgedSeq: 0 };
    if (ledger.latestSeq === Number.MAX_SAFE_INTEGER) throw new Error('The user event ledger is invalid; the instruction cannot be recorded safely.');
    const at = Date.now(), seq = ledger.latestSeq + 1, eventId = crypto.randomUUID();
    const event = { seq, id: eventId, at, text, ...(r.s.run ? { taskId: r.s.run.taskId ?? r.s.run.runId, taskVersion: r.s.run.taskVersion ?? 1 } : {}) };
    r.userTaskEvents = { ...ledger, latestSeq: seq, events: [...ledger.events, event] };
    this.persist(true); this.updated(r);
    const parent = r.s.parentId ? this.chats.get(r.s.parentId) : undefined;
    const note: UserWroteNote = { eventId, seq, chatId, title: r.s.title, role: r.s.agent?.name ?? null, parentId: parent?.s.id ?? null, parentTitle: parent?.s.title ?? null, at, text };
    if (parent && !parent.s.closedAt) {
      const list = [...(this.notesFor.get(parent.s.id) ?? []), userNoteLine(note)];
      this.notesFor.set(parent.s.id, list);
      this.addItem(parent, sysItem('userWroteChild', { role: note.role ?? 'Chat', title: note.title }, 'info'), false);
      this.updated(parent);
    }
    for (const fn of this.userWroteListeners) { try { fn(note); } catch (e) { log.warn('chats', 'user note listener failed', { chat: chatId, cause: errText(e), hint: 'the Orchestrator may not learn of this message' }); } }
    return true;
  }
  /** orchestrator-wake.ts: told of every message the user typed in a work chat */
  onUserWrote(fn: (n: UserWroteNote) => void): void { this.userWroteListeners.push(fn); }
  /** A root chat's clean result (done, every criterion met, no question): a listener that returns true took it as quiet
   *  news for the Orchestrator (orchestrator-wake.ts cleanReport); else it goes as a message, as any other result. */
  onCleanReport(fn: (n: CleanReportNote) => boolean): void { this.cleanReportListeners.push(fn); }
  /** chats/phone-port.ts: told of every turn's end (fromPhone = a phone message started or joined it); returns the unsubscribe */
  onTurnEnded(fn: (info: TurnEndInfo) => void): () => void {
    this.turnEndListeners.push(fn);
    return () => { const i = this.turnEndListeners.indexOf(fn); if (i >= 0) this.turnEndListeners.splice(i, 1); };
  }
  /** the notes waiting for this chat's next message (tests, diagnostics) */
  notesWaiting(chatId: string): readonly string[] { return this.notesFor.get(chatId) ?? []; }

  /** An explicit assignment reuses the conversation, but creates a separately accountable task run. */
  async assignTask(chatId: string, prompt: string, options: TaskAssignmentOptions = {}): Promise<void> {
    const r = this.need(chatId);
    if (r.s.routineArchived) throw new Error('Archived routine chats are read-only.');
    if (!prompt.trim()) throw new Error('Task prompt is required.');
    if (options.expectedVersion !== undefined && options.expectedVersion !== (r.s.run?.taskVersion ?? 1)) throw new Error('Task version changed; refresh before assigning.');
    const source = options.source ?? { kind: 'user' as const };
    if (!ownerSource(source) && this.closedByUser(r)) throw new Error('The user closed this chat and cancelled its work: only the user can reopen it. Start a new chat for new work.');
    if (source.kind === 'chat') {
      if (source.chatId !== this.openOrchestrator()?.s.id && source.chatId !== r.s.parentId) throw new Error('Only the owning Orchestrator or parent can assign this chat.');
      if (source.chatId === r.s.parentId) {
        const parent = this.need(source.chatId);
        if (parent.s.closedAt || !parent.s.run || parent.s.run.endedAt !== undefined || parent.s.run.report?.via === 'agent_report') throw new Error('The parent assignment is over; its owner must explicitly continue it before it can assign children.');
      }
      // no handshake: the assign tools hand the unread user entries to the assigner (shared/user-events.ts); the child
      // already has them, so they are not repeated in its prompt. A cursor, when given, must still be a valid one.
      const events = this.userEvents(chatId);
      if (options.expectedEventSeq !== undefined && (!Number.isSafeInteger(options.expectedEventSeq) || options.expectedEventSeq < 0 || options.expectedEventSeq > events.latestSeq)) throw new Error(`Invalid user event cursor: the latest is ${events.latestSeq}.`);
    }
    if (options.planStep !== undefined) {
      const plan = r.s.parentId ? this.chats.get(r.s.parentId)?.s.plan : undefined;
      if (source.kind !== 'chat' || source.chatId !== r.s.parentId || !plan || !['running', 'done'].includes(plan.phase) || !Number.isSafeInteger(options.planStep) || !plan.steps[options.planStep]) throw new Error('Invalid or unapproved parent plan step.');
    }
    if (this.midTurn(r) || r.pending.size || r.s.queued || r.opening || r.releasing || r.switching || r.archiving || this.deliveries.has(chatId)) throw new Error('The chat is busy or has queued work; wait before assigning another task.');
    const freshBoundary = this.freshReady(r, Date.now());
    this.beginAssignment(r, prompt, options);
    if (freshBoundary) r.freshAssignmentRun = r.s.run?.runId;
    if (options.mode === 'new-task' && r.s.plan) prompt += `\n\n${strategyPrompt(r.s.plan)}`;
    if (options.planStep !== undefined && r.s.parentId) this.planDelegated(r.s.parentId, options.planStep, [chatId]);
    if (source.kind === 'chat' && r.userTaskEvents) { r.userTaskEvents.acknowledgedSeq = r.userTaskEvents.latestSeq; this.persist(true); this.updated(r); }
    const from = source.kind === 'chat' ? this.need(source.chatId).s.title : source.kind === 'app' ? 'App' : undefined;
    try { await this.send(chatId, prompt, undefined, false, from, false, source); }
    finally { r.freshAssignmentRun = undefined; }
  }

  protected beginAssignment(r: Rec, prompt: string, options: TaskAssignmentOptions): void {
    if (r.heldResult) { this.releaseResult(r); if (r.heldResult) throw new Error('The previous result awaits an Orchestrator; deliver it before assigning again.'); }
    const previous = r.s.run;
    if (!previous) throw new Error('Only role chats can receive tasks.');
    delete r.reportNudged; // a new assignment owes its own report (#152)
    const mode = options.mode ?? 'continue', at = Date.now();
    this.deliveryPolicy(options.deliveryPolicy, !!r.s.parentId);
    if (options.doneWhen && (options.doneWhen.length > 12 || options.doneWhen.some(x => typeof x !== 'string' || !x.trim() || x.length > 300))) throw new Error('Invalid task criteria.');
    const newPlan = mode === 'new-task' && r.s.plan ? askingPlan(at, options.intake && this.planIntake(options.intake)) : undefined;
    this.finishRun(previous, previous.report ? 'completed' : 'closed', at);
    const next = this.runs.start({ chatId: r.s.id, agentId: previous.agentId, version: previous.version,
      goal: prompt, startedBy: previous.startedBy, startedAt: at, costKnown: previous.costUsd !== null,
      requestOrigin: mode === 'new-task' ? (options.source?.kind === 'chat' ? 'agent' : options.source?.kind === 'app' ? 'app' : 'user') : previous.requestOrigin ?? 'app',
      tags: previous.tags ? { ...previous.tags, skills: [] } : undefined, tier: previous.tier, model: previous.model,
      ...(r.s.parentId && this.chats.get(r.s.parentId)?.s.run ? { parentRunId: this.chats.get(r.s.parentId)!.s.run!.runId } : {}),
      ...(mode === 'rework' ? { reworkOf: previous.runId } : {}) }, !this.deferWrites());
    const brainRoot = this.opts.brainRoot?.();
    if (brainRoot) next.scope = { brainRoot: path.resolve(brainRoot), projectRoot: path.resolve(r.s.cwd) };
    next.taskId = mode === 'new-task' ? next.runId : previous.taskId ?? previous.runId;
    next.taskVersion = (previous.taskVersion ?? 1) + 1;
    next.taskContract = { ...(previous.taskContract?.reportExpected ? { reportExpected: true } : {}), deliveryPolicy: this.deliveryPolicy(options.deliveryPolicy ?? previous.taskContract?.deliveryPolicy, !!r.s.parentId), goal: prompt, doneWhen: options.doneWhen ?? (mode === 'new-task' ? [] : previous.taskContract?.doneWhen ?? r.s.delegation?.doneWhen ?? []), ...(options.contractFields?.length ? { fields: options.contractFields } : {}) };
    if (mode === 'continue') next.continuedFrom = previous.runId;
    r.s.run = next;
    this.coordination.cancelOtherAssignments(r.s.id, next.runId);
    if (newPlan) {
      r.s.plan = newPlan;
      if (options.intake) delete this.need(options.intake.chatId).intakeKey;
    }
    r.s.work = { status: 'assigned', updatedAt: at };
    if (r.s.delegation) r.s.delegation = { ...r.s.delegation, goal: prompt, doneWhen: next.taskContract.doneWhen, at, result: undefined };
    delete r.rootReportAt; delete r.report; delete r.autoCompleted; delete r.runSeen;
    r.idleSince = at;
    if (r.s.state === 'running' && !r.handoffTurn) r.runningSince = at;
    this.runSave(); this.persist(true); this.updated(r);
  }

  /** Neutral follow-ups never count as corrections. Only an explicit correction does. */
  /** chat:send with voice (ADR 0152): `text`, the user's message about to be sent to this chat, was said aloud; null =
   *  that send is over (delivered or failed), nothing stays marked */
  spokenNext(chatId: string, text: string | null): void {
    const r = this.chats.get(chatId);
    if (r) r.voiceText = text ?? undefined;
  }

  resumedByUser(chatId: string, text?: string): void {
    const r = this.chats.get(chatId), run = r?.s.run;
    if (!r || !run || text === undefined) return;
    if (isCorrection(text) && r.s.run?.corrections) { r.s.run.corrections.tagged++; this.runSave(); this.persist(); }
  }

  /** Before a user message is sent (ADR 0197): the chat's title and the run whose agent had already reported (a reply in
   *  the run, or its agent_report), so a correction to it counts as «riapertura dopo il report»; null = no such chat. */
  correctionContext(chatId: string): { title: string; reportedRunId: string | null } | null {
    const r = this.chats.get(chatId);
    if (!r) return null;
    const run = r.s.run;
    return { title: r.s.title, reportedRunId: run?.report ? run.runId : null };
  }

  /** A correction reached a run after its agent reported (ADR 0197): its `corrections.afterReport` (AGENTS-DESIGN §5),
   *  never written before. Runs recorded before corrections were counted stay unknown. */
  correctedAfterReport(runId: string): void {
    const run = this.runs.get(runId);
    if (!run?.corrections) return;
    run.corrections.afterReport++;
    this.runSave(); this.persist();
  }

  /** The §5 metrics per agent and version (A6): runs kept plus the rollups of the pruned ones. */
  runMetrics(opts: { since?: number; skill?: string; app?: string; repo?: string } = {}): ReturnType<typeof runMetrics> {
    // Metrics read the current in-memory record; reading must not force a synchronous archive write.
    const runs = this.runs.list(), rollups = this.runs.rolledUp();
    const live = (run: AgentRun) => { const r = this.chats.get(run.chatId); return !!r && !r.s.closedAt && r.s.run?.runId === run.runId; };
    const metrics = runMetrics(runs, { rollups, live, ...(opts.since !== undefined ? { since: opts.since } : {}),
      filter: { ...(opts.skill !== undefined ? { skill: opts.skill } : {}), ...(opts.app !== undefined ? { app: opts.app } : {}), ...(opts.repo !== undefined ? { repo: opts.repo } : {}) } });
    // the card's level and performance are the agent's whole record, whatever the filter
    const standing = standings(runs, rollups, Date.now(), this.runs.flashLog(), this.opts.priceOf ?? null);
    return withStandings(metrics, standing);
  }

  /** The user's verdict on an agent run (thumbs up / down / partly; the UI's only, never an agent tool): basis human;
   *  an open run ends as completed, an ended one keeps how it ended. */
  markRun(chatId: string, verdict: AgentRunOutcome['verdict'], note?: string): ChatSummary {
    const r = this.need(chatId);
    if (r.s.routineArchived) throw new Error('Archived routine chats are read-only.');
    const run = r.s.run;
    if (!run) throw new Error('Questa chat non è un’esecuzione di un Agente.');
    if (!['success', 'partial', 'fail', 'unknown'].includes(verdict)) throw new Error('Esito non valido.');
    const text = typeof note === 'string' ? note.trim().slice(0, 600) : '';
    run.outcome = { verdict, basis: 'human', at: Date.now(), by: 'user', ...(text ? { note: text } : {}) };
    this.finishRun(run, 'completed');
    this.runSave(); this.persist(); this.updated(r);
    this.hook('agent lifecycle', () => this.opts.onRunOutcome?.(structuredClone(run)));
    return { ...r.s };
  }
}
