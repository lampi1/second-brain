// ChatManager layer (ADR 0200): delegation and reports (ADR 0083, 0084). A child's agent_report to its parent (results
// grouped with its siblings'), a root chat's report to the Orchestrator (held until its turn ends, #123), result
// synthesis, the turn end that records the job and settles the final report (assignment completed), delegation limits.
import crypto from 'node:crypto';
import { isWorkRole, ROLE_DEFAULTS } from '../../shared/roles';
import type { ChatItem, ChatSummary } from '../../shared/contract';
import { errText, log } from '../log';
import { cut } from './session';
import type { HeldChildResult } from './store';
import { waitsForPeople, waitsForWork } from '../../shared/waiting';
import type { TaskDeliveryPolicy } from '../../shared/agents';
import { reportOf } from '../agents/run-report';
import { RESULT_OUTPUT_MAX, checkResult, resultMessage, type DelegationLimitHit, type DelegationResult, type TaskSource } from '../../shared/delegation';
import { finishPlan, afterReport } from '../../shared/strategy';
import { APP_EVENT_LABEL } from './orchestrator-wake';
import type { SubmissionReceipt, TurnEndInfo, Rec } from './manager-types';
import { clearTimeout, sameChildResult, uniqueChildResults, turnReply, lastAnswer, sysItem, ORCHESTRATOR_OUTPUT_MAX, CHILD_RESULTS_MS } from './manager-helpers';
import { ManagerContinuity } from './manager-continuity';

/** Delegation and reports: a child's agent_report to its parent, a root chat's to the Orchestrator, turn ends that settle them. */
export abstract class ManagerDelegation extends ManagerContinuity {

  /** Unknown or partial observations are not evidence that a provider has no work left behind. */
  protected override unsettledChildren(r: Rec): boolean {
    const children = r.s.agentChildren;
    return !children || children.coverage !== 'complete' || children.active === null || children.active > 0 || this.observedChildrenBusy(r);
  }
  protected override observedChildrenBusy(r: Rec): boolean {
    return (r.s.agentChildren?.children.some(child => ['running', 'waiting', 'unknown'].includes(child.state)) ?? false) || this.delegatedBusy(r.s.id);
  }
  /** A delegated child still owes this chat its result (open, no agent_report yet): the parent waits for it. */
  private delegatedBusy(parentId: string): boolean {
    for (const c of this.chats.values()) if (c.s.parentId === parentId && !c.s.closedAt && c.s.delegation && !c.s.delegation.result) return true;
    return false;
  }

  /** The chats this one delegated (agent_delegate), oldest first. */
  delegatedBy(parentId: string): ChatSummary[] {
    return this.list().filter(c => c.parentId === parentId);
  }

  /** A delegated chat's agent_report (agents/delegation.ts checked it): the result is kept on the chat and its run, its
   *  assignment completes at the end of this turn, and the parent gets it as a message at once (it reopens a closed
   *  parent). At most one per delegation. */
  reportDelegation(chatId: string, result: DelegationResult): { parentId: string; delivered: boolean } {
    const r = this.need(chatId), d = r.s.delegation, parentId = r.s.parentId;
    if (!d || !parentId) throw new Error('agent_report: only a delegated chat reports (agent_delegate started it); report to the Orchestrator with send_to_chat.');
    if (result.verdict !== undefined || result.verified !== undefined) throw new Error('Delegated reports cannot claim independent review fields.');
    this.checkReportVersion(r, result);
    if (r.s.plan && result.outcome !== 'blocked') r.s.plan = finishPlan(r.s.plan, Date.now());
    if (d.result) throw new Error('agent_report: this delegation already has its result: the first report was saved and nothing else is needed. Stop here.');
    const at = Date.now(), met = result.doneWhen.filter(x => x.met).length;
    // the user changed the child's goal in its chat: the card shows the user's goal, the contract's stays as originalGoal
    const goal = result.goalChangedByUser && result.newGoal ? { goal: result.newGoal, originalGoal: d.originalGoal ?? d.goal } : {};
    r.s.delegation = { ...d, ...goal, result: { outcome: result.outcome, summary: result.summary, at, doneWhen: result.doneWhen.map(x => ({ criterion: x.criterion, met: x.met })) } };
    const run = r.s.run;
    if (run) {
      run.delivery = { policy: 'synthesize', reportedAt: at, attempts: 0 };
      run.report = { at, outcome: result.outcome, verified: met === result.doneWhen.length ? 'yes' : met ? 'partial' : 'no', summary: cut(result.summary, 140), via: 'agent_report', canonical: { ...structuredClone(result), at, taskId: run.taskId ?? run.runId, runId: run.runId, taskVersion: run.taskVersion ?? 1 } };
      this.runSave();
    }
    r.report = { text: result.summary, at, ...(result.outcome === 'blocked' ? { blocked: true } : {}) };
    // the deliverable is written only in the report now: its summary is the chat's last line (strip, digest, notices)
    r.s.lastText = cut(result.summary, 300);
    this.persist();
    this.updated(r);
    const parent = this.chats.get(parentId);
    // the parent Strategist's step for this child: done once every chat of the step reported done (ADR 0108)
    if (parent?.s.plan && (!run?.parentRunId || run.parentRunId === parent.s.run?.runId)) {
      // a sibling gone without a result (closed by the user) counts as not done: the step shows blocked, never stuck
      const next = afterReport(parent.s.plan, chatId, id => { const c = this.chats.get(id); return c ? (!c.s.run?.parentRunId || c.s.run.parentRunId === parent.s.run?.runId ? c.s.delegation?.result?.outcome : undefined) : 'blocked'; }, at);
      if (next !== parent.s.plan) { parent.s.plan = next; this.persist(); }
    }
    if (parent) {
      this.updated(parent); // its waiting on this child may be over
      this.queueChildResult(parentId, r.s.title, `[task ${run?.runId ?? chatId}]\n${resultMessage(d.role, r.s.title, result)}`, run?.runId);
    }
    log.info('chats', 'delegation reported', { chat: chatId, data: { parent: parentId, outcome: result.outcome, met, criteria: result.doneWhen.length } });
    return { parentId, delivered: !!parent };
  }

