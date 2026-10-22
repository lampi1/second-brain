// Agent standing: the level and the performance % on the front of an agent card (AgentCatalogCard), computed from
// agent-runs.json. Pure and deterministic (the caller passes `now`). Honest levels (ADR 0100, owner 2026-10-20: a bit of
// game, but only on verified data): the XP is the count of VERIFIED successful runs, never ended, failed or unverified
// runs; the level grows with it on a gentle curve (each level asks 5 successes more than the one before).
// A run is verified (earnedVerdict, ADR 0125: every role must progress without the owner judging by hand) when:
// - the user gave it a verdict, or a verified independent review backs one (shared/run-verdict.ts verifiedVerdict);
// - chain: it is a delegated child whose agent_report met every criterion, with no correction, reopen or rework, that
//   reached its parent before the parent ended, and the parent run is itself verified (the user or a review accepted
//   the result built on it) and did not judge it badly (agent_child_feedback partial or fail);
// - graded: it is a Sentinel's verified review, and what happened later grades it: the user's verdict on the reviewed
//   run, else a later independent second review of it (judge-sample.ts audits a fixed share), else a fact against it
//   (it passed a run that was then reopened or reworked). Agreement is a success, one step off partial, opposite a fail.
// Never the agent's own word, never silence. The performance is the success of the runs that have a verdict, each
// weighted by how much the verdict is trusted (TRUST: the user and a review × 1, a graded review × 0.8, the
// Orchestrator × 0.6, a chain × 0.5, the agent's own report × 0) and by how recent it is (half weight every 30 days).
// Below MIN_RUNS weighted verdicts it stays null: "in rodaggio".
// The Orchestrator has no run of its own (its chat is permanent, ADR 0083): each ended root run it opened (startedBy
// "orchestrator", not a one-shot) counts as one of its decisions, rated with that run's verdict (ADR 0097, issue #112); its own verdict on such a run weighs as its own word (self) on
// its own standing, and the decisions among pruned runs live on in the rollups (RunTally.decisions, decisionWins; the
// chain and graded successes in RunTally.earnedWins).
// Used by ChatManager.runMetrics (agents:metrics), run-metrics.ts rollUp and the demo; the card's "?" tips repeat these rules.
import type { AgentMetrics, AgentRun, AgentStanding } from '../../shared/agents';
import { reworkedWithin, reworkStartsOf, verifiedVerdict, type VerifiedBasis, type VerifiedVerdict } from '../../shared/run-verdict';
import type { RunTally } from './run-metrics';

/** verified successes each level asks more than the one before: Lv 2 at 5, Lv 3 at 15, Lv 4 at 30, Lv 5 at 50… */
export const LEVEL_STEP = 5;
export const MAX_LEVEL = 50;
/** weighted verdicts needed before the performance is shown */
export const MIN_RUNS = 5;
/** a verdict this old weighs half of one given today */
export const HALF_LIFE_MS = 30 * 86_400_000;
/** how much each kind of verdict counts; the agent's own word (self) counts nothing (ADR 0100) */
export const TRUST = { human: 1, review: 1, graded: 0.8, facts: 0, orchestrator: 0.6, chain: 0.5, self: 0 } as const;
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

/** How a run earned its XP verdict (ADR 0125): the user, a verified review, a verified parent, or a review graded by
 *  what happened later. `by` says what graded a review. */
export type EarnedBasis = VerifiedBasis | 'chain' | 'graded';
export interface EarnedVerdict { verdict: Verdict; basis: EarnedBasis; by?: 'human' | 'audit' | 'facts' }
/** Lookups over every run known now: by id, the reviews of each run, the rework starts; memoised verdicts. */
export interface EarnIndex { byId: Map<string, AgentRun>; reviews: Map<string, AgentRun[]>; starts: Map<string, number[]>; memo: Map<string, EarnedVerdict | null> }
export function earnIndex(runs: readonly AgentRun[]): EarnIndex {
  const byId = new Map<string, AgentRun>(), reviews = new Map<string, AgentRun[]>();
  for (const r of runs) { byId.set(r.runId, r); if (r.reviewOf) reviews.set(r.reviewOf, [...(reviews.get(r.reviewOf) ?? []), r]); }
  return { byId, reviews, starts: reworkStartsOf(runs), memo: new Map() };
}
/** the roles whose review runs are independent reviews (a Judge's before ADR 0100) */
const REVIEWERS: ReadonlySet<string> = new Set(['sentinel', 'judge']);
/** An ended, completed independent review that checked its evidence and gave a verdict on the run it reviews. */
export const verifiedReview = (r: AgentRun): boolean => !!r.reviewOf && REVIEWERS.has(r.agentId) && r.endedAt !== undefined && r.endReason === 'completed'
  && r.report?.verified === 'yes' && !!r.report.verdict;
