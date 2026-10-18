// Local evidence rules for the daily approval queue. No model calls, catalog writes or inferred permissions.
import type { AgentEvidenceRef, AgentProfile, AgentRun } from '../../shared/agents';
import { GENERAL_AGENT_ID } from '../../shared/agents';
import type { AgentLifecycleProposal } from '../../shared/agent-lifecycle';
import { cohortMetrics } from './trials';

export interface WorkEvidence { kind: string; area: string; at: number; ref: AgentEvidenceRef; source: 'general' | 'error' | 'retired' }
export interface ModelCohort { agentId: string; cohort: string; model: string; success: number; known: number; ended: number; costPerSuccess: number | null; evidence: AgentEvidenceRef[] }
export interface SuggestionInput { agents: readonly AgentProfile[]; runs: readonly AgentRun[]; work: readonly WorkEvidence[]; models: readonly ModelCohort[] }
export function instructionOverlap(a: string, b: string): number {
  const tokens = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []);
  const x = tokens(a), y = tokens(b);
  const common = [...x].filter(t => y.has(t)).length;
  return x.size + y.size ? common / (x.size + y.size - common) : 0;
}
export function suggestAgents(input: SuggestionInput, now: number): AgentLifecycleProposal[] {
  const out: AgentLifecycleProposal[] = [];
  const propose = (p: Omit<AgentLifecycleProposal, 'state' | 'at'>) => out.push({ ...p, state: 'pending', at: now });
  const groups = new Map<string, WorkEvidence[]>();
  for (const w of input.work) {
    if (!w.area || !w.kind || w.at > now || w.at < now - 14 * 86_400_000) continue;
    const key = JSON.stringify([w.source, w.kind, w.area]);
    const rows = groups.get(key) ?? [];
    if (!rows.some(r => r.ref.kind === w.ref.kind && r.ref.ref === w.ref.ref)) rows.push(w);
    groups.set(key, rows);
  }
  for (const [key, rows] of groups) {
    const w = rows[0]!;
    if (rows.length < (w.source === 'general' ? 3 : 2)) continue;
    propose({ key: `work:${key}`, kind: 'create', agentIds: [], reason: `${rows.length} ricorrenze di ${w.kind} in ${w.area}`,
      evidence: rows.map(r => r.ref).slice(-16) });
  }
  const active = input.agents.filter(a => a.status === 'active' && a.routable !== false && a.id !== GENERAL_AGENT_ID);
  for (let i = 0; i < active.length; i++) for (const b of active.slice(i + 1)) {
    const a = active[i]!, overlap = instructionOverlap(a.instructions, b.instructions);
    if (overlap > 0.7) propose({ key: `merge:${[a.id, b.id].sort().join(':')}`, kind: 'merge', agentIds: [a.id, b.id],
      reason: `Istruzioni sovrapposte al ${Math.round(overlap * 100)}%`, evidence: [] });
  }
  const eligible = input.models.filter(m => active.some(a => a.id === m.agentId && a.model === m.model)
    && m.known >= 5 && m.ended >= m.known && m.known / m.ended >= 0.6 && m.costPerSuccess !== null && Number.isFinite(m.costPerSuccess));
  const expensive = [...eligible].sort((a, b) => b.costPerSuccess! - a.costPerSuccess!)[0];
  if (expensive) {
    const cheaper = input.models.filter(m => m.agentId === expensive.agentId && m.cohort === expensive.cohort && m.model !== expensive.model
      && m.known >= 5 && m.known <= m.ended && m.known / m.ended >= 0.6 && m.success >= expensive.success
      && m.costPerSuccess !== null && m.costPerSuccess < expensive.costPerSuccess!).sort((a, b) => a.costPerSuccess! - b.costPerSuccess!)[0];
    if (cheaper) propose({ key: `model:${expensive.agentId}:${cheaper.model}`, kind: 'model-trial', agentIds: [expensive.agentId],
      model: cheaper.model, reason: `Prova del modello ${cheaper.model}: minor costo per successo nello stesso gruppo`, evidence: [...expensive.evidence, ...cheaper.evidence].slice(-16) });
  }
  for (const agent of active) {
    const own = input.runs.filter(r => r.agentId === agent.id && r.version > 0 && r.endedAt !== undefined && r.endedAt <= now);
    const slices = new Map<string, AgentRun[]>();
    for (const r of own) for (const tag of [...(r.tags?.skills ?? []).map(s => `skill:${s}`), ...(r.tags?.app ? [`app:${r.tags.app}`] : [])]) {
      const rows = slices.get(tag) ?? []; rows.push(r); slices.set(tag, rows);
    }
    for (const [tag, slice] of slices) {
      if (slice.length < 10) continue;
      const ids = new Set(slice.map(r => r.runId)), rest = own.filter(r => !ids.has(r.runId));
      const before = cohortMetrics(rest, input.runs), after = cohortMetrics(slice, input.runs);
      if (!before || !after) continue;
      const success = before.successRate.value !== null && after.successRate.value !== null
        && after.successRate.value <= before.successRate.value - 0.15 + 1e-9;
      const corrections = before.correctionsPerRun.value !== null && before.correctionsPerRun.value > 0 && after.correctionsPerRun.value !== null
        && after.correctionsPerRun.value >= before.correctionsPerRun.value * 2;
      if (success || corrections) propose({ key: `split:${agent.id}:${tag}`, kind: 'split', agentIds: [agent.id],
        reason: `Prestazioni inferiori nel gruppo ${tag}`, evidence: slice.slice(-16).map(r => ({ kind: 'run', ref: r.runId, at: r.endedAt! })), metrics: { before, after } });
    }
  }
  return out;
}