  /** agent_ask_parent (agents/delegation.ts): the child waits for its parent's answer, not on its report (#152). */
  askedParent(chatId: string): void {
    const r = this.chats.get(chatId);
    if (r) r.askedParentAt = Date.now();
  }

  /** A delegated child that owes its result and has nothing left that would bring it (#152): its turn ended clean and
   *  idle, with no question, permission, own child, background task or parent's answer pending, and its last answer
   *  does not wait for a person. The first time it is told, once, to call agent_report (with the full tool name, #144);
   *  the second time, or when its engine died with an error, the app closes the delegation itself: a result "blocked",
   *  noReport, its last answer as output, every criterion not met, delivered to the parent like a report, so the
   *  parent wakes and the tree's counters agree. */
  protected owedReport(r: Rec, why: 'idle' | 'exit'): void {
    const d = r.s.delegation;
    if (!d || !r.s.parentId || d.result || r.s.closedAt || this.quitting || r.archiving || this.chats.get(r.s.id) !== r) return;
    // whatever ended the turn, a child still waiting on its parent's answer, its own children or a request owes nothing yet
    if (r.pending.size > 0 || r.askedParentAt !== undefined || this.delegatedBusy(r.s.id) || (r.s.agentChildren?.active ?? 0) > 0) return;
    if (why === 'idle') {
      const last = r.s.lastResult;
      if (!last || last.isError || last.interrupted || r.session?.busy || r.working || r.pending.size > 0 || r.s.queued || r.handoffTurn || r.deliveryHolds) return;
      if ((r.s.background ?? 0) > 0 || r.s.waitsOn || r.s.waitsOnWork || r.askedParentAt !== undefined || this.delegatedBusy(r.s.id) || (r.s.agentChildren?.active ?? 0) > 0) return;
      if (r.s.plan?.phase === 'proposed' || r.s.plan?.phase === 'asking' || r.s.plan?.phase === 'revising') return;
      if (!r.reportNudged) {
        r.reportNudged = true;
        log.info('chats', 'delegated chat ended its turn without agent_report: told once', { chat: r.s.id, data: { parent: r.s.parentId } });
        const text = `${APP_EVENT_LABEL}\nIl tuo turno è finito senza agent_report e il tuo genitore aspetta il risultato. Chiamalo ora una volta: agent_report del server MCP second-brain (in Claude Code mcp__second-brain__agent_report; se è differito, caricalo prima con ToolSearch), con outcome done, partial o blocked e doneWhen per ogni criterio. Se stai aspettando una persona, chiedilo con il pannello delle domande.`;
        void this.send(r.s.id, text, undefined, false, 'second-brain', false, { kind: 'app' }).catch(e => {
          log.warn('chats', 'report reminder not delivered', { chat: r.s.id, cause: errText(e), hint: 'the delegation is closed without a report instead' });
          this.closeWithoutReport(r, 'idle');
        });
        return;
      }
    }
    this.closeWithoutReport(r, why);
  }