/** how far two verdicts are: 0 agree, 0.5 one step off, 1 opposite */
const gap = (a: Verdict, b: Verdict): number => Math.abs(SCORE[a] - SCORE[b]);
const agreement = (a: Verdict, b: Verdict): Verdict => gap(a, b) === 0 ? 'success' : gap(a, b) === 0.5 ? 'partial' : 'fail';
/** grading a review: the user's verdict on the reviewed run, else a later independent review, else a fact against it */
function graded(review: AgentRun, ix: EarnIndex): EarnedVerdict | null {
  const target = ix.byId.get(review.reviewOf!), said = review.report!.verdict!;
  if (!target) return null;
  const o = target.outcome;
  if (o && o.basis === 'human' && o.verdict !== 'unknown') return { verdict: agreement(said, o.verdict), basis: 'graded', by: 'human' };
  const audit = (ix.reviews.get(target.runId) ?? []).filter(a => a !== review && a.chatId !== review.chatId && a.chatId !== target.chatId && verifiedReview(a)
    && a.startedAt >= review.endedAt!).sort((a, b) => a.startedAt - b.startedAt || a.runId.localeCompare(b.runId))[0];
  if (audit) return { verdict: agreement(said, audit.report!.verdict!), basis: 'graded', by: 'audit' };
  // facts only ever grade against: a run it passed was then reopened or reworked; silence never grades for
  if (said === 'success' && reworkedWithin(target, ix.starts.get(target.runId))) return { verdict: 'fail', basis: 'graded', by: 'facts' };
  return null;
}
/** a delegated child's credit: its full report reached a parent that was then verified and did not judge it badly */
function chained(child: AgentRun, ix: EarnIndex, seen: Set<string>): EarnedVerdict | null {
  const parent = ix.byId.get(child.parentRunId!), rep = child.report, o = child.outcome;
  if (!parent || parent.endedAt === undefined || child.endReason !== 'completed' || !rep || rep.via !== 'agent_report' || rep.outcome !== 'done' || rep.verified !== 'yes'
    || rep.at > parent.endedAt) return null;
  if (!child.corrections || child.corrections.tagged + child.corrections.afterReport > 0 || reworkedWithin(child, ix.starts.get(child.runId))) return null;
  if (o && o.basis === 'orchestrator-opinion' && (o.verdict === 'partial' || o.verdict === 'fail')) return null;
  const p = earned(parent, ix, seen);
  return p && p.verdict !== 'fail' ? { verdict: p.verdict, basis: 'chain' } : null;
}
function earned(run: AgentRun, ix: EarnIndex, seen: Set<string>): EarnedVerdict | null {
  if (ix.memo.has(run.runId)) return ix.memo.get(run.runId)!;
  if (seen.has(run.runId) || seen.size > 16) return null; // a cycle or an absurd depth: no credit
  seen.add(run.runId);
  const v = verifiedVerdict(run, ix.starts.get(run.runId), 0);
  const out: EarnedVerdict | null = v ? { verdict: v.verdict, basis: v.basis }
    : run.endedAt === undefined ? null : verifiedReview(run) ? graded(run, ix) : run.parentRunId ? chained(run, ix, seen) : null;
  ix.memo.set(run.runId, out);
  return out;
}
/** The run's verified verdict for the level (ADR 0100, 0125), or null: the user's, a verified review's, a verified
 *  parent's (chain) or, for a review, the grade of what happened later. */
export const earnedVerdict = (run: AgentRun, ix: EarnIndex): EarnedVerdict | null => earned(run, ix, new Set());

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
  const ix = earnIndex(runs), { reviews, starts } = ix;
  const acc = new Map<string, { runs: number; wins: number; num: number; den: number; evaluated: number; sources: AgentStanding['sources'] }>();
  const of = (id: string) => {
    let a = acc.get(id);
    if (!a) acc.set(id, a = { runs: 0, wins: 0, num: 0, den: 0, evaluated: 0, sources: { human: 0, review: 0, graded: 0, facts: 0, orchestrator: 0, chain: 0, self: 0 } });
    return a;
  };
  for (const t of rollups) {
    const a = of(t.agentId);
    a.runs += t.ended; a.wins += t.verdicts.success + (t.earnedWins ?? 0);
    // the Orchestrator's decisions among the pruned runs (rollUp keeps their count and their verified successes, ADR 0097)
    if (t.decisions) of('orchestrator').runs += t.decisions;
    if (t.decisionWins) of('orchestrator').wins += t.decisionWins;
  }
  for (const r of runs) {
    if (!counts(r)) continue;
    const verified = verifiedVerdict(r, starts.get(r.runId), now), e = earnedVerdict(r, ix);
    const said = verdictOf(r, reviews.get(r.runId), verified);
    // a chain or a grade outranks an opinion and the agent's own word, never the user or a review
    const v = e && (e.basis === 'chain' || e.basis === 'graded') && (!said || (said.source !== 'human' && said.source !== 'review')) ? { source: e.basis, verdict: e.verdict } : said;
    const decision = orchestratorDecision(r);
    for (const a of decision ? [of(r.agentId), of('orchestrator')] : [of(r.agentId)]) {
      a.runs++;
      if (e?.verdict === 'success') a.wins++;
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
