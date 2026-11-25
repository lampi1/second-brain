// ChatManager layer (ADR 0200): the work. Assignments (assignTask), the user's messages in a work chat (userWrote:
// notes for the Orchestrator and the parent, user events), corrections after a report, the user's verdict on a run and
// the run metrics, the Strategist's plan (ADR 0108: propose, update, approve or change).
import crypto from 'node:crypto';
import path from 'node:path';
import type { ChatSummary, CreditWait, Effort, Harness } from '../../shared/contract';
import { CreditMoveRefused, type MoveNote } from '../agents/credit-wait';
import { clock } from '../../shared/credit-rule';

/** «22:40» in the PC's time zone, for the lines the chat shows. */
const clockLine = (at: number): string => clock(at, Date.now());
import { errText, log } from '../log';
import { ToolRefusal } from '../mcp/refusal';
import type { UserTaskEvents, AgentRun, AgentRunOutcome } from '../../shared/agents';
import { goalText } from '../../shared/agent-label';
import { ownerSource, type TaskAssignmentOptions } from '../../shared/delegation';
import { PLAN_APPROVED, PLAN_PUT_AWAY, PLAN_REPLAN, PLAN_REPROPOSE, PLAN_RESUMED, planChange, askingPlan, strategyPrompt, withAdded, withDelegated, withoutDropped, withStep, type PlanStep, type StepState, type StrategyPlan } from '../../shared/strategy';
import { approvalGate, type DoubtEvidence, type PlanDoubt } from '../../shared/plan-doubts';
import { runMetrics } from '../agents/run-metrics';
import { standings, withStandings, type TokenPrice } from '../agents/standing';
import { isCorrection } from '../../shared/correction';
import type { ChatManagerOptions, SubmissionReceipt, Rec, CleanReportNote, UserWroteNote, TurnEndInfo } from './manager-types';
import { sysItem, userNoteLine } from './manager-helpers';
import { phoneTime } from './phone-reply';
import { ManagerLifecycle } from './manager-lifecycle';
import { APP_EVENT_LABEL } from './orchestrator-wake';
import { engineOf } from '../engines/registry';
import { sameFolder } from '../agents/worktrees';
import { applySteps, type StepOp } from '../../shared/plan-edit';
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
      // what is asked for, not how far it got: the started steps of a revision go on while the user decides (ADR 0342)
      proposalHash: proposalHash({ steps: plan.steps.map(({ proof: _p, chatIds: _c, startedAt: _s, endedAt: _e, ...s }) => ({ ...s, state: 'todo' })), clarified: plan.clarified, doneWhen: plan.doneWhen, pcOnly: plan.pcOnly, ...(plan.doubts ? { doubts: plan.doubts } : {}) }) };
  }

  /** A plan that goes on in another chat (continueChat, ADR 0356): the successor holds it, with its phase; a proposal
   *  waiting for the user is cancelled on the old chat and registered on the new one in the same job, so the user's
   *  «Approva» answers the chat that works and nothing waits on a closed chat. The old chat keeps no plan. */
  protected override movePlan(from: Rec, to: Rec): void {
    const plan = from.s.plan;
    if (!plan || to.s.plan) return;
    // children still open report to the old chat (their parent), whose plan their reports move: the plan stays there
    // (review of ADR 0356; neither re-parenting them nor moving the plan after they end is done: a known gap)
    const open = [...this.chats.values()].filter(c => c.s.parentId === from.s.id && !c.s.closedAt).length;
    if (open > 0) { log.info('chats', 'plan kept on the chat its children report to', { chat: from.s.id, data: { next: to.s.id, phase: plan.phase, children: open } }); return; }
    to.s.plan = structuredClone(plan);
    if (plan.phase === 'proposed') {
      const store = this.coordination, old = this.planRequestKey(from, plan);
      const prior = store.original(from.s.id, old.originalRequestId);
      store.cancelPending(from.s.id, old.originalRequestId);
      const key = { ...this.planRequestKey(to, plan), jobId: prior?.key.jobId ?? old.jobId };
      store.register({ key, kind: 'plan', at: plan.at, payload: to.s.plan });
    }
    delete from.s.plan;
    this.updated(from);
    log.info('chats', 'plan moved to the chat that goes on', { chat: from.s.id, data: { next: to.s.id, phase: plan.phase } });
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

  /** plan_propose (agents/strategy-tools.ts): the Strategist's plan waits for the user's ok on its strip. `revise`
   *  («aggiorna il piano», 2026-11-23): the same plan again, its started steps kept (shared/strategy.ts checkRevision),
   *  also once approved or finished; the user approves it as any plan. */
  planPropose(chatId: string, steps: PlanStep[], doneWhen?: string, revise = false, doubts: PlanDoubt[] | undefined = this.chats.get(chatId)?.s.plan?.doubts): StrategyPlan {
    const r = this.need(chatId), plan = r.s.plan;
    if (!plan) throw new Error('plan_propose: only a Strategist the Orchestrator or the user started has a plan with the user.');
    if (!revise && (plan.phase === 'running' || plan.phase === 'done')) throw new Error('plan_propose: the plan is approved and under way; update its steps with plan_update, or bring it to the current standard with plan_propose revise: true.');
    if (!revise && plan.steps.some(s => s.state !== 'todo')) throw new Error('plan_propose: some steps of this plan already started; propose it again with revise: true, keeping them with { keep: <number> }.');
    // one open doubt blocks the approval (ADR 0344), the night's own included: the list is kept (planDoubts), not the plan
    const blocked = approvalGate({ doubts });
    if (blocked) throw new Error(blocked);
    // «Modalità notte» (ADR 0191): nobody will click «Approva e parti», so the plan starts as proposed (its recommended
    // choice) and the tool says so; the recap tells the user
    // (a job the user stopped stays stopped: its plan waits; one only put away waits for him too, but is not stopped)
    const away = !!this.opts.away?.() && !plan.stopped;
    const settled = away ? withoutDropped({ ...plan, steps }) : { plan: { steps }, stop: [] };
    const proposed: StrategyPlan = { phase: away ? 'running' : 'proposed', clarified: plan.clarified, ...(plan.pcOnly ? { pcOnly: true } : {}), ...(plan.asked ? { asked: plan.asked } : {}), ...(plan.enough ? { enough: true } : {}), steps: settled.plan.steps, ...(doneWhen ? { doneWhen } : {}), ...(doubts ? { doubts } : {}), ...(plan.stopped && !plan.putAway ? { stopped: true } : {}), at: Math.max(Date.now(), plan.at + 1) };
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
    if (settled.stop.length) void this.stopDropped(chatId, settled.stop);
    log.info('chats', 'plan proposed', { chat: chatId, data: { steps: steps.length, revise } });
    return structuredClone(r.s.plan);
  }

  /** plan_propose with a doubt open, or with the list alone (ADR 0344): the list is kept for the user to see. A plan that
   *  waited for the approval no longer does; one under way goes on (what was approved stays approved). */
  planDoubts(chatId: string, doubts: PlanDoubt[]): StrategyPlan {
    const r = this.need(chatId), plan = r.s.plan;
    if (!plan) throw new Error('plan_propose: only a Strategist the Orchestrator or the user started has a plan with the user.');
    r.s.plan = { ...plan, doubts, ...(plan.phase === 'proposed' ? { phase: 'revising' as const, at: Math.max(Date.now(), plan.at + 1) } : {}) };
    this.persist();
    this.updated(r);
    log.info('chats', 'plan doubts', { chat: chatId, data: { doubts: doubts.length, open: doubts.filter(d => d.state === 'open').length } });
    return structuredClone(r.s.plan);
  }

  /** What the user himself said in a Strategist's chat (ADR 0344): the interview's recorded answers and his own typed
   *  messages (the user event ledger: never an agent's or the app's text, never a panel answer's record). */
  doubtEvidence(chatId: string): DoubtEvidence {
    const r = this.need(chatId), plan = r.s.plan;
    return { clarified: plan?.clarified ?? [], said: (r.userTaskEvents?.events ?? []).map(e => e.text).filter(t => !t.startsWith('{"requestId"')),
      mayChoose: !!plan?.enough || !!this.opts.away?.() };
  }

  /** plan_update: a step the Strategist does itself (or corrects) moves on. */
  planUpdate(chatId: string, i: number, state: StepState, proof?: string): StrategyPlan {
    const r = this.need(chatId), plan = r.s.plan;
    const step = plan?.steps[i];
    // a revision waits for the user: the steps already started go on (ADR 0342), no other one moves
    const going = !!step && step.state !== 'todo' && state !== 'todo';
    if (!plan || plan.phase !== 'running' && plan.phase !== 'done' && !going) throw new Error('plan_update: the user has not approved a plan yet.');
    if (plan.stopped && !going) throw new Error('plan_update: the user stopped this job; wait for the user to resume it.');
    const now = Date.now();
    r.s.plan = withStep(plan, i, state, now, proof?.trim() ? { at: now, by: 'strategist', text: proof.trim().slice(0, 600) } : undefined);
    this.persist();
    this.updated(r);
    return structuredClone(r.s.plan);
  }

  /** The steps of the plan this chat carries, by explicit operations (shared/plan-edit.ts): the Strategist's own, or the user's from the
   *  plan's page. Nothing that is not named changes; one bad operation leaves the plan as it was. */
  planEdit(chatId: string, ops: readonly StepOp[], by: 'user' | 'strategist'): StrategyPlan {
    const r = this.need(chatId), plan = r.s.plan;
    if (!plan) throw new Error('Questa chat non ha un piano.');
    r.s.plan = applySteps(plan, ops, Date.now(), by);
    this.persist();
    this.updated(r);
    log.info('chats', 'plan steps edited', { chat: chatId, data: { ops: ops.length, by } });
    return structuredClone(r.s.plan);
  }

  /** plan_update add (ADR 0276): a piece found on the way joins the approved plan as one more step; no new approval. */
  planAdd(chatId: string, step: PlanStep): StrategyPlan {
    const r = this.need(chatId), plan = r.s.plan;
    if (!plan) throw new Error('plan_update add: only a Strategist with a plan approved by the user has steps.');
    if (plan.stopped) throw new Error('plan_update add: the user stopped this job; wait for the user to resume it.');
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

  /** The user's click on a proposed plan (chat:plan): «Approva e parti» or «Cambia il piano» with what to change; the
   *  Strategist gets it as the user's message. «Basta domande» is an answer to its open question (renderer).
   *  by 'phone' = a button on the paired phone (chats/phone-port.ts): the same checks, a «Risposto dal telefono» line.
   *  keep (ADR 0342) = approved and kept for later: recorded like any approval, nothing starts until planStart. */
  async planDecide(chatId: string, decision: 'approve' | 'change', at: number, text?: string, by: 'pc' | 'phone' = 'pc', keep = false): Promise<void> {
    return this.decidePlan(chatId, decision, at, text, undefined, undefined, false, by, keep);
  }

  /** Decision commits before delivery. A delivery failure never rolls accepted consent back into a fresh question. */
  protected override async decidePlan(chatId: string, decision: 'approve' | 'change', at: number, text?: string, message?: string, receipt?: SubmissionReceipt, byApp = false, by: 'pc' | 'phone' = 'pc', keep = false): Promise<void> {
    const r = this.need(chatId), plan = r.s.plan;
    if (!plan || plan.phase !== 'proposed') throw new Error('Questo piano non aspetta più una risposta.');
    if (plan.at !== at) throw new Error('Il piano è cambiato nel frattempo: rileggilo.');
    const change = typeof text === 'string' ? text.trim() : '';
    if (decision === 'change' && (!change || change.length > 2000)) throw new Error('Scrivi cosa cambiare (al massimo 2000 caratteri).');
    if (decision !== 'approve' && decision !== 'change' || keep && decision !== 'approve') throw new Error('Scelta non valida.');
    // no approval with a doubt open, from anyone (pc, phone, typed, the Orchestrator for him, night mode)
    const doubt = decision === 'approve' ? approvalGate(plan) : null;
    if (doubt) throw new Error(doubt);
    const store = this.coordination;
    let key = this.planRequestKey(r, plan);
    // a revision proposed by an older version was recorded with its steps' progress in the hash
    const prior = store.original(r.s.id, key.originalRequestId)?.key;
    if (prior && prior.proposalHash === proposalHash({ steps: plan.steps, clarified: plan.clarified, doneWhen: plan.doneWhen, pcOnly: plan.pcOnly })) key = { ...key, proposalHash: prior.proposalHash };
    // One-time migration for a proposed plan restored from pre-journal chats.json. Existing receipts are never rebound.
    if (!store.original(r.s.id, key.originalRequestId)) store.register({ key, kind: 'plan', at: plan.at, payload: plan });
    const accepted = store.resolve(key, byApp ? { kind: 'policy', policy: 'away-plan' } : { kind: 'user', channel: by }, { decision, text: change, ...(keep ? { keep: true } : {}) });
    const delivery = keep ? undefined : store.beginDelivery(accepted.id);
    // The phase is a chat mirror, not the decision journal. A crash here leaves an accepted, unconfirmed delivery.
    // the steps the approved revision takes away leave the plan, and their chats stop (ADR 0342)
    const { plan: kept, stop: dropped } = decision === 'approve' ? withoutDropped(plan) : { plan, stop: [] };
    const { stopped: _stopped, ...open } = kept;
    r.s.plan = { ...open, phase: decision === 'change' ? 'revising' : keep ? 'approved' : 'running', at: Math.max(Date.now(), plan.at + 1) };
    this.persist(keep);
    this.updated(r);
    if (dropped.length) await this.stopDropped(chatId, dropped);
    if (!delivery) {
      store.recordApplication(accepted.id);
      this.planDecided(r, decision, byApp, by, true);
      return;
    }
    let settled = false;
    const finishDelivery = (state: 'delivered' | 'uncertain') => { if (!settled) { store.finishDelivery(delivery.id, state); settled = true; } };
    const tracked: SubmissionReceipt = {
      beforeSubmit: () => receipt?.beforeSubmit(),
      submitted: () => { finishDelivery('delivered'); receipt?.submitted(); },
      failed: error => { finishDelivery('uncertain'); receipt?.failed(error); },
    };
    await this.send(chatId, message ?? (decision === 'approve' ? PLAN_APPROVED : planChange(change)), undefined, false, undefined, false, { kind: byApp ? 'app' : 'user' }, tracked);
    this.planDecided(r, decision, byApp, by);
  }

  private planDecided(r: Rec, decision: 'approve' | 'change', byApp: boolean, by: 'pc' | 'phone', keep = false): void {
    if (by === 'phone') { this.addItem(r, sysItem('phoneDecided', { time: phoneTime(Date.now()), what: 'plan' }, 'info'), false); this.updated(r); }
    // the user's click on the run's plan: approved as proposed, or a change asked (standing.ts decisionSignals, ADR 0131)
    const run = r.s.run;
    if (run && run.endedAt === undefined) {
      const p = run.plan ?? { proposals: 1, changes: 0 };
      run.plan = decision === 'approve' ? { ...p, approvedAt: p.approvedAt ?? Date.now(), ...(byApp ? { byApp: true } : {}) } : { ...p, changes: p.changes + 1 };
      this.runSave();
    }
    log.info('chats', 'plan decided', { chat: r.s.id, data: { decision, ...(keep ? { keep } : {}), ...(by === 'phone' ? { by } : {}) } });
  }

  /** The chats of steps the approved revision took away: cancelled with what they delegated (ADR 0342). */
  private async stopDropped(chatId: string, ids: readonly string[]): Promise<void> {
    const mine = new Set(this.descendantsOf(chatId).map(x => x.s.id));
    const failed = (await Promise.allSettled(ids.filter(id => mine.has(id)).map(id => this.cancelChild(id)))).filter(x => x.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length) log.warn('chats', 'a step taken away did not stop', { chat: chatId, cause: errText(failed[0]!.reason), hint: 'close its chat by hand', data: { failed: failed.length } });
  }

  /** «Parti» on a plan approved and kept (ADR 0342): the Strategist gets the same message an approval sends. A message
   *  that does not go out leaves it kept, to start again. text = the user's own words, when they typed them. */
  async planStart(chatId: string, text: string = PLAN_APPROVED, receipt?: SubmissionReceipt): Promise<void> {
    const r = this.need(chatId), plan = r.s.plan;
    if (plan?.phase !== 'approved') throw new Error('Questo piano non aspetta di partire.');
    const doubt = approvalGate(plan); // a doubt that came up after the yes holds the start too (ADR 0344)
    if (doubt) throw new Error(doubt);
    const { stopped: _s, ...open } = plan;
    const started: StrategyPlan = { ...open, phase: 'running', at: Math.max(Date.now(), plan.at + 1) };
    r.s.plan = started;
    this.persist();
    this.updated(r);
    try { await this.send(chatId, text, undefined, false, undefined, false, { kind: 'user' }, receipt); }
    catch (e) {
      if (r.s.plan === started) { r.s.plan = { ...plan, at: started.at + 1 }; this.persist(); this.updated(r); }
      throw e;
    }
    log.info('chats', 'kept plan started', { chat: chatId });
  }

  /** «Ferma» on a job (ADR 0342): no new step starts until planResume, and what is under way is interrupted, the chats
   *  it delegated too. Nothing is closed. */
  async planStop(chatId: string): Promise<void> {
    const r = this.need(chatId);
    if (r.s.plan && r.s.plan.phase !== 'done' && !r.s.plan.stopped) { r.s.plan = { ...r.s.plan, stopped: true }; this.persist(); this.updated(r); }
    const tree = [r, ...this.descendantsOf(chatId)].filter(x => !x.s.closedAt);
    const failed = (await Promise.allSettled(tree.map(x => this.stop(x.s.id)))).filter(x => x.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length) log.warn('chats', 'a chat of a stopped job did not stop', { chat: chatId, cause: errText(failed[0]!.reason), hint: 'stop it from its strip', data: { failed: failed.length } });
    log.info('chats', 'job stopped', { chat: chatId, data: { chats: tree.length } });
  }

  /** «Riprendi» (ADR 0342): the chat is open again and, unless its plan waits for the user, goes on; a plan put away
   *  before its approval is proposed again. One that does not go out leaves the plan stopped. */
  async planResume(chatId: string, cwd?: string): Promise<void> {
    const r = this.need(chatId), plan = r.s.plan;
    // the engines as they are now (ADR 0361): a job whose engine is stopped and whose role now starts on another one goes on
    // in a linked chat, its plan with it as it is (the approval too); one with children at work stays where they report
    const children = this.openChildren(chatId), moved = !!cwd?.trim() && !sameFolder(cwd, r.s.cwd);
    const on = plan && !r.session && !children ? this.opts.engineNow?.({ ...r.s }) ?? null : null;
    if (moved && children) throw new Error('Questa chat ha altre chat al lavoro che riferiscono a lei: cambia cartella quando hanno finito, oppure riprendi qui.');
    if (on || moved) {
      const next = await this.continueChat(chatId, { ask: false, ...(on ? { on } : {}), ...(moved ? { cwd } : {}), promptPrefix: PLAN_RESUMED });
      const nr = this.chats.get(next.id);
      // «Riprendi» ends a «Ferma», and only «Riprendi» does: a plan moved by anything else stays stopped
      if (nr?.s.plan?.stopped) { const { stopped: _s, putAway: _p, ...open } = nr.s.plan; nr.s.plan = open; this.persist(); this.updated(nr); }
      return;
    }
    let resumed: StrategyPlan | undefined;
    if (plan?.stopped) { const { stopped: _s, putAway: _p, ...open } = plan; r.s.plan = resumed = open; this.persist(); this.updated(r); }
    try {
      if (plan?.phase === 'proposed' || plan?.phase === 'approved') await this.reopen(chatId);
      else await this.send(chatId, plan?.putAway ? PLAN_REPROPOSE : PLAN_RESUMED, undefined, false, undefined, false, { kind: 'user' });
    } catch (e) {
      if (resumed && r.s.plan === resumed) { r.s.plan = plan; this.persist(); this.updated(r); }
      throw e;
    }
    log.info('chats', 'job resumed', { chat: chatId });
  }

  /** «Ripianifica», in the user's words (ADR 0342): the Strategist proposes again. A job under way is in revision at
   *  once, so no new step starts before the user's ok; its started steps go on. A request that does not go out leaves the
   *  plan as it was. */
  async planReplan(chatId: string, text: string): Promise<void> {
    const r = this.need(chatId), plan = r.s.plan, change = text.trim();
    if (!plan) throw new Error('Questo lavoro non ha ancora un piano.');
    if (!change || change.length > 2000) throw new Error('Scrivi cosa cambiare (al massimo 2000 caratteri).');
    if (plan.phase === 'proposed') return this.decidePlan(chatId, 'change', plan.at, change);
    const revising: StrategyPlan = { ...plan, phase: 'revising', at: Math.max(Date.now(), plan.at + 1) };
    const planned = plan.phase === 'approved' || plan.phase === 'running' || plan.phase === 'done';
    if (planned) { r.s.plan = revising; this.persist(); this.updated(r); }
    try { await this.send(chatId, !planned ? change : plan.steps.some(s => s.state !== 'todo') ? `${planChange(change)}\n${PLAN_REPLAN}` : planChange(change), undefined, false, undefined, false, { kind: 'user' }); }
    catch (e) {
      if (planned && r.s.plan === revising) { r.s.plan = { ...plan, at: revising.at + 1 }; this.persist(); this.updated(r); }
      throw e;
    }
    log.info('chats', 'job replanned', { chat: chatId, data: { phase: plan.phase } });
  }

  /** A plan waiting for the user, put in the archive (ADR 0342): the request is answered (nothing starts), the Strategist
   *  is not called back. Reopened, its job is stopped by the user: «Riprendi» asks for the plan again. */
  planPutAway(chatId: string): void {
    const r = this.need(chatId), plan = r.s.plan;
    if (plan?.phase !== 'proposed') return;
    const store = this.coordination, key = this.planRequestKey(r, plan);
    const prior = store.original(r.s.id, key.originalRequestId);
    if (!prior) store.register({ key, kind: 'plan', at: plan.at, payload: plan });
    const accepted = store.resolve(prior?.key ?? key, { kind: 'user', channel: 'pc' }, { decision: 'change', text: PLAN_PUT_AWAY });
    r.s.plan = { ...plan, phase: 'revising', stopped: true, putAway: true, at: Math.max(Date.now(), plan.at + 1) };
    this.persist(true);
    store.recordApplication(accepted.id);
    this.updated(r);
    log.info('chats', 'plan put away', { chat: chatId });
  }

  /** The user typed in this chat himself (chat:send only, ADR 0083): so that nothing conflicts, the Orchestrator learns it
   *  as quiet news (orchestrator-wake.ts, its own listener) and, for a delegated chat, its parent gets the same note with
   *  its next message (and a line in its transcript now). The user's own words go, never the child's. */
  /** true = recorded and checkpointed (chats.json written); false = not a chat that keeps the user's events. */
  override userWrote(chatId: string, text: string): boolean {
    const r = this.chats.get(chatId);
    if (!r || r.s.isOrchestrator) return false;
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
  /** Every check of an assignment before anything changes (assignTask, assignElsewhere): throws, or answers why the chat
   *  cannot take it right now (busy); null = it can. */
  private assignGuards(r: Rec, prompt: string, options: TaskAssignmentOptions): string | null {
    const chatId = r.s.id;
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
      if (source.kind !== 'chat' || source.chatId !== r.s.parentId || !plan || !['running', 'done'].includes(plan.phase) || plan.stopped || !Number.isSafeInteger(options.planStep) || !plan.steps[options.planStep]) throw new Error('Invalid or unapproved parent plan step.');
    }
    if (options.reviewOf !== undefined) this.runs.checkLinks({ reviewOf: options.reviewOf }); // before the previous run ends
    this.deliveryPolicy(options.deliveryPolicy, !!r.s.parentId);
    if (options.doneWhen && (options.doneWhen.length > 12 || options.doneWhen.some(x => typeof x !== 'string' || !x.trim() || x.length > 300))) throw new Error('Invalid task criteria.');
    return this.midTurn(r) || r.pending.size || r.s.queued || r.opening || r.releasing || r.switching || r.archiving || this.deliveries.has(chatId)
      ? 'The chat is busy or has queued work: nothing was assigned. Assign again once its current work has ended; a retry now gets the same answer.' : null;
  }

  async assignTask(chatId: string, prompt: string, options: TaskAssignmentOptions = {}): Promise<void> {
    const r = this.need(chatId), source = options.source ?? { kind: 'user' as const };
    const busy = this.assignGuards(r, prompt, options);
    if (busy) throw new ToolRefusal(busy);
    // its role's card as it is now (ADR 0352): a card changed since it started never stops the work
    // held as a switch: no mail tick or message starts a turn while the engine relaunches on the new tools
    const adopting = this.adoptCard(r).then(() => null);
    r.switching = adopting;
    try { await adopting; } finally { if (r.switching === adopting) r.switching = undefined; }
    if (this.midTurn(r) || r.pending.size || r.s.queued || this.deliveries.has(chatId)) throw new ToolRefusal('The chat is busy or has queued work: nothing was assigned. Assign again once its current work has ended; a retry now gets the same answer.');
    const freshBoundary = this.freshReady(r, Date.now());
    // the task's preset (ADR 0336, agent_assign_task): the switch comes after every guard above, so a refused
    // assignment never leaves the chat on another model; put back when the assignment itself still fails
    const restore = await this.presetSwitch(r, options.preset?.switchTo);
    try { this.beginAssignment(r, prompt, options); } catch (e) { await restore(); throw e; }
    if (freshBoundary) r.freshAssignmentRun = r.s.run?.runId;
    if (options.mode === 'new-task' && r.s.plan) prompt += `\n\n${strategyPrompt(r.s.plan)}`;
    if (options.planStep !== undefined && r.s.parentId) this.planDelegated(r.s.parentId, options.planStep, [chatId]);
    if (source.kind === 'chat' && r.userTaskEvents) { r.userTaskEvents.acknowledgedSeq = r.userTaskEvents.latestSeq; this.persist(true); this.updated(r); }
    const from = source.kind === 'chat' ? this.need(source.chatId).s.title : source.kind === 'app' ? 'App' : undefined;
    try { await this.send(chatId, prompt, undefined, false, from, false, source); }
    finally { r.freshAssignmentRun = undefined; }
  }

  /** A role chat given new work takes its card as it is now (ChatManager.adoptCard, ADR 0352). */
  protected abstract adoptCard(r: Rec): Promise<void>;

  /** The chat's settings (ChatManager.set): effort null = back to the engine's default. */
  abstract set(chatId: string, patch: { model?: string; effort?: Effort | null }): Promise<ChatSummary>;

  /** The engine the chat's role starts on now when it is another one than the chat's (ADR 0361); null = the same. */
  engineNow(chatId: string): ReturnType<NonNullable<ChatManagerOptions['engineNow']>> { return this.opts.engineNow?.({ ...this.need(chatId).s }) ?? null; }

  /** A task for this chat in another folder (ADR 0362) or on another engine (ADR 0361): a chat never changes either, so the
   *  task starts in a linked chat that inherits its context (the hand-off), its role, permissions, parent, plan step and
   *  history. The same guards as assignTask. */
  async assignElsewhere(chatId: string, prompt: string, options: TaskAssignmentOptions, to: { cwd?: string; place?: 'here' | 'copy'; on?: { harness: Harness; model: string | null; effort: Effort | null; route?: string } }): Promise<ChatSummary> {
    const r = this.need(chatId);
    if (r.s.continuedBy) throw new ToolRefusal(`This chat goes on in «${r.s.continuedBy.title}» (${r.s.continuedBy.id}): assign there.`);
    if (this.continuing.has(chatId)) throw new ToolRefusal('The chat is already going on in another one: nothing was assigned. Read agent_children or app_chats, then assign to the chat that goes on.');
    const at = this.assignGuards(r, prompt, options);
    if (at) throw new ToolRefusal(at);
    if (!r.s.run) throw new Error('Only role chats can receive tasks.');
    if (this.openChildren(chatId)) throw new ToolRefusal('This chat has chats at work under it, which report to it: it goes on elsewhere once they have ended. Assign here without another folder, or wait for them.');
    if (r.heldResult) { this.releaseResult(r); if (r.heldResult) throw new Error('The previous result awaits an Orchestrator; deliver it before assigning again.'); }
    const route = to.on?.route, was = r.s.run.presetChoice;
    const next = await this.continueChat(chatId, { ...to, ask: false, task: true });
    const nr = this.need(next.id), context = nr.taskContext ?? '';
    delete nr.taskContext;
    const { expectedVersion: _v, expectedEventSeq: _e, ...rest } = options; void _v; void _e;
    const preset = options.preset ? (({ switchTo: _s, ...p }) => p)(options.preset) : to.on && was ? { choice: { ...was, ...(route ? { route } : {}) }, model: to.on.model } : undefined;
    const notes = next.folderNotes?.length ? `\n\nCartella di lavoro (dall’app):\n${next.folderNotes.map(n => `- ${n}`).join('\n')}` : '';
    try { await this.assignTask(next.id, `${context}${notes}\n\nNuovo compito:\n${prompt}`, { ...rest, ...(preset ? { preset } : {}) }); }
    catch (e) {
      // the linked chat exists and carries the work, but not this task: it never shares the old chat's run; say where to assign again
      if (nr.s.run?.chatId !== nr.s.id) { delete nr.s.run; this.persist(); this.updated(nr); }
      throw new ToolRefusal(`${errText(e)} The work already goes on in «${nr.s.title}» (chatId ${next.id}) without this task: assign it there.`);
    }
    return { ...nr.s };
  }
  /** Chats still open under this one: they report to it. */
  protected openChildren(chatId: string): boolean { return [...this.chats.values()].some(x => x.s.parentId === chatId && !x.s.closedAt); }

  /** A chat that waits on its credits goes on in its level on the same engine (ADR 0354; when: agents/credit-wait.ts): it
   *  switches to the level's model (or keeps the one it stopped on, now free) and goes on from where it was, told by
   *  the app. Its run names the model it goes on with. A model the engine refuses is a CreditMoveRefused (that model is
   *  skipped next time); a message that cannot be sent is a temporary failure. False: it does not wait any more, or it
   *  works. */
  async creditResume(chatId: string, to: { model: string | null; effort: Effort | null }, note: MoveNote): Promise<boolean> {
    const r = this.chats.get(chatId), w = r?.s.creditWait;
    if (!r || !w || r.s.closedAt || r.session?.busy || r.working) return false;
    if ((to.model ?? '') !== (r.choice.model ?? '')) {
      try { await this.set(chatId, { model: to.model ?? '' }); } catch (e) { throw new CreditMoveRefused(errText(e)); }
    }
    // the level's effort for this model, when it takes it: a refusal keeps the chat's own (set says so) and never holds the work
    if ((to.effort ?? null) !== (r.choice.effort ?? null)) await this.set(chatId, { effort: to.effort }).catch(e => log.warn('chats', 'preset effort not applied after a credit wait', { chat: chatId, cause: errText(e), hint: 'the chat goes on with its own effort' }));
    if (this.chats.get(chatId) !== r || r.s.closedAt || r.s.creditWait !== w) return false;
    if (r.s.run && r.s.run.endedAt === undefined) { r.s.run.model = to.model; this.runSave(); }
    r.s.creditMoved = { at: Date.now(), ...note };
    this.addItem(r, sysItem('creditMoved', { ...note }, 'info'), false);
    this.persist();
    this.updated(r);
    const text = `${APP_EVENT_LABEL}\nIl tuo ultimo turno si è fermato perché il limite di ${note.from} era finito. L’app ti ha fatto ripartire su ${note.to}, nello stesso livello (${note.level}) del tuo ruolo: ${note.why}. Riprendi il compito da dove eri, senza rifare quello che è già fatto.${r.s.delegation && !r.s.delegation.result ? ' Quando hai finito consegna con agent_report.' : ''}`;
    await this.send(chatId, text, undefined, false, 'second-brain', false, { kind: 'app' });
    // delivered: the wait is over (the turn's start usually ended it already)
    if (r.s.creditWait === w) { delete r.s.creditWait; this.persist(); this.updated(r); }
    return true;
  }

  /** A chat that waits on its credits goes on on another engine (ADR 0354): a chat never changes engine, so its work goes
   *  on in a new chat of the same role on that engine and model: «Riprendi» with the app's own hand-off note (the old
   *  engine has no credit to write one), the same child of the same parent, contract, worktree and uncommitted changes
   *  (sameWorktree: the successor takes the predecessor's worktree, whose process ends first). The old chat then owes
   *  nothing (continuedBy): its successor reports, once. A guard that refuses (a chat the user closed, a parent that is
   *  gone) is a CreditMoveRefused. */
  async creditContinue(chatId: string, on: { engine: Harness; model: string | null; effort: Effort | null; route?: string }, note: MoveNote): Promise<boolean> {
    const r = this.chats.get(chatId), w = r?.s.creditWait;
    if (!r || !w || r.s.closedAt || r.s.continuedBy || r.session?.busy || r.working) return false;
    let next: ChatSummary;
    try {
      next = await this.continueChat(chatId, { allowStart: false, ask: false, sameWorktree: true, on: { harness: on.engine, model: on.model, effort: on.effort, ...(on.route ? { route: on.route } : {}) },
        // one that never started begins there with its whole first message (ADR 0361): there is nothing to hand off
        ...(w.why === 'start' && w.prompt ? { firstPrompt: w.prompt } : {}),
        promptPrefix: w.why === 'start' ? `${APP_EVENT_LABEL}\nLa chat «${r.s.title}» non è partita: il suo motore (${note.from}) ha dato errore. L’app ha passato il lavoro a ${note.to}: comincia qui.` : `${APP_EVENT_LABEL}\nLa chat «${r.s.title}» si è fermata perché il limite di ${note.from} era finito. L’app ha passato il lavoro a ${note.to}, nello stesso livello (${note.level}) del ruolo, su un altro motore: ${note.why}. Il lavoro continua qui, da dove era: stessa cartella, stesse modifiche non committate.` });
    } catch (e) {
      if (/closed this chat|non c’è più|already goes on|Ripresa annullata/i.test(errText(e))) throw new CreditMoveRefused(errText(e));
      throw e;
    }
    if (next.id === chatId) return false;
    delete r.s.creditWait;
    const nr = this.chats.get(next.id);
    if (nr) { nr.s.creditMoved = { at: Date.now(), ...note }; this.addItem(nr, sysItem('creditMoved', { ...note }, 'info'), false); this.updated(nr); }
    this.addItem(r, sysItem('creditMoved', { ...note }, 'info'), false);
    this.persist();
    this.updated(r);
    return true;
  }

  /** Announces the automatic move of a waiting chat (ADR 0348, agents/credit-wait.ts): to `on` at `next.at`, with where
   *  from, the level and why; the chat shows it with «Annulla» (creditStay). */
  creditPlan(chatId: string, next: { card: string; at: number }, on: { engine: Harness; model: string | null }, note: MoveNote): void {
    const r = this.chats.get(chatId), w = r?.s.creditWait;
    if (!r || !w || w.stay || w.next?.card === next.card) return;
    r.s.creditWait = { ...w, next };
    delete r.s.creditWait.waiting;
    this.addItem(r, sysItem('creditSwitchSoon', { to: on.model ?? '', engine: engineOf(on.engine)?.label ?? on.engine, secs: Math.round((next.at - Date.now()) / 1000), card: next.card, from: note.from, level: note.level, why: note.why }, 'info'), false);
    this.persist();
    this.updated(r);
  }

  /** «Annulla» on an announced move (ADR 0348): the chat keeps waiting; it moves when its role's levels change, or when
   *  the user writes to it. False: no move was announced. */
  creditStay(chatId: string): boolean {
    const r = this.chats.get(chatId), w = r?.s.creditWait;
    if (!r || !w?.next) return false;
    const { next, ...rest } = w;
    r.s.creditWait = { ...rest, card: rest.card ?? next.card, stay: true };
    this.addItem(r, sysItem('creditSwitchCancelled', undefined, 'info'), false);
    this.persist();
    this.updated(r);
    return true;
  }

  /** The key of the role's level lists the «Annulla» holds on (agents/credit-wait.ts). */
  creditHold(chatId: string, key: string): void {
    const r = this.chats.get(chatId), w = r?.s.creditWait;
    if (!r || !w || w.stay !== true) return;
    r.s.creditWait = { ...w, stay: key };
    this.persist();
  }

  /** The whole level of a waiting chat is out: which models and when the first comes back, said once per change. */
  creditWaiting(chatId: string, waiting: NonNullable<CreditWait['waiting']>): void {
    const r = this.chats.get(chatId), w = r?.s.creditWait;
    if (!r || !w) return;
    const { next: _n, ...rest } = w; void _n;
    r.s.creditWait = { ...rest, waiting };
    this.addItem(r, sysItem('creditAllOut', { out: waiting.out.join(' · '), first: waiting.first ? clockLine(waiting.first) : '' }, 'warn'), false);
    this.persist();
    this.updated(r);
  }

  /** A move failed (agents/credit-wait.ts): recorded on the wait; the chat says why, and what happens next. */
  creditFailed(chatId: string, f: { card: string; error: string; permanent: boolean; nextAt: number | null; last: boolean }): void {
    const r = this.chats.get(chatId), w = r?.s.creditWait;
    if (!r || r.s.closedAt || !w) return;
    const was = (w.failed ?? []).find(x => x.card === f.card);
    const row = { card: f.card, n: (was?.n ?? 0) + 1, at: Date.now(), nextAt: f.nextAt, permanent: f.permanent, error: f.error.slice(0, 300) };
    const { next: _n, ...rest } = w; void _n;
    r.s.creditWait = { ...rest, failed: [...(w.failed ?? []).filter(x => x.card !== f.card), row].slice(-16) };
    this.addItem(r, sysItem('creditMoveFailed', { error: f.error, to: f.card.slice(f.card.indexOf(':') + 1) || f.card, again: f.nextAt ? clockLine(f.nextAt) : '' }, 'warn'), false);
    this.persist();
    this.updated(r);
  }

  /** Moves the chat to a preset's model and effort; the returned undo puts back what it ran on (best effort). */
  private async presetSwitch(r: Rec, to: { model: string; effort: Effort | null } | undefined): Promise<() => Promise<void>> {
    if (!to) return async () => {};
    const was = { model: r.choice.model ?? '', effort: r.choice.effort };
    const patch = { model: to.model, ...(to.effort !== (r.choice.effort ?? null) ? { effort: to.effort } : {}) };
    const undo = async () => { await this.set(r.s.id, { model: was.model, ...('effort' in patch ? { effort: was.effort } : {}) }).catch(() => undefined); };
    try { await this.set(r.s.id, patch); } catch (e) { await undo(); throw e; }
    return undo;
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
    this.finishRun(previous, previous.report ? 'completed' : 'closed', at, 'replaced');
    const next = this.runs.start({ chatId: r.s.id, agentId: previous.agentId, version: previous.version,
      goal: prompt, startedBy: previous.startedBy, startedAt: at, costKnown: previous.costUsd !== null,
      requestOrigin: mode === 'new-task' ? (options.source?.kind === 'chat' ? 'agent' : options.source?.kind === 'app' ? 'app' : 'user') : previous.requestOrigin ?? 'app',
      tags: previous.tags ? { ...previous.tags, skills: [] } : undefined, tier: previous.tier,
      // the preset this task asked for (ADR 0336, agent_assign_task), else the one the chat already runs on
      model: options.preset ? options.preset.model : previous.model,
      ...(options.preset ? { presetChoice: options.preset.choice } : previous.presetChoice ? { presetChoice: previous.presetChoice } : {}),
      ...(r.s.parentId && this.chats.get(r.s.parentId)?.s.run ? { parentRunId: this.chats.get(r.s.parentId)!.s.run!.runId } : {}),
      ...(mode === 'rework' ? { reworkOf: previous.runId } : {}),
      // a review chat's next round stays a review (#387): its run names the run it reviews now
      ...(options.reviewOf ? { reviewOf: options.reviewOf } : {}) }, !this.deferWrites());
    const brainRoot = this.opts.brainRoot?.();
    if (brainRoot) next.scope = { brainRoot: path.resolve(brainRoot), projectRoot: path.resolve(r.s.cwd) };
    next.taskId = mode === 'new-task' ? next.runId : previous.taskId ?? previous.runId;
    next.taskVersion = (previous.taskVersion ?? 1) + 1;
    next.taskContract = { ...(previous.taskContract?.reportExpected ? { reportExpected: true } : {}), deliveryPolicy: this.deliveryPolicy(options.deliveryPolicy ?? previous.taskContract?.deliveryPolicy, !!r.s.parentId), goal: goalText(prompt), doneWhen: options.doneWhen ?? (mode === 'new-task' ? [] : previous.taskContract?.doneWhen ?? r.s.delegation?.doneWhen ?? []), ...(options.contractFields?.length ? { fields: options.contractFields } : {}) };
    if (mode === 'continue') next.continuedFrom = previous.runId;
    r.s.run = next;
    this.coordination.cancelOtherAssignments(r.s.id, next.runId);
    if (newPlan) {
      r.s.plan = newPlan;
      if (options.intake) delete this.need(options.intake.chatId).intakeKey;
    }
    r.s.work = { status: 'assigned', updatedAt: at };
    if (r.s.delegation) r.s.delegation = { ...r.s.delegation, goal: next.goal, doneWhen: next.taskContract.doneWhen, at, result: undefined };
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

  /** The list price of each of these models that has one (ADR 0284): a plain table for the read worker's estimates. */
  listPrices(models: readonly string[]): Record<string, TokenPrice> {
    const out: Record<string, TokenPrice> = {};
    for (const m of new Set(models)) { const p = m ? this.opts.priceOf?.(m) : null; if (p) out[m] = p; }
    return out;
  }

  /** The §5 metrics per agent and version (A6): runs kept plus the rollups of the pruned ones. */
  runMetrics(opts: { since?: number; skill?: string; app?: string; repo?: string } = {}): ReturnType<typeof runMetrics> {
    // Metrics read the current in-memory record; reading must not force a synchronous archive write.
    const runs = this.runs.list(), rollups = this.runs.rolledUp();
    const live = (run: AgentRun) => { const r = this.chats.get(run.chatId); return !!r && !r.s.closedAt && r.s.run?.runId === run.runId; };
    const metrics = runMetrics(runs, { rollups, live, ...(opts.since !== undefined ? { since: opts.since } : {}),
      filter: { ...(opts.skill !== undefined ? { skill: opts.skill } : {}), ...(opts.app !== undefined ? { app: opts.app } : {}), ...(opts.repo !== undefined ? { repo: opts.repo } : {}) } });
    // the card's level and performance are the agent's whole record, whatever the filter
    const standing = standings(runs, rollups, Date.now(), this.opts.priceOf ?? null);
    return withStandings(metrics, standing);
  }

  /** The user's verdict on an agent run (thumbs up / down / partly; the UI's only, never an agent tool): basis human;
   *  an open run ends as completed, an ended one keeps how it ended. */
  markRun(chatId: string, verdict: AgentRunOutcome['verdict'], note?: string): ChatSummary {
    const r = this.need(chatId);
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

  /** The user's pat (+1) or whack (-1) on the little person of this chat's run (ADR 0297; the UI's only, never an agent
   *  tool): one per run, the last one stands, the run and the chat's last activity stay as they are. False = nothing changed
   *  (no run, the same sign). */
  touchRun(chatId: string, sign: 1 | -1): boolean {
    const r = this.need(chatId), run = r.s.run;
    if (!run || run.touch?.sign === sign) return false;
    run.touch = { sign, at: Date.now() };
    this.runSave(); this.persist();
    // the page learns it, the chat's clock does not: a pat is no activity (it must not reset a stalled child's time)
    this.opts.emitter.emit('chat:updated', { ...r.s });
    return true;
  }
}