  private closeWithoutReport(r: Rec, why: 'idle' | 'exit'): void {
    const d = r.s.delegation, run = r.s.run;
    if (!d || !r.s.parentId || d.result || r.s.closedAt) return;
    const criteria = run?.taskContract?.doneWhen ?? d.doneWhen, answer = lastAnswer(r.items).trim();
    const result: DelegationResult = {
      outcome: 'blocked', summary: why === 'exit' ? 'Finita con un errore del motore, senza agent_report.' : 'Finita senza agent_report: il risultato è il suo ultimo messaggio.',
      output: answer ? answer.slice(0, RESULT_OUTPUT_MAX) : '(nessun testo)', doneWhen: criteria.map(criterion => ({ criterion, met: false, evidence: 'non riportato: la chat è finita senza agent_report' })),
      ...((run?.taskVersion ?? 1) > 1 ? { taskVersion: run!.taskVersion! } : {}),
    };
    try { this.reportDelegation(r.s.id, result); }
    catch (e) { log.warn('chats', 'delegation not closed without report', { chat: r.s.id, cause: errText(e), hint: 'the parent sees the child as stopped; close it by hand' }); return; }
    r.s.delegation = { ...r.s.delegation!, result: { ...r.s.delegation!.result!, noReport: true } };
    this.endRunOf(r, 'closed');
    this.persist();
    this.updated(r);
    log.warn('chats', 'delegated chat ended without agent_report', { chat: r.s.id, cause: why === 'exit' ? 'its engine stopped with an error' : 'two turns ended without agent_report', hint: 'its last answer went to the parent as a blocked result', data: { parent: r.s.parentId } });
  }

  /** A child's result for its parent: while siblings still owe theirs, it waits (at most CHILD_RESULTS_MS) so the parent
   *  reads the batch in one turn instead of one turn per child, each re-reading its whole context. */
  private queueChildResult(parentId: string, title: string, message: string, runId?: string): void {
    if (this.chats.get(parentId)?.s.routineArchived) return;
    const q = this.childResults.get(parentId) ?? { items: [], timer: null };
    if (q.items.some(item => item.title === title && item.message === message)) return;
    const item: HeldChildResult = { id: runId ? `result-${runId}` : crypto.randomUUID(), ...(runId ? { runId } : {}), title, message };
    q.items.push(item);
    const parent = this.chats.get(parentId);
    if (parent) {
      const held = parent.heldResults ?? [];
      if (!held.some(item => item.title === title && item.message === message)) held.push(item);
      parent.heldResults = held; this.persist(true);
    }
    this.childResults.set(parentId, q);
    if (!this.delegatedBusy(parentId)) { this.flushChildResults(parentId); return; }
    if (!q.timer) { q.timer = setTimeout(() => this.flushChildResults(parentId), this.opts.childResultsMs ?? CHILD_RESULTS_MS); q.timer.unref?.(); }
  }

  protected flushChildResults(parentId: string): void {
    const q = this.childResults.get(parentId);
    if (!q) return;
    this.childResults.delete(parentId);
    if (q.timer) clearTimeout(q.timer);
    const parent = this.chats.get(parentId);
    if (!parent || parent.s.routineArchived || !q.items.length) return;
    parent.heldResults = uniqueChildResults([...(parent.heldResults ?? []), ...q.items]);
    // A restored queue may alias heldResults. Freeze this batch before asynchronous engine startup;
    // later reports must never join its acknowledgment without joining its submitted message body.
    const batch: readonly HeldChildResult[] = uniqueChildResults(q.items).map(item => {
      const held = parent.heldResults!.find(other => sameChildResult(item, other))!;
      held.id ??= crypto.randomUUID();
      return Object.freeze({ ...held });
    });
    const from = [...new Set(batch.map(x => x.title))].join(', ');
    this.persist(true);
    const batchId = crypto.randomUUID();
    let acknowledged = false, retrying = false;
    const failed = (e: unknown) => {
      if (acknowledged || retrying) return;
      retrying = true;
      const parent = this.chats.get(parentId);
      if (parent && !parent.s.routineArchived && !this.quitting) {
        const retry = this.childResults.get(parentId) ?? { items: [], timer: null };
        for (const item of batch) if (!retry.items.some(x => x.id === item.id)) retry.items.push(item);
        if (!retry.timer) { retry.timer = setTimeout(() => this.flushChildResults(parentId), this.opts.childResultsMs ?? CHILD_RESULTS_MS); retry.timer.unref?.(); }
        this.childResults.set(parentId, retry);
      }
      log.warn('chats', 'delegation result not delivered', { chat: parentId, cause: errText(e), hint: 'the durable outbox retries delivery' });
    };
    const receipt: SubmissionReceipt = {
      beforeSubmit: () => {
        for (const item of batch) { const run = item.runId ? this.runs.get(item.runId) : undefined; if (run?.delivery) run.delivery.attempts++; }
        this.runSave();
      },
      submitted: () => {
        acknowledged = true;
        const at = Date.now();
        for (const item of batch) { const run = item.runId ? this.runs.get(item.runId) : undefined; if (run?.delivery) Object.assign(run.delivery, { deliveredAt: at, synthesisSubmittedAt: at, synthesisBatchId: batchId }); }
        this.runSave();
        const parent = this.chats.get(parentId);
        if (parent) { parent.heldResults = parent.heldResults?.filter(item => !batch.some(sent => sent.id === item.id)); this.persist(true); }
      },
      failed,
    };
    void this.send(parentId, batch.map(x => x.message).join('\n\n'), undefined, false, from, false, { kind: 'app' }, receipt).catch(failed);
  }

