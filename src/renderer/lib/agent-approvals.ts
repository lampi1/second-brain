// The "Da approvare" inbox's read model and decisions (pure, no window): it gathers every pending change to an agent
// (Orchestrator definition proposals, learned-rule proposals, open version trials, agents in probation, lifecycle
// suggestions) from the existing typed IPC channels into one list, and maps each user decision to its one channel.
// Nothing here decides by itself: every write runs only from a click in components/AgentApprovals.tsx.
// Used by store/agent-approvals.ts (loading, sidebar count) and components/AgentApprovals.tsx (cards, undo).
import type { AgentDraft, AgentMetrics, AgentProfile, VersionMetrics } from '@shared/agents';
import { inProbation } from '@shared/agents';
import type { AgentProposal } from '@shared/agent-authoring';
import type { AgentLifecycleClient, AgentLifecycleProposal } from '@shared/agent-lifecycle';
import type { LearnedRuleProposal } from '@shared/agent-pack';
import type { Bridge } from '@shared/contract';

export interface ApprovalsClient { invoke: Bridge['invoke']; lifecycle: AgentLifecycleClient }

/** One changed field of a definition; null = not set (the engine's or the app's default applies). */
export interface FieldChange { field: DefinitionField; before: string | null; after: string | null }
export const DEFINITION_FIELDS = ['name', 'role', 'purpose', 'category', 'instructions', 'engine', 'model', 'effort', 'tools', 'permissionCeiling', 'manifest'] as const;
export type DefinitionField = typeof DEFINITION_FIELDS[number];

export type ApprovalItem =
  /** An Orchestrator proposal (a new agent or a changed definition): agents:proposalDecide. stale = the agent changed since. */
  | { type: 'definition'; key: string; at: number; proposal: AgentProposal; agent: AgentProfile | null; stale: boolean; changes: FieldChange[] }
  /** A learned rule an agent proposed for itself: agents:learnDecide. */
  | { type: 'rule'; key: string; at: number; rule: LearnedRuleProposal; agent: AgentProfile }
  /** An open version trial (pack update, approved rule): agents:trialDecide. advice = the lifecycle's keep/revert, when it has one. */
  | { type: 'trial'; key: string; at: number; agent: AgentProfile; advice: AgentLifecycleProposal | null; reason: string | null; before: VersionMetrics | null; after: VersionMetrics | null }
  /** A new agent (imported or made for a task) still being judged: agents:keep / agents:retire. */
  | { type: 'probation'; key: string; at: number; agent: AgentProfile; metrics: VersionMetrics | null }
  /** A lifecycle suggestion with no decision channel yet: it is prepared in the editor, where saving is the approval. */
  | { type: 'lifecycle'; key: string; at: number; proposal: AgentLifecycleProposal; agents: AgentProfile[] };
export type ApprovalSource = 'definitions' | 'lifecycle' | 'rules' | 'metrics';
export interface ApprovalsState { items: ApprovalItem[]; problems: ApprovalSource[]; lifecycleProblem: string | null }

const ORDER: Record<ApprovalItem['type'], number> = { definition: 0, rule: 1, trial: 2, probation: 3, lifecycle: 4 };

