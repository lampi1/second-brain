// Approval-only version evaluation: compare the trial version's runs with the frozen pre-trial baseline over the same
// role × skill set (ADR 0083: the unit of comparison). The success rate counts verified verdicts only: the user's and a
// verified review's (shared/run-verdict.ts verifiedVerdict; the facts' proxy never counts since ADR 0100). Lifecycle
// adapters persist the result as a proposal; this module never changes a catalog version. Kept by ADR 0182: a trial
// still starts whenever the user approves a "Da approvare" proposal (catalog.ts approveTrial). Used by lifecycle.ts.
import type { AgentProfile, AgentRun, VersionMetrics } from '../../shared/agents';
import type { TrialEvaluation } from '../../shared/agent-lifecycle';
import { rollUp, runMetrics } from './run-metrics';
import { reworkStartsOf, verifiedVerdict } from '../../shared/run-verdict';
import { atCheckpoint, bootstrapDiff, CHECKPOINTS, newcombe, verdictOf } from '../../shared/evidence-stats';

/** an inconclusive trial waits for data up to this long, then its unproven change is proposed to go back */
export const TRIAL_MAX_DAYS = 60 * 86_400_000;
/** the baseline's most recent runs compared */
export const BASELINE_MAX = 40;
/** Include related reviews/rework in the index without counting them in this agent's selected cohort. */
export function cohortMetrics(selected: readonly AgentRun[], all: readonly AgentRun[], now = Date.now()): VersionMetrics | null {
  if (!selected.length) return null;
  return runMetrics([], { rollups: rollUp([], [...selected], [...all], now) }).find(a => a.agentId === selected[0]!.agentId)?.all ?? null;
}
const guard = (before: number | null, after: number | null): boolean => before !== null && after !== null && after <= before * 1.25;
/** The run's skill set as a key; null = a run recorded without tags (unknown, never a match). */
export const skillSet = (run: AgentRun): string | null => run.tags ? JSON.stringify([...run.tags.skills].sort()) : null;

/** The verified verdicts of some runs: successes out of the runs that have one. */
function verified(runs: readonly AgentRun[], all: readonly AgentRun[], now: number): { k: number; n: number } {
  const rework = reworkStartsOf(all);
  let k = 0, n = 0;
  for (const r of runs) {
    const v = verifiedVerdict(r, rework.get(r.runId), now);
    if (!v) continue;
    n++;
    if (v.verdict === 'success') k++;
  }
  return { k, n };
}
/** The user's corrections of each run that counted them. */
/** The runs in this order up to the one that makes the verified count reach its checkpoint (atCheckpoint), with that
 *  count: a side is judged at 20, 40, 80, 160 verified outcomes, not at every new run (against peeking). */
