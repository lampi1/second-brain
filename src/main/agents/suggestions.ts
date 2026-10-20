// The daily local rule of the "Da approvare" queue (ADR 0083): a role whose runs do clearly better, or as well for less,
// on another model tier within the same skill set gets a tier proposal (Artisan + air-test: mid 45% vs top 85% → top).
// Only verified outcomes count (the user's verdict, a verified independent review, the facts once settled: ADR 0100,
// shared/run-verdict.ts); nothing is applied here and no model is
// called. Pure: used by lifecycle.ts daily(), pinned by test/unit/agents/role-loop.test.ts.
import type { AgentProfile, AgentRun } from '../../shared/agents';
import type { AgentLifecycleProposal } from '../../shared/agent-lifecycle';
import { tierRank, type ModelTier } from '../../shared/roles';
import { skillSet } from './trials';
import { reworkStartsOf, verifiedVerdict, type VerifiedVerdict } from '../../shared/run-verdict';
import { CHECKPOINTS, newcombe } from '../../shared/evidence-stats';

export interface SuggestionInput { roles: readonly AgentProfile[]; runs: readonly AgentRun[] }
/** Fewest known outcomes on each side before a tier is compared: the first checkpoint (2026-10-20: at 5 vs 5 a +25 point
 *  rule proposed a false move up 14-16% of the time with two identical tiers, in simulation) */
export const TIER_MIN_KNOWN = CHECKPOINTS[0]!;
/** a cheaper tier may do this much worse (the lower end of the 90% interval of the difference) and still be proposed */
const DOWN_MARGIN = 0.1;
const WINDOW_MS = 30 * 86_400_000;

interface Tally { known: number; success: number; wins: number; cost: number | null; runs: AgentRun[] }
function tally(runs: AgentRun[], verdictOf: (r: AgentRun) => VerifiedVerdict | null): Tally {
  const known = runs.flatMap(r => { const v = verdictOf(r); return v ? [v] : []; });
  const wins = known.reduce((n, v) => n + (v.verdict === 'success' ? 1 : v.verdict === 'partial' ? 0.5 : 0), 0);
  return { known: known.length, success: known.length ? wins / known.length : 0, wins: known.filter(v => v.verdict === 'success').length, runs,
    cost: wins > 0 && runs.every(r => r.costUsd !== null) ? runs.reduce((n, r) => n + r.costUsd!, 0) / wins : null };
}
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function suggestTiers(input: SuggestionInput, now: number): AgentLifecycleProposal[] {
  const out: AgentLifecycleProposal[] = [];
  const starts = reworkStartsOf(input.runs), verdictOf = (r: AgentRun) => verifiedVerdict(r, starts.get(r.runId), now);
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
      const current = tally(byTier.get(role.tier) ?? [], verdictOf);
      if (current.known < TIER_MIN_KNOWN) continue;
      const skills = JSON.parse(key) as string[], label = skills.length ? `${role.name} con ${skills.join(', ')}` : role.name;
      let best: { tier: ModelTier; t: Tally; reason: string } | null = null;
      for (const [tier, runs] of byTier) {
        if (tier === role.tier) continue;
        const t = tally(runs, verdictOf);
        if (t.known < TIER_MIN_KNOWN) continue;
        // the 90% interval of the difference in successes (Newcombe), never the bare difference of two small rates
        const diff = newcombe(t.wins, t.known, current.wins, current.known);
        const up = tierRank(tier) > tierRank(role.tier) && !!diff && diff.low > 0;
        const down = tierRank(tier) < tierRank(role.tier) && !!diff && diff.low > -DOWN_MARGIN && t.cost !== null && current.cost !== null && t.cost <= current.cost * 0.7;
        if (!up && !down) continue;
        const reason = up ? `${label}: ${role.tier} ${pct(current.success)} di successo, ${tier} ${pct(t.success)}`
          : `${label}: ${tier} riesce come ${role.tier} (${pct(t.success)} contro ${pct(current.success)}) a ${(t.cost! / current.cost!).toFixed(2)}× il costo per successo`;
        if (!best || up && tierRank(tier) > tierRank(best.tier)) best = { tier, t, reason };
      }
      if (!best) continue;
      out.push({ key: `tier:${role.id}:${best.tier}:${key}`, kind: 'tier', agentIds: [role.id], tier: best.tier, skills, reason: best.reason, state: 'pending', at: now,
        evidence: [...current.runs, ...best.t.runs].filter(r => verdictOf(r)).slice(-16).map(r => ({ kind: 'run' as const, ref: r.runId, at: r.endedAt! })) });
    }
  }
  return out;
}
