// The verdict on a role run the app computes from facts it already has, with zero tokens (ADR 0100; owner, 2026-10-20:
// «non voglio giudicare io il lavoro»). A run is a verified success when it ended with an agent_report whose outcome is
// done with every done-criterion met, the user made no correction during it, and it was not reopened or reworked by the
// user within 7 days of its end (the rework signal of the §5 metrics: a reopen, or a new run that reworks or continues
// it). It is a failure when its report says blocked or the user reworked it within those 7 days; otherwise unknown.
// A would-be success is "provisional" until the 7 days have passed and counts nowhere yet. A verdict of the user (or
// one backed by a verified independent review) always wins over the facts. Computed on read, never stored: a later
// rework or verdict changes it at once. Pure: used by main (agents/run-metrics.ts, standing.ts, suggestions.ts,
// skills/suggest.ts) and the renderer (the run's outcome control, RunSurface.tsx); pinned by
// test/unit/agents/run-verdict.test.ts.
import type { AgentRun, AgentRunOutcome } from './agents';

/** how long a run's facts stay open: a rework within this time makes it a failure, a success counts only after it */
export const FACTS_SETTLE_MS = 7 * 86_400_000;

export type FactsVerdict = 'success' | 'fail' | 'provisional' | 'unknown';
/** The bases that count as verified evidence: the user, a verified independent review, the facts. */
export type VerifiedBasis = 'human' | 'reviewed-evidence' | 'facts';
export const VERIFIED_BASES: readonly VerifiedBasis[] = ['human', 'reviewed-evidence', 'facts'];
export interface VerifiedVerdict { verdict: Exclude<AgentRunOutcome['verdict'], 'unknown'>; basis: VerifiedBasis }

type FactsRun = Pick<AgentRun, 'endedAt' | 'report' | 'corrections' | 'counters'>;

/** Reopened by the user, or reworked / continued by a run that started within FACTS_SETTLE_MS of its end.
 *  `reworkStarts` = when the runs that rework or continue it started (run-metrics.ts indexRuns). */
export function reworkedWithin(run: FactsRun, reworkStarts: readonly number[] = []): boolean {
  if (run.endedAt === undefined) return false;
  const end = run.endedAt;
  return run.counters.reopened > 0 || reworkStarts.some(at => at <= end + FACTS_SETTLE_MS);
}

/** The facts' verdict on a run at `now`. */
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

/** The run's verified verdict: the user's, else one a verified independent review backs, else the facts' once settled;
 *  null = none (no verdict, an opinion, the agent's own word, or facts still provisional or unknown). */
export function verifiedVerdict(run: FactsRun & Pick<AgentRun, 'outcome'>, reworkStarts: readonly number[] | undefined, now: number): VerifiedVerdict | null {
  const o = run.outcome;
  if (o && o.verdict !== 'unknown' && (o.basis === 'human' || o.basis === 'reviewed-evidence')) return { verdict: o.verdict, basis: o.basis };
  const f = factsVerdict(run, reworkStarts, now);
  return f === 'success' || f === 'fail' ? { verdict: f, basis: 'facts' } : null;
}

/** When the runs that rework or continue each run started, by the run they point at (the same links as run-metrics). */
export function reworkStartsOf(runs: readonly Pick<AgentRun, 'reworkOf' | 'continuedFrom' | 'startedAt'>[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const r of runs) for (const target of new Set([r.reworkOf, r.continuedFrom])) if (target) out.set(target, [...(out.get(target) ?? []), r.startedAt]);
  return out;
}
