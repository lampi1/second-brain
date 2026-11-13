// The "Da approvare" queue of the roles' improvement loop (ADR 0083: the app owns it): the trial evaluations (a trial
// version against its baseline over the same role × skill set) and the daily local tier rule (suggestions.ts). Nothing
// here changes the catalog: every entry is a proposal the user approves or dismisses (lifecycle-api.ts decide, reached
// only through the sender-checked agents:lifecycleDecide IPC). Everything is local ($0): no model is woken for it.
// Used by loop.ts; the store is <userData>/agent-lifecycle.json (entries of kinds this build does not know are skipped).
import path from 'node:path';
import type { AgentProfile, AgentRun } from '../../shared/agents';
import type { AgentLifecycleProposal, TrialEvaluation } from '../../shared/agent-lifecycle';
import { NO_FEEDBACK, type FeedbackSource } from './feedback';
import { readLocal, writeLocal } from './local-store';
import { suggestTiers, type SuggestionInput } from './suggestions';
import { evaluateTrial } from './trials';

/** how long a dismissed key stays out of the queue */
export const DISMISS_DECISION_MS = 7 * 86_400_000;
export const DISMISS_SUGGESTION_MS = 14 * 86_400_000;

export interface LifecycleDeps {
  userData: string;
  /** the one feedback store (run-feedback.ts); none = no feedback yet */
  feedback?: FeedbackSource;
  /** UI adapter shows these as Da approvare. It must not apply them from this callback. */
  changed?(): void;
  now?(): number;
}
interface LifecycleState {
  version: 1; lastDay: string;
  proposals: AgentLifecycleProposal[]; trials: { agentId: string; version: number; result: TrialEvaluation }[];
  /** keys the user dismissed, kept out of the queue until `until` */
  dismissed?: { key: string; until: number }[];
}
const KINDS: readonly AgentLifecycleProposal['kind'][] = ['tier', 'keep', 'revert'];
const local = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

export class AgentLifecycle {
  readonly feedback: FeedbackSource;
  private readonly file: string;
  private state: LifecycleState = { version: 1, lastDay: '', proposals: [], trials: [] };
  problem: string | null = null;
  constructor(private readonly d: LifecycleDeps) {
    this.file = path.join(d.userData, 'agent-lifecycle.json');
    this.feedback = d.feedback ?? NO_FEEDBACK;
    try {
      const raw = readLocal(this.file) as Partial<LifecycleState> | undefined;
      if (raw === undefined) return;
      if (raw.version !== 1 || typeof raw.lastDay !== 'string' || !Array.isArray(raw.proposals) || raw.proposals.length > 1000 || !Array.isArray(raw.trials) || raw.trials.length > 1000
        || raw.dismissed !== undefined && (!Array.isArray(raw.dismissed) || raw.dismissed.length > 2000 || !raw.dismissed.every(x => typeof x?.key === 'string' && Number.isFinite(x.until)))) throw Error('Invalid lifecycle');
      const proposals = raw.proposals.filter(p => p?.state === 'pending' && typeof p.key === 'string' && KINDS.includes(p.kind) && Array.isArray(p.agentIds) && Array.isArray(p.evidence));
      this.state = { version: 1, lastDay: raw.lastDay, proposals, trials: raw.trials, ...(raw.dismissed ? { dismissed: raw.dismissed } : {}) };
    } catch { this.problem = 'Registro «Da approvare» non leggibile: originale conservato.'; }
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
    const now = this.now(), decision = p.kind === 'keep' || p.kind === 'revert';
    const kept = (this.state.dismissed ?? []).filter(x => x.until > now && x.key !== key).slice(-1999);
    this.commit({ ...this.state, proposals: this.state.proposals.filter(x => x.key !== key),
      dismissed: dismissed ? [...kept, { key, until: now + (decision ? DISMISS_DECISION_MS : DISMISS_SUGGESTION_MS) }] : kept });
  }
  /** One trial's evaluation, persisted; a keep/revert result becomes the trial's proposal (the user decides). */
  evaluate(agent: AgentProfile, runs: readonly AgentRun[]): TrialEvaluation {
    const result = evaluateTrial(agent, runs, this.now());
    if (!agent.trial) return result;
    const version = agent.trial.version;
    const old = this.state.trials.find(t => t.agentId === agent.id && t.version === version)?.result;
    const key = `trial:${agent.id}:${version}`;
    const current = this.state.proposals.find(p => p.key === key);
    const same = old && old.decision === result.decision && old.reason === result.reason && old.comparable === result.comparable
      && old.otherRuns === result.otherRuns && old.untagged === result.untagged && (result.decision === 'wait' ? !current : current?.kind === result.decision || this.suppressed(key));
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
  /** Every open trial, then the queue's entries that no longer match the catalog are dropped. */
  evaluateAll(roles: readonly AgentProfile[], runs: readonly AgentRun[]): void {
    for (const a of roles) if (a.trial) this.evaluate(a, runs);
    this.reconcile(roles);
  }
  reconcile(roles: readonly AgentProfile[]): void {
    const stale = this.state.proposals.filter(p => !this.stillValid(p, roles));
    if (stale.length) this.commit({ ...this.state, proposals: this.state.proposals.filter(p => !stale.includes(p)) });
  }
  /** Does an entry still describe its role? A trial entry needs that trial open; a tier entry a role not on that tier and
   *  with no trial open. */
  stillValid(p: AgentLifecycleProposal, roles: readonly AgentProfile[]): boolean {
    const a = roles.find(x => x.id === p.agentIds[0]);
    if (!a) return false;
    const m = /^trial:[^:]+:(\d+)$/.exec(p.key);
    if (m) return a.trial?.version === Number(m[1]) && a.activeVersion === a.trial.version;
    return p.kind === 'tier' && !!p.tier && a.tier !== p.tier && !a.trial;
  }
  /** Local time follows the desktop. read() is lazy: no history reads before idle + 18:00. */
  daily(idle: boolean, read: () => SuggestionInput): boolean {
    const now = this.now(), date = new Date(now);
    const day = local(now);
    if (!idle || date.getHours() < 18 || this.state.lastDay === day || this.problem) return false;
    const proposals = new Map(this.state.proposals.map(p => [p.key, p]));
    for (const p of suggestTiers(read(), now)) if (!this.suppressed(p.key)) proposals.set(p.key, p);
    if (proposals.size > 1000) throw Error('Coda proposte piena');
    this.commit({ ...this.state, proposals: [...proposals.values()], lastDay: day });
    return true;
  }
}