  /** agent_report from a root role chat the Orchestrator opened (app_create_chat, issue #93): its result is kept on its run
   *  like a delegated chat's and reaches the open Orchestrator as a message (its own chats report to it, ADR 0083 §6);
   *  the turn's end then settles the assignment as a mailed report does. At most one per assignment. */
  reportRoot(chatId: string, result: DelegationResult): { orchestratorId: string | null; delivered: boolean } {
    const r = this.need(chatId), run = r.s.run;
    if (r.s.isOrchestrator || r.s.parentId || r.s.delegation || !run || !(['orchestrator', 'user'].includes(run.startedBy) || run.startedBy === 'app' && run.taskContract?.reportExpected)) throw new Error('agent_report: only a role task with an explicit report contract may report.');
    const review = run.startedBy === 'app' && !!run.reviewOf && ['sentinel', 'judge'].includes(run.agentId);
    if ((result.verdict !== undefined || result.verified !== undefined) && !review) throw new Error('Review fields require an app-owned independent reviewer run.');
    if (review && (!['success', 'partial', 'fail'].includes(result.verdict ?? '') || !['yes', 'partial', 'no'].includes(result.verified ?? ''))) throw new Error('Independent reviews require explicit verdict and verified fields.');
    if (review && (run.endedAt !== undefined || r.s.closedAt)) throw new Error('The review assignment has already ended.');
    this.checkReportVersion(r, result);
    if (r.s.plan && result.outcome !== 'blocked') r.s.plan = finishPlan(r.s.plan, Date.now());
    if (run.report?.via === 'agent_report' || r.rootReportAt !== undefined && r.rootReportAt >= (r.s.work?.updatedAt ?? 0)) throw new Error('agent_report: this assignment already has its result: the first report was saved and nothing else is needed. Stop here.');
    const at = Date.now(), met = result.doneWhen.filter(x => x.met).length;
    {
      const policy = run.startedBy === 'orchestrator' ? this.deliveryPolicy(run.taskContract?.deliveryPolicy) : 'display';
      run.delivery = { policy, reportedAt: at, attempts: 0, ...(policy === 'synthesize' ? { synthesisRequestedAt: at, synthesisPending: true } : {}) };
      run.report = { at, outcome: result.outcome, verified: review ? result.verified! : !result.doneWhen.length ? 'no' : met === result.doneWhen.length ? 'yes' : met ? 'partial' : 'no', ...(review ? { verdict: result.verdict! } : {}), summary: cut(result.summary, 140), via: 'agent_report', canonical: { ...structuredClone(result), at, taskId: run.taskId ?? run.runId, runId: run.runId, taskVersion: run.taskVersion ?? 1 } };
      this.runSave();
    }
    r.report = { text: result.summary, at, ...(result.outcome === 'blocked' ? { blocked: true } : {}) };
    // the deliverable is written only in the report now: its summary is the chat's last line (strip, digest, notices)
    r.s.lastText = cut(result.summary, 300);
    r.rootReportAt = at;
    this.persist();
    this.updated(r);

    const orchestrator = this.openOrchestrator();
    const role = r.s.agent?.id;
    // a clean result (done, every criterion met, no question) is quiet news: the user reads it in the chat, the
    // Orchestrator gets it with its next turn instead of a turn of its own (median ~0.18 $ each, zero-token-audit round 3).
    // When the user waits for it (he asked the Orchestrator, which opened this chat for him), the app also says so in the
    // Orchestrator's chat, with the summary and Apri: a notice, never a turn (#123, the owner 2026-10-21: «mi basta la
    // notifica nella chat dell'orchestrator, non aggiungere un passaggio»)
    if (orchestrator && run.startedBy === 'orchestrator') this.updated(orchestrator);
    const local = run.startedBy !== 'orchestrator';
    if (!r.s.work) r.s.work = { status: 'assigned', updatedAt: run.startedAt };
    const waits = !!r.userWaits;
    if (isWorkRole(role)) {
      // held until the chat's turn ends (#123): the report and the turn end are one news, and neither the Orchestrator nor
      // the notice says it while the chat still shows as running
      r.heldResult = { ...(local ? { local: true } : {}), note: { chatId, title: r.s.title, role: ROLE_DEFAULTS[role].name, summary: result.summary, at }, quiet: run.delivery?.policy === 'notify', userWaits: waits,
        message: resultMessage(role, r.s.title, result, { outputMax: ORCHESTRATOR_OUTPUT_MAX }) };
      this.persist(true);
      if (!this.midTurn(r)) this.releaseResult(r);
    }
    log.info('chats', 'root chat reported', { chat: chatId, data: { orchestrator: orchestrator?.s.id ?? null, outcome: result.outcome, met, criteria: result.doneWhen.length, userWaits: waits } });
    return { orchestratorId: local ? null : orchestrator?.s.id ?? null, delivered: local || !!orchestrator };
  }

