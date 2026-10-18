// Lifecycle coordinator for the main-process integrator: the durable "Da approvare" queue, the batched and gated
// Orchestrator wake asking for feedback on ended runs, the trial evaluations and the daily local rules.
// Nothing here changes the catalog: every entry is a proposal the user approves or dismisses (lifecycle-api.ts decide,
// reached only through the sender-checked agents:lifecycleDecide IPC). The daily pass is entirely local ($0); the wake
// is the only step that can cost tokens, so it is batched, spaced and capped per day (WakePolicy) and its delivery is
// gated by the caller (wiring.ts: an Orchestrator that exists, is idle and is not talking with the user).
import path from 'node:path';
import type { AgentProfile, AgentRun } from '../../shared/agents';
import type { AgentFeedback, AgentLifecycleProposal, TrialEvaluation } from '../../shared/agent-lifecycle';
import { NO_FEEDBACK, repeatedGap, type FeedbackSource } from './feedback';
import { readLocal, writeLocal } from './local-store';
import { suggestAgents, type SuggestionInput } from './suggestions';
import { evaluateTrial } from './trials';
import type { ProbationJudgement } from './probation';
import { log } from '../log';

/** When the feedback wake may go. Defaults: 5 runs waiting or the oldest 3 h old, 2 h between wakes, 3 a day. */
export interface WakePolicy { minAgeMs: number; minBatch: number; maxWaitMs: number; minGapMs: number; perDay: number; maxQueueAgeMs: number }
export const WAKE_POLICY: WakePolicy = { minAgeMs: 30_000, minBatch: 5, maxWaitMs: 3 * 3600_000, minGapMs: 2 * 3600_000, perDay: 3, maxQueueAgeMs: 7 * 86_400_000 };
/** how long a dismissed key stays out of the queue */
export const DISMISS_DECISION_MS = 7 * 86_400_000;
export const DISMISS_SUGGESTION_MS = 14 * 86_400_000;

export interface LifecycleDeps {
  userData: string;
  /** the one feedback store (the authoring store behind agent_feedback); none = no feedback yet */
  feedback?: FeedbackSource;
  /** Deliver one labelled request through the Orchestrator; false = not delivered now (no recipient, gate closed): the
   *  batch stays queued. It must not start an engine nor reach an Orchestrator busy with the user. */
  wake(runIds: string[]): boolean | Promise<boolean>;
  /** false = this queued run no longer needs an opinion (the user gave a verdict, it has feedback, it was pruned) */
  needsFeedback?(runId: string): boolean;
  wakePolicy?: Partial<WakePolicy>;
  /** UI adapter shows these as Da approvare. It must not apply them from this callback. */
  changed?(): void;
  now?(): number;
}
interface LifecycleState {
  version: 1; pendingRuns: { id: string; at: number }[]; lastDay: string;
  proposals: AgentLifecycleProposal[]; trials: { agentId: string; version: number; result: TrialEvaluation }[];
  /** times of the feedback wakes delivered (the last day's, for the cap and the spacing) */
  wakes?: number[];
  /** keys the user dismissed, kept out of the queue until `until` */
  dismissed?: { key: string; until: number }[];
}
const KINDS: readonly AgentLifecycleProposal['kind'][] = ['update', 'create', 'merge', 'model-trial', 'split', 'keep', 'revert', 'retire'];
const local = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