function show(field: DefinitionField, d: AgentDraft): string | null {
  const v = d[field];
  if (v === undefined || v === null || v === '') return null;
  if (field === 'tools') { const p = v as NonNullable<AgentDraft['tools']>; return [p.allow.join(', '), p.mcp?.length ? `MCP: ${p.mcp.join(', ')}` : ''].filter(Boolean).join(' · ') || '—'; }
  if (field === 'manifest') {
    const m = v as NonNullable<AgentDraft['manifest']>;
    const lines = Object.entries(m).filter(([, x]) => x !== undefined && (!Array.isArray(x) || x.length)).map(([k, x]) => `${k}: ${Array.isArray(x) ? x.join('; ') : String(x)}`);
    return lines.length ? lines.join('\n') : null;
  }
  return String(v);
}
/** The fields that differ between the current definition (absent for a new agent) and the proposed one. */
export function diffDefinition(before: AgentDraft | null | undefined, after: AgentDraft): FieldChange[] {
  return DEFINITION_FIELDS.flatMap(field => {
    const b = before ? show(field, before) : null, a = show(field, after);
    return b === a ? [] : [{ field, before: b, after: a }];
  });
}
export interface DiffLine { op: 'same' | 'add' | 'del'; text: string }
/** Line diff (LCS) of two texts; past ~250k cells it degrades to "all removed, all added" rather than freeze the UI. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before ? before.split(/\r?\n/) : [], b = after ? after.split(/\r?\n/) : [];
  if (a.length * b.length > 250_000) return [...a.map(text => ({ op: 'del' as const, text })), ...b.map(text => ({ op: 'add' as const, text }))];
  const w = b.length + 1, lcs = new Uint32Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    lcs[i * w + j] = a[i] === b[j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ op: 'same', text: a[i]! }); i++; j++; }
    else if (lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!) out.push({ op: 'del', text: a[i++]! });
    else out.push({ op: 'add', text: b[j++]! });
  }
  while (i < a.length) out.push({ op: 'del', text: a[i++]! });
  while (j < b.length) out.push({ op: 'add', text: b[j++]! });
  return out;
}

const versionOf = (m: AgentMetrics | undefined, version: number): VersionMetrics | null => m?.versions.find(v => v.version === version) ?? null;

/** Reads every source; one failing source is reported in `problems` and the others still show. The catalog is required. */
export async function gatherApprovals(c: ApprovalsClient): Promise<ApprovalsState> {
  const catalog = await c.invoke('agents:list', undefined);
  const active = catalog.profiles.filter(p => p.status === 'active'), all = [...catalog.profiles, ...catalog.archived];
  const [proposals, lifecycle, metrics, rules] = await Promise.allSettled([
    c.invoke('agents:proposals', undefined), c.lifecycle.read({}), c.invoke('agents:metrics', undefined),
    Promise.allSettled(active.map(p => c.invoke('agents:learnList', { id: p.id }))),
  ]);
  const problems: ApprovalSource[] = [];
  if (proposals.status === 'rejected') problems.push('definitions');
  if (lifecycle.status === 'rejected') problems.push('lifecycle');
  if (metrics.status === 'rejected') problems.push('metrics');
  const items: ApprovalItem[] = [];
  for (const p of proposals.status === 'fulfilled' ? proposals.value : []) {
    if (p.state !== 'pending') continue;
    const agent = p.agentId ? all.find(a => a.id === p.agentId) ?? null : null;
    const stale = !!p.agentId && (!agent || agent.updatedAt !== p.baseRevision);
    items.push({ type: 'definition', key: `def:${p.id}`, at: p.at, proposal: p, agent, stale, changes: diffDefinition(p.before ?? agent, p.draft) });
  }
  if (rules.status === 'fulfilled') {
    // an agent without its own know-how folder has no rule list: a refused read is not a problem worth showing
    if (active.length && rules.value.every(r => r.status === 'rejected')) problems.push('rules');
    rules.value.forEach((r, index) => {
      if (r.status !== 'fulfilled') return;
      for (const rule of r.value.proposals) if (rule.status === 'pending') items.push({ type: 'rule', key: `rule:${rule.id}`, at: rule.createdAt, rule, agent: active[index]! });
    });
  }
  const snapshot = lifecycle.status === 'fulfilled' ? lifecycle.value : null;
  const stats = metrics.status === 'fulfilled' ? metrics.value : [];
  for (const agent of active) {
    const m = stats.find(x => x.agentId === agent.id);
    if (agent.trial) {
      const trial = agent.trial, advice = snapshot?.proposals.find(p => p.key === `trial:${agent.id}:${trial.version}`) ?? null;
      const evaluation = snapshot?.evaluations.find(e => e.agentId === agent.id && e.version === trial.version)?.result;
      const before = advice?.metrics?.before ?? evaluation?.before ?? versionOf(m, trial.baseline), after = advice?.metrics?.after ?? evaluation?.after ?? versionOf(m, trial.version);
      items.push({ type: 'trial', key: `trial:${agent.id}:${trial.version}`, at: trial.startedAt, agent, advice, reason: advice?.reason ?? evaluation?.reason ?? null, before, after });
    } else if (inProbation(agent)) items.push({ type: 'probation', key: `probation:${agent.id}`, at: agent.probation!.since, agent, metrics: versionOf(m, agent.activeVersion) ?? m?.all ?? null });
  }
  // keep/revert advice belongs to its open trial (above); one whose trial is already closed has nothing left to decide
  for (const p of snapshot?.proposals ?? []) if (p.state === 'pending' && p.kind !== 'keep' && p.kind !== 'revert')
    items.push({ type: 'lifecycle', key: `life:${p.key}`, at: p.at, proposal: p, agents: p.agentIds.map(id => all.find(a => a.id === id)).filter((a): a is AgentProfile => !!a) });
  items.sort((x, y) => ORDER[x.type] - ORDER[y.type] || y.at - x.at);
  return { items, problems, lifecycleProblem: snapshot?.problem ?? null };
}