  /** Explicit user/Orchestrator request; child output remains private to its parent. Admission never acknowledges it. */
  async synthesizeResult(runId: string, source: TaskSource): Promise<void> {
    const orchestrator = this.openOrchestrator(), run = this.runs.get(runId), result = run?.report?.canonical;
    if (!orchestrator) throw new Error('Open an Orchestrator before requesting synthesis.');
    if (source.kind !== 'user' && !(source.kind === 'chat' && source.chatId === orchestrator.s.id)) throw new Error('Only the user or current Orchestrator may request root synthesis.');
    if (!run || !result || !(run.startedBy === 'orchestrator' || run.startedBy === 'user' && source.kind === 'user') || run.parentRunId || this.chats.get(run.chatId)?.s.parentId) throw new Error('Only a root task result is available for synthesis.');
    if (run.delivery?.synthesisSubmittedAt || this.synthesizing.has(runId)) return;
    const worker = this.chats.get(run.chatId);
    if (worker?.s.run?.runId === runId && (worker.working || this.midTurn(worker))) throw new Error('The worker is still finishing this result.');
    const role = run.agentId;
    if (!isWorkRole(role)) throw new Error('Unknown root task role.');
    const timer = this.synthesisRetry.get(runId);
    if (timer) clearTimeout(timer);
    this.synthesisRetry.delete(runId);
    const delivery = run.delivery ?? { policy: 'synthesize' as const, reportedAt: result.at, attempts: 0 };
    run.delivery = delivery;
    delivery.policy = 'synthesize'; delivery.synthesisRequestedAt ??= Date.now(); delivery.synthesisPending = true;
    this.synthesizing.add(runId); this.runSave(); this.persist(true); this.updated(orchestrator); if (worker) this.updated(worker);
    let submitted = false, failedOnce = false;
    const failed = (error: unknown) => {
      if (submitted || failedOnce) return; failedOnce = true;
      this.synthesizing.delete(runId);
      this.updated(orchestrator);
      if (!this.quitting && !this.synthesisRetry.has(runId)) {
        const retry = setTimeout(() => {
          this.synthesisRetry.delete(runId);
          const current = this.openOrchestrator();
          if (current) void this.synthesizeResult(runId, run.startedBy === 'user' ? { kind: 'user' } : { kind: 'chat', chatId: current.s.id }).catch(e => log.warn('chats', 'synthesis retry deferred', { cause: errText(e), hint: 'the request remains pending' }));
        }, Math.min(30_000, 1000 * Math.max(1, delivery.attempts)));
        retry.unref?.(); this.synthesisRetry.set(runId, retry);
      }
      log.warn('chats', 'root synthesis not submitted', { chat: orchestrator.s.id, cause: errText(error), hint: 'the persisted request retries; its full result remains visible' });
    };
    const receipt: SubmissionReceipt = {
      beforeSubmit: () => { delivery.attempts++; this.runSave(); },
      submitted: () => {
        submitted = true; this.synthesizing.delete(runId);
        Object.assign(delivery, { synthesisPending: false, synthesisSubmittedAt: Date.now(), synthesisBatchId: `root-${runId}`, deliveredAt: Date.now() });
        this.runSave(); this.persist(true); this.updated(orchestrator); if (worker) this.updated(worker);
      },
      failed,
    };
    const message = `[richiesta esplicita di sintesi · task ${result.taskId}, versione ${result.taskVersion}, run ${runId}]\nSintetizza il risultato per l'utente usando il risultato completo e le prove qui sotto.\n${resultMessage(role, worker?.s.title ?? run.goal, result)}`;
    try { await this.send(orchestrator.s.id, message, undefined, false, worker?.s.title ?? run.agentId, false, { kind: 'app' }, receipt); }
    catch (error) { failed(error); throw error; }
  }