export class AgentLifecycle {
  readonly feedback: FeedbackSource;
  private readonly file: string;
  private readonly policy: WakePolicy;
  private state: LifecycleState = { version: 1, pendingRuns: [], lastDay: '', proposals: [], trials: [] };
  private sending = false;
  problem: string | null = null;
  constructor(private readonly d: LifecycleDeps) {
    this.file = path.join(d.userData, 'agent-lifecycle.json');
    this.feedback = d.feedback ?? NO_FEEDBACK;
    this.policy = { ...WAKE_POLICY, ...d.wakePolicy };
    try {
      const raw = readLocal(this.file) as LifecycleState | undefined;
      if (raw === undefined) return;
      if (raw.version !== 1 || !Array.isArray(raw.pendingRuns) || raw.pendingRuns.length > 5000
        || !raw.pendingRuns.every(r => /^r_[a-f0-9]{12}$/.test(r.id) && Number.isFinite(r.at))
        || typeof raw.lastDay !== 'string' || !Array.isArray(raw.proposals) || raw.proposals.length > 1000
        || !raw.proposals.every(p => p.state === 'pending' && typeof p.key === 'string' && KINDS.includes(p.kind) && Array.isArray(p.agentIds) && Array.isArray(p.evidence))
        || !Array.isArray(raw.trials) || raw.trials.length > 1000
        || raw.wakes !== undefined && (!Array.isArray(raw.wakes) || raw.wakes.length > 100 || !raw.wakes.every(Number.isFinite))
        || raw.dismissed !== undefined && (!Array.isArray(raw.dismissed) || raw.dismissed.length > 2000 || !raw.dismissed.every(x => typeof x?.key === 'string' && Number.isFinite(x.until)))) throw Error('Invalid lifecycle');
      this.state = raw;
    } catch { this.problem = 'Registro del ciclo Agenti non leggibile: originale conservato.'; }
  }
  private now(): number { return this.d.now?.() ?? Date.now(); }
  private commit(next: LifecycleState): void {
    if (this.problem) throw Error(this.problem);
    writeLocal(this.file, next); this.state = next;
    this.d.changed?.();
  }
  private suppressed(key: string): boolean { const now = this.now(); return (this.state.dismissed ?? []).some(x => x.key === key && x.until > now); }
  proposals(): AgentLifecycleProposal[] { return structuredClone(this.state.proposals); }
  proposal(key: string): AgentLifecycleProposal | undefined { const p = this.state.proposals.find(x => x.key === key); return p && structuredClone(p); }
  evaluations(): LifecycleState['trials'] { return structuredClone(this.state.trials); }
  /** the runs waiting for the Orchestrator's opinion (tests, diagnostics) */
  queuedRuns(): string[] { return this.state.pendingRuns.map(r => r.id); }
  propose(proposal: AgentLifecycleProposal): void {
    if (this.suppressed(proposal.key)) return;
    const next = this.state.proposals.filter(p => p.key !== proposal.key);
    if (next.length >= 1000) throw Error('Coda proposte piena');
    this.commit({ ...this.state, proposals: [...next, structuredClone(proposal)] });
  }
  /** The user's decision ended this entry: out of the queue. dismiss = also kept out for a while (same key). */
  settle(key: string, dismissed: boolean): void {
    const p = this.state.proposals.find(x => x.key === key);
    if (!p) throw Error('Proposta non trovata: forse è già stata decisa.');
    const now = this.now(), decision = p.kind === 'keep' || p.kind === 'revert' || p.kind === 'retire';
    const kept = (this.state.dismissed ?? []).filter(x => x.until > now && x.key !== key).slice(-1999);
    this.commit({ ...this.state, proposals: this.state.proposals.filter(x => x.key !== key),
      dismissed: dismissed ? [...kept, { key, until: now + (decision ? DISMISS_DECISION_MS : DISMISS_SUGGESTION_MS) }] : kept });
  }
  /** A feedback record was just stored (by the authenticated writer): a gap named on two runs becomes a proposal. */
  onFeedback(f: AgentFeedback): void {
    const proposal = repeatedGap(this.feedback.list(f.agentId));
    if (proposal) this.propose(proposal);
  }
  /** An ended run waits for the Orchestrator's opinion, unless the user already judged it (the human verdict wins and
   *  needs no opinion), it is a one-shot (Battito) or a legacy v0 run. */
  onRunEnded(run: AgentRun): void {
    if (run.endedAt === undefined || run.version === 0 || run.source === 'oneshot' || run.outcome?.basis === 'human') return;
    if (this.state.pendingRuns.some(r => r.id === run.runId)) return;
    if (this.state.pendingRuns.length >= 5000) throw Error('Coda feedback piena');
    this.commit({ ...this.state, pendingRuns: [...this.state.pendingRuns, { id: run.runId, at: this.now() }] });
  }
  /** Call on the integrator's heartbeat. At most policy.perDay wakes a local day, policy.minGapMs apart, each one batch
   *  of up to 50 runs once policy.minBatch wait or the oldest waited policy.maxWaitMs. A refused delivery keeps the batch. */
  async flushWake(): Promise<'sent' | 'none' | 'held' | 'capped' | 'refused'> {
    if (this.sending || this.problem) return 'none';
    const now = this.now(), p = this.policy;
    // what no longer needs an opinion, or waited too long, leaves the queue without a wake
    const live = this.state.pendingRuns.filter(r => now - r.at < p.maxQueueAgeMs && (this.d.needsFeedback?.(r.id) ?? true));
    if (live.length !== this.state.pendingRuns.length) this.commit({ ...this.state, pendingRuns: live });
    const ready = live.filter(r => now - r.at >= p.minAgeMs);
    if (!ready.length) return 'none';
    if (ready.length < p.minBatch && now - Math.min(...ready.map(r => r.at)) < p.maxWaitMs) return 'held';
    const wakes = (this.state.wakes ?? []).filter(t => local(t) === local(now));
    if (wakes.length >= p.perDay || wakes.some(t => now - t < p.minGapMs)) return 'capped';
    const batch = ready.slice(0, 50);
    this.sending = true;
    try {
      if (!await this.d.wake(batch.map(r => r.id))) return 'refused';
      const ids = new Set(batch.map(r => r.id));
      this.commit({ ...this.state, pendingRuns: this.state.pendingRuns.filter(r => !ids.has(r.id)), wakes: [...wakes, now] });
      log.info('agents', 'feedback wake delivered to the Orchestrator', { data: { runs: batch.length, today: wakes.length + 1 } });
      return 'sent';
    } finally { this.sending = false; }
  }
  /** One trial's evaluation, persisted; a keep/revert result becomes the trial's proposal (the user decides). */
  evaluate(agent: AgentProfile, runs: readonly AgentRun[], parentWins: (run: AgentRun, parent: number) => boolean | null): TrialEvaluation {
    const result = evaluateTrial(agent, runs, this.now(), parentWins);
    if (!agent.trial) return result;
    const version = agent.trial.version;
    const old = this.state.trials.find(t => t.agentId === agent.id && t.version === version)?.result;
    const key = `trial:${agent.id}:${version}`;
    const current = this.state.proposals.find(p => p.key === key);
    const same = old && old.decision === result.decision && old.reason === result.reason && old.comparable === result.comparable
      && old.otherRuns === result.otherRuns && old.unknownRouting === result.unknownRouting && (result.decision === 'wait' ? !current : current?.kind === result.decision || this.suppressed(key));
    if (same) return result; // nothing new: no write, no change event
    const trials = this.state.trials.filter(t => t.agentId !== agent.id || t.version !== version);
    if (trials.length >= 1000) throw Error('Registro prove pieno');
    const proposals = this.state.proposals.filter(p => p.key !== key);
    if (result.decision !== 'wait' && !this.suppressed(key)) proposals.push({ key, kind: result.decision, agentIds: [agent.id], reason: result.reason,
      evidence: [], at: result.at, state: 'pending', metrics: { before: result.before, after: result.after } });
    if (proposals.length > 1000) throw Error('Coda proposte piena');
    this.commit({ ...this.state, trials: [...trials, { agentId: agent.id, version, result }], proposals });
    return result;
  }
  /** Every open trial, then the queue's trial/probation entries that no longer match the catalog are dropped (a trial
   *  closed on the agent page, an agent kept or retired by the user). */
  evaluateAll(agents: readonly AgentProfile[], runs: readonly AgentRun[], parentWins: (run: AgentRun, parent: number) => boolean | null): void {
    for (const a of agents) if (a.status === 'active' && a.trial) this.evaluate(a, runs, parentWins);
    this.reconcile(agents);
  }
  reconcile(agents: readonly AgentProfile[]): void {
    const stale = this.state.proposals.filter(p => !this.stillValid(p, agents));
    if (stale.length) this.commit({ ...this.state, proposals: this.state.proposals.filter(p => !stale.includes(p)) });
  }
  /** Does a trial/probation entry still describe the agent's state? (Other kinds always do.) */
  stillValid(p: AgentLifecycleProposal, agents: readonly AgentProfile[]): boolean {
    const m = /^(trial|probation):([^:]+)(?::(\d+))?$/.exec(p.key);
    if (!m) return true;
    const a = agents.find(x => x.id === m[2]);
    if (m[1] === 'trial') return !!a && a.status === 'active' && a.trial?.version === Number(m[3]) && a.activeVersion === a.trial.version;
    return !!a && a.status === 'active' && !!a.probation && !a.probation.keptBy;
  }
  /** The probation evaluator's verdict on an agent created for a task: a keep/retire proposal, never applied here. */
  onProbation(agent: AgentProfile, j: ProbationJudgement): void {
    const key = `probation:${agent.id}`;
    if (j.decision === 'wait') return;
    const current = this.state.proposals.find(p => p.key === key);
    if (current && current.kind === j.decision && current.reason === j.reason) return;
    this.propose({ key, kind: j.decision, agentIds: [agent.id], reason: j.reason, evidence: [], at: this.now(), state: 'pending' });
  }
  /** Local time follows the desktop. read() is lazy: no brain/history reads before idle + 18:00. */
  daily(idle: boolean, read: () => SuggestionInput): boolean {
    const now = this.now(), date = new Date(now);
    const day = local(now);
    if (!idle || date.getHours() < 18 || this.state.lastDay === day || this.problem) return false;
    const proposals = new Map(this.state.proposals.map(p => [p.key, p]));
    for (const p of suggestAgents(read(), now)) if (!this.suppressed(p.key)) proposals.set(p.key, p);
    if (proposals.size > 1000) throw Error('Coda proposte piena');
    this.commit({ ...this.state, proposals: [...proposals.values()], lastDay: day });
    return true;
  }
}
