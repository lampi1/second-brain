// Agent standing: the level and the performance % on the front of an agent card (AgentCatalogCard), computed from
// agent-runs.json. Pure and deterministic (the caller passes `now`). Honest levels (ADR 0100, owner 2026-10-20: a bit of
// game, but only on verified data): the XP is the count of VERIFIED successful runs (the user's verdict, one a verified
// independent review backs, shared/run-verdict.ts), never ended, failed or unverified runs;
// the level grows with it on a gentle curve (each level asks 5 successes more than the one before). The performance is
// the success of the runs that have a verdict, each weighted by how much the verdict is trusted (the user, a review and
// the Orchestrator × 0.6, the agent's own report × 0: it never counts) and by how recent it is (half
// weight every 30 days). Below MIN_RUNS weighted verdicts it stays null: "in rodaggio".
// The Orchestrator has no run of its own (its chat is permanent, ADR 0083): each ended root run it opened (startedBy
// "orchestrator", not a one-shot) counts as one of its decisions, rated with that run's verdict (ADR 0097, issue #112); its own verdict on such a run weighs as its own word (self) on
// its own standing, and the decisions among pruned runs live on in the rollups (RunTally.decisions, decisionWins).
// Used by ChatManager.runMetrics (agents:metrics) and the demo; the card's "?" tips repeat these rules in Italian.
import type { AgentMetrics, AgentRun, AgentStanding } from '../../shared/agents';
import { reworkStartsOf, verifiedVerdict, type VerifiedVerdict } from '../../shared/run-verdict';
import type { RunTally } from './run-metrics';

/** verified successes each level asks more than the one before: Lv 2 at 5, Lv 3 at 15, Lv 4 at 30, Lv 5 at 50… */
export const LEVEL_STEP = 5;
export const MAX_LEVEL = 50;
/** weighted verdicts needed before the performance is shown */
export const MIN_RUNS = 5;
/** a verdict this old weighs half of one given today */
export const HALF_LIFE_MS = 30 * 86_400_000;
/** how much each kind of verdict counts; the agent's own word (self) counts nothing (ADR 0100) */
export const TRUST = { human: 1, review: 1, facts: 0, orchestrator: 0.6, self: 0 } as const;
const SCORE = { success: 1, partial: 0.5, fail: 0 } as const;
const REPORTED = { done: 'success', partial: 'partial', blocked: 'fail' } as const;
type Source = keyof typeof TRUST;
type Verdict = keyof typeof SCORE;

/** Verified successes needed to reach `level` (Lv 1 = 0). */
export const levelStart = (level: number): number => LEVEL_STEP * (level - 1) * level / 2;

/** The level of `wins` verified successes, where it started, where the next starts and the way there (0..1). */
export function levelOf(wins: number): Pick<AgentStanding, 'level' | 'levelAt' | 'nextAt' | 'progress'> {
  const n = Math.max(0, Math.floor(wins));
  let level = 1;
  while (level < MAX_LEVEL && levelStart(level + 1) <= n) level++;
  const levelAt = levelStart(level), nextAt = level < MAX_LEVEL ? levelStart(level + 1) : null;
  return { level, levelAt, nextAt, progress: nextAt === null ? 1 : (n - levelAt) / (nextAt - levelAt) };
}

/** Same exclusions as the §5 metrics (run-metrics.ts foldRun): headline and fallback one-shots are not the agent's work. */
const counts = (r: AgentRun): boolean => r.endedAt !== undefined && !r.oneshot?.fallback && r.oneshot?.job !== 'headline';

/** A root run the Orchestrator opened: one of its decisions (ADR 0097). */
export const orchestratorDecision = (r: AgentRun): boolean => r.startedBy === 'orchestrator' && r.source !== 'oneshot' && !r.oneshot
  && !r.parentRunId && r.agentId !== 'orchestrator';

/** An ended, counted run that is one of the Orchestrator's decisions (what rollUp keeps in RunTally.decisions). */
export const countedDecision = (r: AgentRun): boolean => counts(r) && orchestratorDecision(r);

/** The most trusted verdict a run has, or null. A verdict "unknown" is no verdict. `verified` = the run's verified
 *  verdict (shared/run-verdict.ts verifiedVerdict), when the caller computed it: the user's or a verified review's. */