  protected resumeRootSyntheses(): void {
    const orchestrator = this.openOrchestrator();
    if (!orchestrator) return;
    for (const run of this.runs.list()) {
      if (run.delivery?.policy !== 'synthesize' || run.delivery.synthesisSubmittedAt || !(run.startedBy === 'orchestrator' || run.startedBy === 'user' && run.delivery.synthesisRequestedAt !== undefined) || run.parentRunId) continue;
      const worker = this.chats.get(run.chatId);
      if (worker?.s.routineArchived || worker?.s.parentId || worker?.s.run?.runId === run.runId && (worker.working || this.midTurn(worker))) continue;
      void this.synthesizeResult(run.runId, run.startedBy === 'user' ? { kind: 'user' } : { kind: 'chat', chatId: orchestrator.s.id }).catch(e => log.warn('chats', 'synthesis delivery deferred', { cause: errText(e), hint: 'the persisted result stays available' }));
    }
  }

  protected deliveryPolicy(value: TaskDeliveryPolicy | undefined, child = false): TaskDeliveryPolicy {
    if (value !== undefined && !['display', 'notify', 'synthesize'].includes(value)) throw new Error('Unknown task delivery policy.');
    return value ?? (child ? 'synthesize' : 'display');
  }

  private checkReportVersion(r: Rec, result: DelegationResult): void {
    // Pre-versioning runs acquire identity before canonical serialization; readRun checks the pair strictly.
    if (r.s.run) { r.s.run.taskId ??= r.s.run.runId; r.s.run.taskVersion ??= 1; }
    const version = r.s.run?.taskVersion ?? 1;
    if ((version > 1 || result.taskVersion !== undefined) && result.taskVersion !== version) throw new Error(`agent_report: stale or missing taskVersion; current taskVersion is ${version}.`);
    if (r.s.run?.taskContract) checkResult(result, r.s.run.taskContract.doneWhen);
  }

  /** App notices are rebuilt from every retained root run, never from a delegated/private result. The Orchestrator gets
   *  only the ones not shown yet: one already shown (delivery.displayedAt) never comes back after a restart or in a new
   *  Orchestrator (owner, 2026-10-24: «ogni volta che riavvio l'app mi trovo tutte le box degli agenti»). A local result
   *  stays in its own chat. */
  protected restoreRootNotices(): void {
    const orchestrator = this.openOrchestrator(), changed = new Set<Rec>();
    for (const run of this.runs.list().slice().sort((a, b) => a.startedAt - b.startedAt)) {
      const result = run.report?.canonical, worker = this.chats.get(run.chatId);
      if (worker?.s.routineArchived || !result || run.parentRunId || worker?.s.parentId || worker?.s.isOrchestrator) continue;
      const local = run.startedBy === 'user' || run.startedBy === 'app' && run.taskContract?.reportExpected;
      const target = run.startedBy === 'orchestrator' ? orchestrator : local ? worker : undefined;
      if (!target || worker?.s.run?.runId === run.runId && (worker.working || this.midTurn(worker))) continue;
      if (target === orchestrator && run.delivery?.displayedAt !== undefined) continue;
      const id = `result-${result.runId}-${result.at}`;
      if (target.items.some(item => item.id === id)) continue;
      const title = worker?.s.title ?? run.goal, role = worker?.s.agent?.name ?? run.agentId;
      const notice = { ...sysItem('resultReady', { role, title, summary: result.summary, chatId: run.chatId }, 'info'), id, result };
      this.addItem(target, notice, false); changed.add(target);
      if (run.delivery) { run.delivery.displayedAt ??= Date.now(); run.delivery.deliveredAt ??= run.delivery.displayedAt; }
    }
    this.runSave();
    for (const target of changed) this.updated(target);
  }