export type ApprovalDecision =
  | { type: 'definition'; accept: boolean }
  | { type: 'rule'; decision: 'approve' | 'discard' } | { type: 'rule'; decision: 'edit'; text: string }
  | { type: 'trial'; decision: 'keep' | 'rollback' }
  | { type: 'probation'; decision: 'keep' } | { type: 'probation'; decision: 'retire'; reason: string };
/** What a just-made decision can be taken back with, when its backend supports it. */
export interface ApprovalUndo { kind: 'definition-version' | 'definition-new' | 'rule-trial' | 'retire'; agentId: string; run(): Promise<unknown> }

/** Runs one decision through its typed channel; returns how to undo it, or null when it cannot be undone from here. */
export async function decideApproval(c: ApprovalsClient, item: ApprovalItem, d: ApprovalDecision): Promise<ApprovalUndo | null> {
  if (item.type === 'definition' && d.type === 'definition') {
    const profile = await c.invoke('agents:proposalDecide', { id: item.proposal.id, accept: d.accept });
    if (!d.accept || !profile) return null;
    if (item.agent) {
      const undo = { agentId: profile.id, expectedRevision: profile.updatedAt, operation: 'version' as const, version: item.agent.activeVersion };
      return { kind: 'definition-version', agentId: profile.id, run: () => c.invoke('agents:undo', undo) };
    }
    const undo = { agentId: profile.id, expectedRevision: profile.updatedAt, operation: 'archive' as const };
    return { kind: 'definition-new', agentId: profile.id, run: () => c.invoke('agents:undo', undo) };
  }
  if (item.type === 'rule' && d.type === 'rule') {
    const id = item.agent.id;
    await c.invoke('agents:learnDecide', { id, proposalId: item.rule.id, decision: d.decision, ...(d.decision === 'edit' ? { text: d.text } : {}) });
    if (d.decision === 'discard') return null;
    // an approved rule opens a trial: rolling that trial back is the undo
    const after = (await c.invoke('agents:list', undefined)).profiles.find(p => p.id === id);
    return after?.trial ? { kind: 'rule-trial', agentId: id, run: () => c.invoke('agents:trialDecide', { id, decision: 'rollback' }) } : null;
  }
  if (item.type === 'trial' && d.type === 'trial') { await c.invoke('agents:trialDecide', { id: item.agent.id, decision: d.decision }); return null; }
  if (item.type === 'probation' && d.type === 'probation') {
    const id = item.agent.id;
    if (d.decision === 'keep') { await c.invoke('agents:keep', { id }); return null; }
    await c.invoke('agents:retire', { id, reason: d.reason });
    return { kind: 'retire', agentId: id, run: () => c.invoke('agents:restore', { id }) };
  }
  throw new Error('Decision does not match the item');
}

/** Where a lifecycle suggestion is prepared: the editor of its (first known) agent, or a new definition. */
export const lifecycleTarget = (item: Extract<ApprovalItem, { type: 'lifecycle' }>): string =>
  item.proposal.kind === 'create' || !item.agents.length ? 'studio' : item.agents[0]!.id;