export function verdictOf(run: AgentRun, reviews: readonly AgentRun[] = [], _verified: VerifiedVerdict | null = null): { source: Source; verdict: Verdict } | null {
  const o = run.outcome, known = o && o.verdict !== 'unknown' ? o.verdict : null;
  if (known && o!.basis === 'human') return { source: 'human', verdict: known };
  if (known && o!.basis === 'reviewed-evidence') return { source: 'review', verdict: known };
  const reviewed = reviews.filter(v => v.endedAt !== undefined && v.report?.verified === 'yes' && v.report?.verdict).sort((a, b) => a.report!.at - b.report!.at)[0];
  if (reviewed) return { source: 'review', verdict: reviewed.report!.verdict! };
  if (known && o!.basis === 'orchestrator-opinion') return { source: 'orchestrator', verdict: known };
  if (known && o!.basis === 'self-report') return { source: 'self', verdict: known };
  if (run.report) return { source: 'self', verdict: REPORTED[run.report.outcome] };
  return null;
}

/** Level and performance of each agent with at least one run (ended or rolled up), by agent id. */
export function standings(runs: readonly AgentRun[], rollups: readonly RunTally[], now: number): Map<string, AgentStanding> {
  const reviews = new Map<string, AgentRun[]>(), starts = reworkStartsOf(runs);
  for (const r of runs) if (r.reviewOf) reviews.set(r.reviewOf, [...(reviews.get(r.reviewOf) ?? []), r]);
  const acc = new Map<string, { runs: number; wins: number; num: number; den: number; evaluated: number; sources: AgentStanding['sources'] }>();
  const of = (id: string) => {
    let a = acc.get(id);
    if (!a) acc.set(id, a = { runs: 0, wins: 0, num: 0, den: 0, evaluated: 0, sources: { human: 0, review: 0, facts: 0, orchestrator: 0, self: 0 } });
    return a;
  };
  for (const t of rollups) {
    const a = of(t.agentId);
    a.runs += t.ended; a.wins += t.verdicts.success;
    // the Orchestrator's decisions among the pruned runs (rollUp keeps their count and their verified successes, ADR 0097)
    if (t.decisions) of('orchestrator').runs += t.decisions;
    if (t.decisionWins) of('orchestrator').wins += t.decisionWins;
  }
  for (const r of runs) {
    if (!counts(r)) continue;
    const verified = verifiedVerdict(r, starts.get(r.runId), now);
    const v = verdictOf(r, reviews.get(r.runId), verified);
    const decision = orchestratorDecision(r);
    for (const a of decision ? [of(r.agentId), of('orchestrator')] : [of(r.agentId)]) {
      a.runs++;
      if (verified?.verdict === 'success') a.wins++;
      if (!v) continue;
      // the Orchestrator's own verdict on a run it opened is its own word when it is the one rated: self weight
      const source: Source = decision && a === acc.get('orchestrator') && v.source === 'orchestrator' ? 'self' : v.source;
      a.sources[source]++;
      if (TRUST[source] === 0) continue;
      const age = Math.max(0, now - r.endedAt!), w = TRUST[source] * 0.5 ** (age / HALF_LIFE_MS);
      a.evaluated++;
      a.num += w * SCORE[v.verdict]; a.den += w;
    }
  }
  const out = new Map<string, AgentStanding>();
  for (const [id, a] of acc) {
    if (a.runs === 0) continue;
    out.set(id, { runs: a.runs, wins: a.wins, ...levelOf(a.wins), performance: a.evaluated >= MIN_RUNS && a.den > 0 ? a.num / a.den : null,
      evaluated: a.evaluated, minRuns: MIN_RUNS, sources: a.sources });
  }
  return out;
}

/** The metrics with each agent's standing; an agent with a standing but no run of its own (the Orchestrator, rated by
 *  its decisions) gets an entry without metrics, so its card shows its level too. */
export function withStandings(metrics: readonly AgentMetrics[], standing: ReadonlyMap<string, AgentStanding>): AgentMetrics[] {
  const out = metrics.map(m => { const s = standing.get(m.agentId); return s ? { ...m, standing: s } : m; });
  for (const [agentId, s] of standing) if (!metrics.some(m => m.agentId === agentId)) out.push({ agentId, versions: [], all: null, open: 0, standing: s });
  return out.sort((a, b) => a.agentId.localeCompare(b.agentId, 'en'));
}