  /** The open Orchestrator, if any. */
  protected override openOrchestrator(): Rec | undefined { return [...this.chats.values()].find(c => c.s.isOrchestrator && !c.s.closedAt); }

  /** The open Orchestrator is answering the user's own message now (its turn started from it, and it is in that turn). */
  protected orchestratorAnswering(): boolean { const o = this.openOrchestrator(); return !!o?.turnFromUser && this.midTurn(o); }

  /** A root chat's held result goes now (its turn ended, or it stopped): quiet news (orchestrator-wake.ts cleanReport) when
   *  clean, else a message that wakes the Orchestrator; once. A clean one the user waits for also leaves the app's notice in
   *  the Orchestrator's chat (sys resultReady: the summary and the chat to open; no turn, no token). */
  protected releaseResult(r: Rec): void {
    if (r.s.routineArchived) return;
    const held = r.heldResult;
    if (!held) return;
    const orchestrator = held.local ? r : this.openOrchestrator();
    if (!orchestrator) return; // durable outbox retries when an Orchestrator is available
    const canonical = r.s.run?.report?.canonical;
    const id = `result-${canonical?.runId ?? r.s.id}-${held.note.at}`;
    if (!orchestrator.items.some(item => item.id === id)) {
      const notice = { ...sysItem('resultReady', { role: held.note.role, title: held.note.title, summary: held.note.summary, chatId: r.s.id }, 'info'), id, ...(canonical ? { result: canonical } : {}) };
      this.addItem(orchestrator, notice, false);
      this.updated(orchestrator);
    }
    if (r.s.run?.delivery) { r.s.run.delivery.displayedAt ??= Date.now(); r.s.run.delivery.deliveredAt ??= r.s.run.delivery.displayedAt; this.runSave(); }
    // Display is unconditional and token-free. Event preferences only control the optional quiet digest.
    if (!held.local && held.quiet) this.cleanReportListeners.some(fn => { try { return fn(held.note); } catch { return false; } });
    delete r.heldResult; delete r.userWaits;
    this.persist(true); this.updated(orchestrator);
    if (!held.local && r.s.run?.delivery?.policy === 'synthesize') this.resumeRootSyntheses();
  }

  /** agent_delegate refused by a delegation limit: the parent's transcript says so and the chat carries the mark. */
  limitNotice(chatId: string, kind: DelegationLimitHit['kind'], limit: number): void {
    const r = this.chats.get(chatId);
    if (!r) return;
    r.s.limitHit = { kind, limit, at: Date.now() };
    this.addItem(r, sysItem(kind === 'depth' ? 'delegationDepth' : 'delegationParallel', { limit }, 'warn'), false);
    this.updated(r);
  }

  /** A chat sent mail (send_to_chat): to the Orchestrator it is its report (#86, ADR 0084), read at its turn's end. */
  noteMail(chatId: string, toChatId: string | null, text: string): void {
    const r = this.chats.get(chatId), to = toChatId ? this.chats.get(toChatId) : undefined;
    if (!r || !to || r.s.isOrchestrator || !to.s.isOrchestrator) return;
    r.report = { text, at: Date.now() };
    // mailed while idle (a tool call never runs outside a turn, but a late hook might): settle it now
    if (r.s.state === 'idle' && !r.session?.busy && r.s.lastResult) { this.settleReport(r); this.updated(r); }
  }