function upToCheckpoint(runs: readonly AgentRun[], all: readonly AgentRun[], now: number): { runs: AgentRun[]; k: number; n: number } {
  const cap = atCheckpoint(verified(runs, all, now).n), rework = reworkStartsOf(all), kept: AgentRun[] = [];
  let k = 0, n = 0;
  for (const r of runs) {
    if (n >= cap) break;
    kept.push(r);
    const v = verifiedVerdict(r, rework.get(r.runId), now);
    if (!v) continue;
    n++;
    if (v.verdict === 'success') k++;
  }
  return { runs: kept, k, n };
}
const corrections = (runs: readonly AgentRun[]): number[] => runs.flatMap(r => (r.corrections ? [r.corrections.tagged + r.corrections.afterReport] : []));
const pct = (x: number): string => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}`;

/** One trial against its frozen baseline (2026-10-20, replacing four metrics in OR with fixed thresholds on 5-10 runs,
 *  which proposed "keep" for two identical versions 20-30% of the time): the primary metric is the verified success rate
 *  (the user's, a verified review's or the facts' verdict, ADR 0100), compared with Newcombe's 90% interval; the user's
 *  corrections per run are the second signal (a seeded bootstrap interval); cost, time and questions are guardrails, never
 *  a reason to keep. A verdict only when both sides reach the first checkpoint (shared/evidence-stats.ts CHECKPOINTS);
 *  while the data are fewer the trial waits, up to TRIAL_MAX_DAYS, then an unproven change is proposed to go back. */
export function evaluateTrial(agent: AgentProfile, runs: readonly AgentRun[], now: number): TrialEvaluation {
  const trial = agent.trial;
  const empty: TrialEvaluation = { decision: 'wait', reason: 'Nessuna prova aperta', at: now, before: null, after: null, other: null, comparable: 0, otherRuns: 0, untagged: 0 };
  if (!trial || trial.baseline < 1 || trial.version < 1) return empty;
  const own = runs.filter(r => r.agentId === agent.id && r.endedAt !== undefined && r.source !== 'oneshot');
  const baseline = own.filter(r => r.version === trial.baseline && r.endedAt! <= trial.startedAt)
    .sort((a, b) => b.endedAt! - a.endedAt!).slice(0, BASELINE_MAX);
  const candidates = own.filter(r => r.version === trial.version && r.startedAt >= trial.startedAt);
  // comparable = a trial run whose skill set the baseline also ran; other = a skill set the baseline never had
  const sets = new Set(baseline.map(skillSet).filter((k): k is string => k !== null));
  const classified = candidates.map(run => { const k = skillSet(run); return { run, match: k === null ? null : sets.has(k) }; });
  const matched = classified.filter(r => r.match === true).map(r => r.run);
  const other = classified.filter(r => r.match === false).map(r => r.run);
  const before = cohortMetrics(baseline, runs, now), after = cohortMetrics(matched, runs, now);
  const result = { ...empty, before, after, other: cohortMetrics(other, runs, now), comparable: matched.length,
    otherRuns: other.length, untagged: classified.filter(r => r.match === null).length };
  const age = now - trial.startedAt;
  const revert = (reason: string): TrialEvaluation => ({ ...result, decision: 'revert', reason });
  const wait = (reason: string): TrialEvaluation => age < TRIAL_MAX_DAYS ? { ...result, reason } : revert(`${reason}: la prova è finita senza un effetto provato`);
  const need = CHECKPOINTS[0]!;
  const all = { b: verified(baseline, runs, now), a: verified(matched, runs, now) };
  if (all.b.n < need || all.a.n < need) return wait(`Dati insufficienti: esiti verificati ${all.a.n}/${need} nella prova, ${all.b.n}/${need} prima`);
  // each side at its checkpoint: the baseline's newest runs, the trial's first ones
  const vb = upToCheckpoint(baseline, runs, now), va = upToCheckpoint([...matched].sort((x, y) => x.endedAt! - y.endedAt!), runs, now);
  const success = newcombe(va.k, va.n, vb.k, vb.n);
  const fixes = bootstrapDiff(corrections(vb.runs), corrections(va.runs), { seed: trial.startedAt % 2 ** 31 });
  const worse = verdictOf(success, { before: vb.n, after: va.n }, 'higher') === 'peggiora';
  const improved = verdictOf(success, { before: vb.n, after: va.n }, 'higher') === 'aiuta'
    || verdictOf(fixes, { before: corrections(vb.runs).length, after: corrections(va.runs).length }, 'lower') === 'aiuta';
  const safe = !!before && !!after && guard(before.costPerRun.median.value, after.costPerRun.median.value)
    && guard(before.timeToDone.elapsed.value, after.timeToDone.elapsed.value)
    && before.questionsPerRun.value !== null && after.questionsPerRun.value !== null && after.questionsPerRun.value <= before.questionsPerRun.value + 0.5;
  const shown = `successo ${Math.round(va.k / va.n * 100)}% (${va.k}/${va.n}) contro ${Math.round(vb.k / vb.n * 100)}% (${vb.k}/${vb.n}), IC 90% ${pct(success!.low)}…${pct(success!.high)} punti`;
  if (worse) return revert(`Successo peggiorato: ${shown}`);
  if (improved && safe) return { ...result, decision: 'keep', reason: `Miglioramento provato: ${shown}` };
  if (improved) return revert(`Migliora, ma oltre i limiti di costo, tempo o domande: ${shown}`);
  // at the next checkpoint the interval is narrower: wait for it (never a decision at every run, against peeking)
  return wait(`Nessun effetto provato finora: ${shown}`);
}
