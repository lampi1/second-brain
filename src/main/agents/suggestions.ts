// The daily local rule of the "Da approvare" queue (ADR 0083): a role whose runs do clearly better, or as well for less,
// on another model tier within the same skill set gets a tier proposal (Artisan + air-test: mid 45% vs top 85% → top).
// Only known outcomes count (the user's verdict, a Judge's independent review); nothing is applied here and no model is
// called. Pure: used by lifecycle.ts daily(), pinned by test/unit/agents/role-loop.test.ts.
import type { AgentProfile, AgentRun } from '../../shared/agents';
import type { AgentLifecycleProposal } from '../../shared/agent-lifecycle';
import { tierRank, type ModelTier } from '../../shared/roles';
import { skillSet } from './trials';

export interface SuggestionInput { roles: readonly AgentProfile[]; runs: readonly AgentRun[] }
/** Fewest known outcomes on each side before a tier is compared. */
export const TIER_MIN_KNOWN = 5;
const WINDOW_MS = 30 * 86_400_000;

interface Tally { known: number; success: number; cost: number | null; runs: AgentRun[] }
function tally(runs: AgentRun[]): Tally {
  const known = runs.filter(r => r.outcome && ['human', 'reviewed-evidence'].includes(r.outcome.basis) && r.outcome.verdict !== 'unknown');
  const wins = known.reduce((n, r) => n + (r.outcome!.verdict === 'success' ? 1 : r.outcome!.verdict === 'partial' ? 0.5 : 0), 0);
  return { known: known.length, success: known.length ? wins / known.length : 0, runs,
    cost: wins > 0 && runs.every(r => r.costUsd !== null) ? runs.reduce((n, r) => n + r.costUsd!, 0) / wins : null };
}
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function suggestTiers(input: SuggestionInput, now: number): AgentLifecycleProposal[] {
  const out: AgentLifecycleProposal[] = [];
  for (const role of input.roles.filter(r => r.scope === 'role' && r.id !== 'orchestrator' && !r.trial)) {
    const own = input.runs.filter(r => r.agentId === role.id && r.tier && r.endedAt !== undefined && r.endedAt <= now && now - r.endedAt < WINDOW_MS && r.source !== 'oneshot');
    const cohorts = new Map<string, Map<ModelTier, AgentRun[]>>();
    for (const r of own) {
      const key = skillSet(r);
      if (key === null) continue;
      const byTier = cohorts.get(key) ?? new Map<ModelTier, AgentRun[]>();
      byTier.set(r.tier!, [...(byTier.get(r.tier!) ?? []), r]);
      cohorts.set(key, byTier);
    }
    for (const [key, byTier] of cohorts) {
      const current = tally(byTier.get(role.tier) ?? []);
      if (current.known < TIER_MIN_KNOWN) continue;
      const skills = JSON.parse(key) as string[], label = skills.length ? `${role.name} con ${skills.join(', ')}` : role.name;
      let best: { tier: ModelTier; t: Tally; reason: string } | null = null;
      for (const [tier, runs] of byTier) {
        if (tier === role.tier) continue;
        const t = tally(runs);
        if (t.known < TIER_MIN_KNOWN) continue;
        const up = tierRank(tier) > tierRank(role.tier) && t.success >= current.success + 0.25 - 1e-9;
        const down = tierRank(tier) < tierRank(role.tier) && t.success >= current.success - 0.05 - 1e-9 && t.cost !== null && current.cost !== null && t.cost <= current.cost * 0.7;
        if (!up && !down) continue;
        const reason = up ? `${label}: ${role.tier} ${pct(current.success)} di successo, ${tier} ${pct(t.success)}`
          : `${label}: ${tier} riesce come ${role.tier} (${pct(t.success)} contro ${pct(current.success)}) a ${(t.cost! / current.cost!).toFixed(2)}× il costo per successo`;
        if (!best || up && tierRank(tier) > tierRank(best.tier)) best = { tier, t, reason };
      }
      if (!best) continue;
      out.push({ key: `tier:${role.id}:${best.tier}:${key}`, kind: 'tier', agentIds: [role.id], tier: best.tier, skills, reason: best.reason, state: 'pending', at: now,
        evidence: [...current.runs, ...best.t.runs].filter(r => r.outcome).slice(-16).map(r => ({ kind: 'run' as const, ref: r.runId, at: r.endedAt! })) });
    }
  }
  return out;
}
