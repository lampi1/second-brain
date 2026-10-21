// Outcome provenance shared by metrics and UI. Observed silence is a proxy, never independent verification.
import type { AgentRun, AgentRunOutcome } from './agents';

/** Observation window for the no-correction proxy, which never counts as verified success. */
export const FACTS_SETTLE_MS = 7 * 86_400_000;

/** Legacy names: success = no correction observed, fail = reported blockage/rework; both are unverified. */
export type FactsVerdict = 'success' | 'fail' | 'provisional' | 'unknown';
/** The bases that count as verified evidence: the user and a verified independent review. */
export type VerifiedBasis = 'human' | 'reviewed-evidence';
export const VERIFIED_BASES: readonly VerifiedBasis[] = ['human', 'reviewed-evidence'];
export interface VerifiedVerdict { verdict: Exclude<AgentRunOutcome['verdict'], 'unknown'>; basis: VerifiedBasis }

type FactsRun = Pick<AgentRun, 'endedAt' | 'report' | 'corrections' | 'counters'>;

/** Reopened by the user, or explicitly reworked by a run that started within FACTS_SETTLE_MS of its end.
 *  `reworkStarts` = when the runs that explicitly rework it started (run-metrics.ts indexRuns). */
export function reworkedWithin(run: FactsRun, reworkStarts: readonly number[] = []): boolean {
  if (run.endedAt === undefined) return false;
  const end = run.endedAt;
  return run.counters.reopened > 0 || reworkStarts.some(at => at >= end && at <= end + FACTS_SETTLE_MS);
}

/** The unverified observational proxy on a run at `now`. */
export function factsVerdict(run: FactsRun, reworkStarts: readonly number[] | undefined, now: number): FactsVerdict {
  if (run.endedAt === undefined) return 'unknown';
  if (reworkedWithin(run, reworkStarts)) return 'fail';
  const r = run.report;
  if (r?.outcome === 'blocked') return 'fail';
  if (!r || r.via !== 'agent_report' || r.outcome !== 'done' || r.verified !== 'yes') return 'unknown';
  // corrections missing = recorded before they were counted: unknown, never zero
  if (!run.corrections || run.corrections.tagged + run.corrections.afterReport > 0) return 'unknown';
  return now - run.endedAt < FACTS_SETTLE_MS ? 'provisional' : 'success';
}

/** The run's independently verified verdict: the user's, else one a verified independent review backs, never the silence proxy;
 *  null = none (no verdict, an opinion, the agent's own word, or facts still provisional or unknown). */
export function verifiedVerdict(run: FactsRun & Pick<AgentRun, 'outcome'>, _reworkStarts: readonly number[] | undefined, _now: number): VerifiedVerdict | null {
  const o = run.outcome;
  if (o && o.verdict !== 'unknown' && (o.basis === 'human' || o.basis === 'reviewed-evidence')) return { verdict: o.verdict, basis: o.basis };
  return null;
}

/** When the runs that explicitly rework each run started, by the run they point at (the same links as run-metrics). */
export function reworkStartsOf(runs: readonly Pick<AgentRun, 'reworkOf' | 'continuedFrom' | 'startedAt'>[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const r of runs) for (const target of new Set([r.reworkOf])) if (target) out.set(target, [...(out.get(target) ?? []), r.startedAt]);
  return out;
}
