// Approval-only version evaluation: compare parent-compatible work with the frozen pre-trial baseline.
// Lifecycle adapters persist the result as a proposal; this module never changes a catalog version.
import type { AgentProfile, AgentRun, VersionMetrics } from '../../shared/agents';
import type { TrialEvaluation } from '../../shared/agent-lifecycle';
import { rollUp, runMetrics } from './run-metrics';

export const TRIAL_DAYS = 21 * 86_400_000;
/** Include related reviews/rework in the index without counting them in this agent's selected cohort. */
export function cohortMetrics(selected: readonly AgentRun[], all: readonly AgentRun[]): VersionMetrics | null {
  if (!selected.length) return null;
  return runMetrics([], { rollups: rollUp([], [...selected], [...all]) }).find(a => a.agentId === selected[0]!.agentId)?.all ?? null;
}
const lower = (before: number | null, after: number | null, factor: number): boolean => before !== null && before > 0 && after !== null && after <= before * factor;
const guard = (before: number | null, after: number | null): boolean => before !== null && after !== null && after <= before * 1.25;

/** parentWins must be captured/replayed by the classifier, never inferred from the trial verdict or outcome. */
export function evaluateTrial(agent: AgentProfile, runs: readonly AgentRun[], now: number,
  parentWins: (run: AgentRun, parent: number) => boolean | null): TrialEvaluation {
  const trial = agent.trial;
  const empty: TrialEvaluation = { decision: 'wait', reason: 'Nessuna prova aperta', at: now, before: null, after: null, other: null, comparable: 0, otherRuns: 0, unknownRouting: 0 };
  if (!trial || trial.baseline < 1 || trial.version < 1) return empty;
  const own = runs.filter(r => r.agentId === agent.id && r.endedAt !== undefined && r.source !== 'oneshot');
  const baseline = own.filter(r => r.version === trial.baseline && r.endedAt! <= trial.startedAt)
    .sort((a, b) => b.endedAt! - a.endedAt!).slice(0, 10);
  const candidates = own.filter(r => r.version === trial.version && r.startedAt >= trial.startedAt);
  const classified = candidates.map(run => ({ run, match: parentWins(run, trial.baseline) }));
  const matched = classified.filter(r => r.match === true).map(r => r.run);
  const other = classified.filter(r => r.match === false).map(r => r.run);
  const before = cohortMetrics(baseline, runs), after = cohortMetrics(matched, runs);
  const result = { ...empty, before, after, other: cohortMetrics(other, runs), comparable: matched.length,
    otherRuns: other.length, unknownRouting: classified.filter(r => r.match === null).length };
  // Inside the trial window missing evidence means "wait": verdicts arrive after a run ends (the user rates it later) and
  // comparable work accumulates; only at the end of the window does an inconclusive trial propose going back.
  const open = now - trial.startedAt < TRIAL_DAYS;
  if (candidates.length < 5 && open) return { ...result, reason: 'Campione ancora insufficiente' };
  const revert = (reason: string): TrialEvaluation => ({ ...result, decision: 'revert', reason });
  const short = (reason: string): TrialEvaluation => open ? { ...result, reason: `${reason}: in attesa` } : revert(reason);
  if (baseline.length < 5 || matched.length < 5 || !before || !after) return short('Campione comparabile insufficiente');
  if ((before.successRate.coverage ?? 0) < 0.6 || (after.successRate.coverage ?? 0) < 0.6) return short('Copertura degli esiti inferiore al 60%');
  const b = before.successRate.value!, a = after.successRate.value!;
  const findings = before.reviews.some(old => after.reviews.some(next => old.reviewer.agentId === next.reviewer.agentId
    && old.reviewer.version === next.reviewer.version && lower(old.findingsPerRun, next.findingsPerRun, 0.8)));
  const improved = a >= b + 0.05 - 1e-9 || lower(before.correctionsPerRun.value, after.correctionsPerRun.value, 0.8)
    || findings || before.reworkRate.value !== null && after.reworkRate.value !== null && after.reworkRate.value <= before.reworkRate.value - 0.05 + 1e-9;
  const safe = guard(before.costPerRun.median.value, after.costPerRun.median.value)
    && guard(before.timeToDone.elapsed.value, after.timeToDone.elapsed.value)
    && before.questionsPerRun.value !== null && after.questionsPerRun.value !== null && after.questionsPerRun.value <= before.questionsPerRun.value + 0.5;
  if (a < b - 0.05 - 1e-9) return revert('Successo peggiorato oltre 5 punti percentuali');
  if (!improved) return revert('Nessuna metrica primaria migliorata');
  if (!safe) return revert('Limiti di costo, tempo o domande non rispettati o dati mancanti');
  return { ...result, decision: 'keep', reason: 'Miglioramento misurato entro i limiti' };
}
