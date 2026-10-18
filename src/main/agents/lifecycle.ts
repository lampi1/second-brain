// Lifecycle coordinator for the main-process integrator: durable approval queue, batched end wakes and daily rules.
// The daily pass is entirely local ($0); it does not launch an LLM or write the brain/catalog.
import path from 'node:path';
import type { AgentProfile, AgentRun } from '../../shared/agents';
import type { AgentLifecycleProposal, TrialEvaluation } from '../../shared/agent-lifecycle';
import { AgentFeedbackStore, repeatedGap, type FeedbackInput } from './feedback';
import { readLocal, writeLocal } from './local-store';
import { suggestAgents, type SuggestionInput } from './suggestions';
import { evaluateTrial } from './trials';

export interface LifecycleDeps {
  userData: string;
  /** Deliver one labelled request through the Orchestrator mailbox; false means no recipient yet. */
  wake(runIds: string[]): boolean | Promise<boolean>;
  /** UI adapter shows these as Da approvare. It must not apply them from this callback. */
  changed?(): void;
  now?(): number;
}
interface LifecycleState {
  version: 1; pendingRuns: { id: string; at: number }[]; lastDay: string;
  proposals: AgentLifecycleProposal[]; trials: { agentId: string; version: number; result: TrialEvaluation }[];
}
export class AgentLifecycle {
  readonly feedback: AgentFeedbackStore;
  private readonly file: string;
  private state: LifecycleState = { version: 1, pendingRuns: [], lastDay: '', proposals: [], trials: [] };
  private sending = false;
  problem: string | null = null;
  constructor(private readonly d: LifecycleDeps) {
    this.file = path.join(d.userData, 'agent-lifecycle.json');
    this.feedback = new AgentFeedbackStore(d.userData);
    try {
      const raw = readLocal(this.file) as LifecycleState | undefined;
      if (raw === undefined) return;
      if (raw.version !== 1 || !Array.isArray(raw.pendingRuns) || raw.pendingRuns.length > 5000
        || !raw.pendingRuns.every(r => /^r_[a-f0-9]{12}$/.test(r.id) && Number.isFinite(r.at))
        || typeof raw.lastDay !== 'string' || !Array.isArray(raw.proposals) || raw.proposals.length > 1000
        || !raw.proposals.every(p => p.state === 'pending' && typeof p.key === 'string' && Array.isArray(p.agentIds) && Array.isArray(p.evidence))
        || !Array.isArray(raw.trials) || raw.trials.length > 1000) throw Error('Invalid lifecycle');
      this.state = raw;
    } catch { this.problem = 'Registro del ciclo Agenti non leggibile: originale conservato.'; }
  }
  private now(): number { return this.d.now?.() ?? Date.now(); }
  private commit(next: LifecycleState): void {
    if (this.problem) throw Error(this.problem);
    writeLocal(this.file, next); this.state = next;
    this.d.changed?.();
  }
  proposals(): AgentLifecycleProposal[] { return structuredClone(this.state.proposals); }
  evaluations(): LifecycleState['trials'] { return structuredClone(this.state.trials); }
  propose(proposal: AgentLifecycleProposal): void {
    const next = this.state.proposals.filter(p => p.key !== proposal.key);
    if (next.length >= 1000) throw Error('Coda proposte piena');
    this.commit({ ...this.state, proposals: [...next, structuredClone(proposal)] });
  }
  recordFeedback(run: AgentRun, input: FeedbackInput): void {
    const f = this.feedback.add(run, input, this.now());
    const proposal = repeatedGap(this.feedback.list(f.agentId));
    if (proposal) this.propose(proposal);
  }
  onRunEnded(run: AgentRun): void {
    if (run.endedAt === undefined || run.version === 0 || run.source === 'oneshot') return;
    if (this.state.pendingRuns.some(r => r.id === run.runId)) return;
    if (this.state.pendingRuns.length >= 5000) throw Error('Coda feedback piena');
    this.commit({ ...this.state, pendingRuns: [...this.state.pendingRuns, { id: run.runId, at: this.now() }] });
  }
  /** Call on the integrator's heartbeat. Failed mail keeps the durable batch for retry; never per turn. */
  async flushWake(): Promise<void> {
    if (this.sending || this.problem) return;
    const batch = this.state.pendingRuns.filter(r => this.now() - r.at >= 30_000).slice(0, 50);
    if (!batch.length) return;
    this.sending = true;
    try {
      if (await this.d.wake(batch.map(r => r.id))) {
        const ids = new Set(batch.map(r => r.id));
        this.commit({ ...this.state, pendingRuns: this.state.pendingRuns.filter(r => !ids.has(r.id)) });
      }
    } finally { this.sending = false; }
  }
  evaluate(agent: AgentProfile, runs: readonly AgentRun[], parentWins: (run: AgentRun, parent: number) => boolean | null): TrialEvaluation {
    const result = evaluateTrial(agent, runs, this.now(), parentWins);
    if (!agent.trial) return result;
    const version = agent.trial.version;
    const trials = this.state.trials.filter(t => t.agentId !== agent.id || t.version !== version);
    if (trials.length >= 1000) throw Error('Registro prove pieno');
    const key = `trial:${agent.id}:${version}`;
    const proposals = this.state.proposals.filter(p => p.key !== key);
    if (result.decision !== 'wait') proposals.push({ key, kind: result.decision, agentIds: [agent.id], reason: result.reason,
      evidence: [], at: result.at, state: 'pending', metrics: { before: result.before, after: result.after } });
    if (proposals.length > 1000) throw Error('Coda proposte piena');
    this.commit({ ...this.state, trials: [...trials, { agentId: agent.id, version, result }], proposals });
    return result;
  }
  /** Local time follows the desktop. read() is lazy: no brain/history reads before idle + 18:00. */
  daily(idle: boolean, read: () => SuggestionInput): boolean {
    const now = this.now(), date = new Date(now);
    const day = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    if (!idle || date.getHours() < 18 || this.state.lastDay === day || this.problem) return false;
    const proposals = new Map(this.state.proposals.map(p => [p.key, p]));
    for (const p of suggestAgents(read(), now)) proposals.set(p.key, p);
    if (proposals.size > 1000) throw Error('Coda proposte piena');
    this.commit({ ...this.state, proposals: [...proposals.values()], lastDay: day });
    return true;
  }
}