  /** At a clean turn end: who its last answer and report say it waits for (waitsOn) and, for an assigned worker that
   *  reported and waits for nobody, its assignment completed and its agent run ended "completed" (#86, ADR 0084). The
   *  auto-close then closes it after the delay (closedBy "auto"); a question, permission or background task holds it. */
  private settleReport(r: Rec, item?: Extract<ChatItem, { kind: 'result' }>): void {
    const answer = lastAnswer(r.items), report = r.report;
    const fresh = report && (report.at >= (r.s.work?.updatedAt ?? 0));
    const who = waitsForPeople(answer) ?? (fresh ? waitsForPeople(report.text) : null);
    if (who) r.s.waitsOn = who; else delete r.s.waitsOn;
    if (fresh && !r.s.waitsOnWork && waitsForWork(report.text)) r.s.waitsOnWork = true;
    const clean = item ? !item.isError && !item.interrupted : !!r.s.lastResult && !r.s.lastResult.isError && !r.s.lastResult.interrupted;
    if (!fresh || !clean || report.blocked || who || r.s.waitsOnWork || r.s.work?.status !== 'assigned' || r.pending.size > 0 || (r.s.background ?? 0) > 0) return;
    r.s.work = { status: 'completed', updatedAt: Date.now() };
    r.autoCompleted = true;
    this.autoActivity(r);
    this.endRunOf(r, 'completed');
    try { this.persist(true); } catch (e) { log.warn('chats', 'completed assignment not saved', { chat: r.s.id, cause: errText(e), hint: 'it is saved with the next change' }); }
    log.info('chats', 'assignment completed by its final report', { chat: r.s.id });
  }

  /** A result arrived: the job ledger gets the turn; the plan windows are refreshed now and then. */
  protected turnEnded(r: Rec, item: Extract<ChatItem, { kind: 'result' }>): void {
    const handoffTurn = r.handoffTurn;
    const accounting = r.turnAccounting ??= { seen: new Set(), pending: [] };
    if (!accounting.seen.has(item.id)) {
      accounting.seen.add(item.id);
      accounting.pending.push(handoffTurn ? null : r.s.run ?? null);
    }
    if (handoffTurn) {
      // stopped or failed (max tokens, cancelled): a cut answer is not a hand-off; the app writes its own note
      // a hand-off cut by a network error is given up too: Cursor's automatic "continua" would write it as a job turn
      const cut = item.isError || !!item.interrupted;
      if (cut) { r.handoffStopped = true; r.session?.noRetry?.(); }
      handoffTurn.done(cut ? null : [...handoffTurn.texts.values()].join('\n\n'));
      return; // not a turn of the job: no ledger entry
    }
    r.turnSinceDone = true; r.lastTurnAt = item.at;
    r.ctxSince ??= item.at;
    this.recordTurnEnd(r);
    r.s.lastResult = { at: item.at, isError: item.isError, ...(item.interrupted ? { interrupted: true } : {}) };
    r.unfinished = false;
    // "Aspetto la QA…": its work still runs, whatever the engine counts (shared/waiting.ts, the chats of 2026-10-16)
    if (waitsForWork(lastAnswer(r.items))) r.s.waitsOnWork = true; else delete r.s.waitsOnWork;
    // the agent's run-report, if this turn ends with one (the latest wins; a turn without one keeps the last); a run
    // ended during this turn (its Orchestrator marked it completed) still takes it
    const run = r.s.run, turnAt = r.turnAt;
    this.receiptTurn(r, turnAt, item.at);
    // still running after the result: a queued turn follows at once (no state change starts it), and it starts now
    if (r.s.state === 'running') r.turnAt = item.at; else delete r.turnAt;
    const reply = turnReply(r.items), runReport = reportOf(reply, item.at);
    if (run && (run.endedAt === undefined || (turnAt !== undefined && run.endedAt >= turnAt))) {
      if (runReport && run.report?.via !== 'agent_report') { run.report = runReport; this.runSave(); }
    }
    // a run-report block is a final report too (the Orchestrator reads it with the turn's end): "blocked" waits on it
    if (runReport) r.report = { text: runReport.summary, at: item.at, ...(runReport.outcome === 'blocked' ? { blocked: true } : {}) };
    this.settleReport(r, item);
    const first = r.firstPrompt;
    r.firstPrompt = null;
    const on = this.opts.onTurnEnd;
    if (on) {
      const info: TurnEndInfo = {
        chatId: r.s.id, sessionId: r.s.sessionId, harness: r.s.harness, model: r.s.model, effort: r.s.effort,
        ...(first ? { firstPrompt: first } : {}),
        costUsd: item.costUsd, durationMs: item.durationMs, turns: item.turns, isError: item.isError,
        reply: turnReply(r.items),
      };
      this.hook('onTurnEnd', () => on(info));
    }
    this.askUsage(r);
  }

  // ---- implemented in a later layer (ADR 0200: manager.ts and its manager-*.ts layers)
  abstract send(chatId: string, text: string, images?: unknown, resumed?: boolean, from?: string, liveOnly?: boolean, source?: TaskSource, receipt?: SubmissionReceipt): Promise<void>;
  abstract list(): ChatSummary[];
  protected abstract autoActivity(r: Rec): void;
}
