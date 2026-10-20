// The "Da approvare" inbox's read model and decisions (pure, no window): what changes a role's reach or cost and waits
// for the user (ADR 0083): an open version trial (a pack's skills, a new tier) with the loop's keep/revert advice, and
// the loop's tier suggestions, and the Battito's own proposals (approvals:list: a rule learned from the cards the user
// dismissed, ADR 0102). Role text and skills never wait here: the app applies them at once with an Annulla.
// Each user decision maps to its one channel (agents:trialDecide, agents:lifecycleDecide, approvals:decide). Nothing here decides by
// itself: every write runs only from a click in components/AgentApprovals.tsx. Used by store/agent-approvals.ts
// (loading, sidebar count) and components/AgentApprovals.tsx (cards).
import type { AgentMetrics, AgentProfile, VersionMetrics } from '@shared/agents';
import type { AgentLifecycleClient, AgentLifecycleProposal } from '@shared/agent-lifecycle';
import type { Bridge } from '@shared/contract';
import type { ApprovalItem as PulseApproval } from '@shared/pulse';

export interface ApprovalsClient { invoke: Bridge['invoke']; lifecycle: AgentLifecycleClient }

export type ApprovalItem =
  /** An open version trial: agents:trialDecide. advice = the loop's keep/revert, when it has one. */
  | { type: 'trial'; key: string; at: number; agent: AgentProfile; advice: AgentLifecycleProposal | null; reason: string | null; before: VersionMetrics | null; after: VersionMetrics | null }
  /** A tier suggestion: approve = agents:lifecycleDecide (a trial version on that tier opens), dismiss = hidden for a while. */
  | { type: 'lifecycle'; key: string; at: number; proposal: AgentLifecycleProposal; agents: AgentProfile[] }
  /** The Battito's proposal (a rule for its own instructions): approve or discard = approvals:decide. */
  | { type: 'pulse'; key: string; at: number; proposal: PulseApproval; agent: AgentProfile | null };
export type ApprovalSource = 'lifecycle' | 'metrics';
export interface ApprovalsState { items: ApprovalItem[]; problems: ApprovalSource[]; lifecycleProblem: string | null }

const ORDER: Record<ApprovalItem['type'], number> = { trial: 0, lifecycle: 1, pulse: 2 };

const versionOf = (m: AgentMetrics | undefined, version: number): VersionMetrics | null => m?.versions.find(v => v.version === version) ?? null;

/** Reads every source; one failing source is reported in `problems` and the others still show. The catalog is required. */
export async function gatherApprovals(c: ApprovalsClient): Promise<ApprovalsState> {
  const catalog = await c.invoke('agents:list', undefined);
  const roles = catalog.profiles.filter(p => p.scope === 'role');
  const [lifecycle, metrics, pulse] = await Promise.allSettled([c.lifecycle.read({}), c.invoke('agents:metrics', undefined), c.invoke('approvals:list', {})]);
  const snapshot = lifecycle.status === 'fulfilled' ? lifecycle.value : null;
  const problems: ApprovalSource[] = [];
  if (lifecycle.status === 'rejected') problems.push('lifecycle');
  if (metrics.status === 'rejected') problems.push('metrics');
  const items: ApprovalItem[] = [];
  const stats = metrics.status === 'fulfilled' ? metrics.value : [];
  for (const agent of roles) {
    if (!agent.trial) continue;
    const m = stats.find(x => x.agentId === agent.id), trial = agent.trial;
    const advice = snapshot?.proposals.find(p => p.key === `trial:${agent.id}:${trial.version}`) ?? null;
    const evaluation = snapshot?.evaluations.find(e => e.agentId === agent.id && e.version === trial.version)?.result;
    const before = advice?.metrics?.before ?? evaluation?.before ?? versionOf(m, trial.baseline), after = advice?.metrics?.after ?? evaluation?.after ?? versionOf(m, trial.version);
    items.push({ type: 'trial', key: `trial:${agent.id}:${trial.version}`, at: trial.startedAt, agent, advice, reason: advice?.reason ?? evaluation?.reason ?? null, before, after });
  }
  // trial advice belongs to its role's card (above); advice whose trial already ended has nothing left to decide
  for (const p of snapshot?.proposals ?? []) if (p.state === 'pending' && p.kind === 'tier')
    items.push({ type: 'lifecycle', key: `life:${p.key}`, at: p.at, proposal: p, agents: p.agentIds.map(id => roles.find(a => a.id === id)).filter((a): a is AgentProfile => !!a) });
  // the Battito's proposals (a source that fails or answers nothing adds none: they are not the roles' reach)
  const pulseItems = pulse.status === 'fulfilled' && Array.isArray(pulse.value) ? pulse.value : [];
  for (const p of pulseItems) if (p?.state === 'pending')
    items.push({ type: 'pulse', key: `pulse:${p.id}`, at: p.createdAt, proposal: p, agent: catalog.profiles.find(a => a.id === p.agentId) ?? null });
  items.sort((x, y) => ORDER[x.type] - ORDER[y.type] || y.at - x.at);
  return { items, problems, lifecycleProblem: snapshot?.problem ?? null };
}

export type ApprovalDecision =
  | { type: 'trial'; decision: 'keep' | 'rollback' }
  /** the lifecycle queue's own entry: a tier suggestion, or the advice on a trial card */
  | { type: 'queue'; decision: 'approve' | 'dismiss' }
  /** the Battito's proposal */
  | { type: 'pulse'; decision: 'approve' | 'discard' };
/** The queue entry a card carries, if any (decided with agents:lifecycleDecide). */
export const queueEntry = (item: ApprovalItem): AgentLifecycleProposal | null => (item.type === 'lifecycle' ? item.proposal : item.type === 'trial' ? item.advice : null);

/** Runs one decision through its typed channel. */
export async function decideApproval(c: ApprovalsClient, item: ApprovalItem, d: ApprovalDecision): Promise<void> {
  if (d.type === 'pulse') {
    if (item.type !== 'pulse') throw new Error('Decision does not match the item');
    const r = await c.invoke('approvals:decide', { id: item.proposal.id, decision: d.decision });
    if (!r.ok) throw new Error(r.error);
    return;
  }
  if (d.type === 'queue') {
    const entry = queueEntry(item);
    if (!entry) throw new Error('No queue entry on this item');
    await c.invoke('agents:lifecycleDecide', { key: entry.key, decision: d.decision });
    return;
  }
  if (item.type === 'trial') { await c.invoke('agents:trialDecide', { id: item.agent.id, decision: d.decision }); return; }
  throw new Error('Decision does not match the item');
}
