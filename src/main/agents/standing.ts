// Agent standing: the level and the performance % on the front of an agent card (AgentCatalogCard), computed from
// agent-runs.json. Pure and deterministic (the caller passes `now`). Honest levels (ADR 0100, 0131; owner 2026-10-20: a
// bit of game, but only on verified data): only a VERIFIED success earns XP, never ended, failed or unverified runs,
// never the agent's own word, never silence; a success earns XP by the size of the job (xp.ts jobXp: 1..5 from its turns,
// working time, files changed and delegated chats), and the level follows xp.ts's curve (Lv 2 at 6 XP, top Lv 100).
// A run is verified (earnedVerdict, ADR 0125: every role must progress without the owner judging by hand) when:
// - the user gave it a verdict, or a verified independent review backs one (shared/run-verdict.ts verifiedVerdict);
// - receipts: the app's deterministic verdict decided it (ADR 0130, agents/receipts.ts: the repo's own checks passed
//   after its last change, or failed and its report agreed); recorded as the run's outcome by judge-sample.ts, or read
//   here from its receipts when an opinion or nothing stands in the way (ADR 0131: an Orchestrator's opinion on the run
//   used to block the receipts, so neither the role nor the Orchestrator got the XP);
// - chain: it is a delegated child whose agent_report met every criterion, with no correction, reopen or rework, that
//   reached its parent before the parent ended, and the parent run is itself verified (the user or a review accepted
//   the result built on it) and did not judge it badly (agent_child_feedback partial or fail);
// - graded: it is a Sentinel's verified review, and what happened later grades it: the user's verdict on the reviewed
//   run, else a later independent second review of it (judge-sample.ts audits a fixed share), else a fact against it
//   (it passed a run that was then reopened or reworked). Agreement is a success, one step off partial, opposite a fail.
// The performance (ADR 0131) is a Bayesian estimate: the verdicts, each weighted by how much it is trusted (TRUST: the
// user and a review × 1, a graded review × 0.8, the receipts × 0.7, the Orchestrator × 0.6, a decision signal and a chain
// × 0.5, a Flash outcome × 0.3, the agent's own report × 0) and by how recent it is (half weight every 30 days), update a
// Beta(1, 1) prior (centred on 50%); the card shows the posterior mean with its 90% spread (±). Below MIN_EVALUATED
// verdicts, or while the spread is wider than MAX_SPREAD, it stays null: "in rodaggio".
// The Orchestrator has no run of its own (its chat is permanent, ADR 0083): each ended root run it opened (startedBy
// "orchestrator", not a one-shot) is one of its decisions (ADR 0097, issue #112), rated with that run's verdict (its own
// verdict on such a run weighs as its own word) and, ADR 0131, with deterministic decision signals: the same task handed
// to another role (re-delegated) or reopened / reworked is a fail, a Strategist plan the user approved with no change a
// success (and PLAN_XP), with one or two changes a partial. A decision's XP is its job's size (with its delegated chats),
// halved when it was re-delegated or reworked. The decisions among pruned runs live on in the rollups
// (RunTally.decisions, decisionWins, decisionXp; the chain, graded and receipts successes in earnedWins, all XP in xp).
// Flash records no run: its answers' outcomes (flash-outcomes.ts) give it a small XP and a low-trust performance.
// Used by ChatManager.runMetrics (agents:metrics), run-metrics.ts rollUp, the levels diagnostic (level-diagnosis.ts) and
// the demo; the card's "?" tips repeat these rules.
import type { AgentMetrics, AgentRun, AgentStanding } from '../../shared/agents';
import { FLASH_ID } from '../../shared/roles';
import { reworkedWithin, reworkStartsOf, verifiedVerdict, type VerifiedBasis, type VerifiedVerdict } from '../../shared/run-verdict';
import type { RunTally } from './run-metrics';
import { receiptDecision } from './receipts';
import { FLASH_XP, LEGACY_XP, PLAN_XP, XP_MAX, jobSignals, jobXp, levelOf } from './xp';
import { settleDue, type FlashLog } from './flash-outcomes';

export { levelOf, levelStart, MAX_LEVEL } from './xp';
/** verdicts needed before the performance can show (with a spread no wider than MAX_SPREAD) */
export const MIN_EVALUATED = 5;
/** the widest 90% spread (±, 0..1) the card shows as a performance; wider = "in rodaggio" */
export const MAX_SPREAD = 0.3;
/** the Beta prior the verdicts update: Beta(1, 1), centred on 50%, worth two verdicts */
export const PRIOR = { mean: 0.5, weight: 2 } as const;
const Z90 = 1.645;
/** a verdict this old weighs half of one given today */
export const HALF_LIFE_MS = 30 * 86_400_000;
/** how much each kind of verdict counts; the agent's own word (self) counts nothing (ADR 0100) */
export const TRUST = { human: 1, review: 1, graded: 0.8, receipts: 0.7, facts: 0, orchestrator: 0.6, decision: 0.5, chain: 0.5, quick: 0.3, self: 0 } as const;
const SCORE = { success: 1, partial: 0.5, fail: 0 } as const;
const REPORTED = { done: 'success', partial: 'partial', blocked: 'fail' } as const;
type Source = keyof typeof TRUST;
type Verdict = keyof typeof SCORE;

/** Same exclusions as the §5 metrics (run-metrics.ts foldRun): headline and fallback one-shots are not the agent's work. */
export const counts = (r: AgentRun): boolean => r.endedAt !== undefined && !r.oneshot?.fallback && r.oneshot?.job !== 'headline';

/** A root run the Orchestrator opened: one of its decisions (ADR 0097). */
export const orchestratorDecision = (r: AgentRun): boolean => r.startedBy === 'orchestrator' && r.source !== 'oneshot' && !r.oneshot
  && !r.parentRunId && r.agentId !== 'orchestrator';

/** An ended, counted run that is one of the Orchestrator's decisions (what rollUp keeps in RunTally.decisions). */
export const countedDecision = (r: AgentRun): boolean => counts(r) && orchestratorDecision(r);

/** How a run earned its XP verdict (ADR 0125): the user, a verified review, the receipts, a verified parent, or a review
 *  graded by what happened later. `by` says what graded a review. */
export type EarnedBasis = VerifiedBasis | 'receipts' | 'chain' | 'graded';
export interface EarnedVerdict { verdict: Verdict; basis: EarnedBasis; by?: 'human' | 'audit' | 'facts' }
/** Lookups over every run known now: by id, the reviews of each run, the rework starts, the delegated children and the
 *  runs handed to another role; memoised verdicts. */
export interface EarnIndex {
  byId: Map<string, AgentRun>; reviews: Map<string, AgentRun[]>; starts: Map<string, number[]>; memo: Map<string, EarnedVerdict | null>;
  children: Map<string, number>; redelegated: Set<string>;
}
export function earnIndex(runs: readonly AgentRun[]): EarnIndex {
  const byId = new Map<string, AgentRun>(), reviews = new Map<string, AgentRun[]>(), children = new Map<string, number>();
  for (const r of runs) {
    byId.set(r.runId, r);
    if (r.reviewOf) reviews.set(r.reviewOf, [...(reviews.get(r.reviewOf) ?? []), r]);
    if (r.parentRunId) children.set(r.parentRunId, (children.get(r.parentRunId) ?? 0) + 1);
  }
  // the same task opened again with another role: the first choice of role was wrong (ADR 0131)
  const redelegated = new Set<string>();
  for (const r of runs) {
    const first = r.reworkOf ? byId.get(r.reworkOf) : undefined;
    if (first && r.agentId !== first.agentId && r.startedBy === 'orchestrator') redelegated.add(first.runId);
  }
  return { byId, reviews, starts: reworkStartsOf(runs), memo: new Map(), children, redelegated };
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
/** Why a delegated child gets no chain credit of its own (null = it qualifies, its parent permitting). Shared with the
 *  diagnostic (level-diagnosis.ts). */
export type ChainBlock = 'no-parent' | 'not-completed' | 'no-full-report' | 'late-report' | 'corrected' | 'judged-badly';
export function chainBlock(child: AgentRun, ix: EarnIndex): ChainBlock | null {
  const parent = ix.byId.get(child.parentRunId!), rep = child.report, o = child.outcome;
  if (!parent || parent.endedAt === undefined) return 'no-parent';
  if (child.endReason !== 'completed') return 'not-completed';
  if (!rep || rep.via !== 'agent_report' || rep.outcome !== 'done' || rep.verified !== 'yes') return 'no-full-report';
  if (rep.at > parent.endedAt) return 'late-report';
  if (!child.corrections || child.corrections.tagged + child.corrections.afterReport > 0 || reworkedWithin(child, ix.starts.get(child.runId))) return 'corrected';
  if (o && o.basis === 'orchestrator-opinion' && (o.verdict === 'partial' || o.verdict === 'fail')) return 'judged-badly';
  return null;
}
/** a delegated child's credit: its full report reached a parent that was then verified and did not judge it badly */
function chained(child: AgentRun, ix: EarnIndex, seen: Set<string>): EarnedVerdict | null {
  if (chainBlock(child, ix)) return null;
  const p = earned(ix.byId.get(child.parentRunId!)!, ix, seen);
  return p && p.verdict !== 'fail' ? { verdict: p.verdict, basis: 'chain' } : null;
}
/** Outcome bases an earned receipts verdict may stand above: the agent's own word, none, the Orchestrator's opinion. */
const OVERRIDABLE: ReadonlySet<string> = new Set(['self-report', 'unknown', 'orchestrator-opinion']);
/** The receipts' verdict on an ended run (ADR 0130): recorded as its outcome, or read from its receipts once their
 *  verdict is in on a completed run (ADR 0131: an opinion no longer hides it). Null = they decide nothing. */
export function receiptsVerdict(run: AgentRun): Verdict | null {
  const o = run.outcome;
  if (o?.basis === 'receipts' && o.verdict !== 'unknown') return o.verdict;
  if (run.endedAt === undefined || run.endReason !== 'completed' || !run.receipts?.verdict || (o && !OVERRIDABLE.has(o.basis))) return null;
  return receiptDecision(run)?.verdict ?? null;
}
function earned(run: AgentRun, ix: EarnIndex, seen: Set<string>): EarnedVerdict | null {
  if (ix.memo.has(run.runId)) return ix.memo.get(run.runId)!;
  if (seen.has(run.runId) || seen.size > 16) return null; // a cycle or an absurd depth: no credit
  seen.add(run.runId);
  const v = verifiedVerdict(run, ix.starts.get(run.runId), 0);
  const rc = run.endedAt === undefined || v ? null : receiptsVerdict(run);
  const out: EarnedVerdict | null = v ? { verdict: v.verdict, basis: v.basis }
    : run.endedAt === undefined ? null : rc ? { verdict: rc, basis: 'receipts' } : verifiedReview(run) ? graded(run, ix) : run.parentRunId ? chained(run, ix, seen) : null;
  ix.memo.set(run.runId, out);
  return out;
}
/** The run's verified verdict for the level (ADR 0100, 0125), or null: the user's, a verified review's, the receipts', a
 *  verified parent's (chain) or, for a review, the grade of what happened later. */
export const earnedVerdict = (run: AgentRun, ix: EarnIndex): EarnedVerdict | null => earned(run, ix, new Set());

/** The XP of one verified success: the size of its job (xp.ts), its delegated chats included. */
export const runXp = (run: AgentRun, ix: EarnIndex): number => jobXp(jobSignals(run, ix.children.get(run.runId) ?? 0));

/** An Orchestrator decision's deterministic signals (ADR 0131): handed to another role, reopened or reworked, and the
 *  Strategist plan's fate (clean = approved with no change, changed = after one or two, many = after three or more). */
export interface DecisionSignals { redelegated: boolean; reworked: boolean; plan: 'clean' | 'changed' | 'many' | null }
export function decisionSignals(d: AgentRun, ix: EarnIndex): DecisionSignals {
  const p = d.plan;
  return { redelegated: ix.redelegated.has(d.runId), reworked: reworkedWithin(d, ix.starts.get(d.runId)),
    plan: p?.approvedAt === undefined ? null : p.changes === 0 ? 'clean' : p.changes <= 2 ? 'changed' : 'many' };
}
/** The signals as one verdict on the decision (the worst of them); null = no signal (silence says nothing). */
export function routeVerdict(s: DecisionSignals): Verdict | null {
  if (s.redelegated || s.reworked || s.plan === 'many') return 'fail';
  return s.plan === 'changed' ? 'partial' : s.plan === 'clean' ? 'success' : null;
}
/** A decision's XP: its job's size when the job is a verified success (halved when re-delegated or reworked), plus
 *  PLAN_XP for a plan the user approved as proposed; at most XP_MAX. */
export function decisionXp(d: AgentRun, ix: EarnIndex, e: EarnedVerdict | null = earnedVerdict(d, ix)): number {
  const s = decisionSignals(d, ix), bad = s.redelegated || s.reworked;
  const job = e?.verdict === 'success' ? runXp(d, ix) * (bad ? 0.5 : 1) : 0;
  return Math.min(XP_MAX, job + (s.plan === 'clean' && !bad ? PLAN_XP : 0));
}

/** The most trusted verdict a run has, or null. A verdict "unknown" is no verdict. */
export function verdictOf(run: AgentRun, reviews: readonly AgentRun[] = [], _verified: VerifiedVerdict | null = null): { source: Source; verdict: Verdict } | null {
  const o = run.outcome, known = o && o.verdict !== 'unknown' ? o.verdict : null;
  if (known && o!.basis === 'human') return { source: 'human', verdict: known };
  if (known && o!.basis === 'reviewed-evidence') return { source: 'review', verdict: known };
  const reviewed = reviews.filter(v => v.endedAt !== undefined && v.report?.verified === 'yes' && v.report?.verdict).sort((a, b) => a.report!.at - b.report!.at)[0];
  if (reviewed) return { source: 'review', verdict: reviewed.report!.verdict! };
  if (known && o!.basis === 'receipts') return { source: 'receipts', verdict: known };
  if (known && o!.basis === 'orchestrator-opinion') return { source: 'orchestrator', verdict: known };
  if (known && o!.basis === 'self-report') return { source: 'self', verdict: known };
  if (run.report) return { source: 'self', verdict: REPORTED[run.report.outcome] };
  return null;
}

/** The posterior of the weighted verdicts (num = weighted score, den = weights) over the Beta prior: its mean and its
 *  90% spread (±, normal approximation). */
export function estimate(num: number, den: number): { mean: number; spread: number } {
  const a = PRIOR.mean * PRIOR.weight + num, b = (1 - PRIOR.mean) * PRIOR.weight + (den - num), n = a + b;
  return { mean: a / n, spread: Z90 * Math.sqrt(a * b / (n * n * (n + 1))) };
}

const noSources = (): AgentStanding['sources'] => ({ human: 0, review: 0, receipts: 0, graded: 0, facts: 0, orchestrator: 0, decision: 0, chain: 0, quick: 0, self: 0 });
interface Acc { runs: number; wins: number; xp: number; num: number; den: number; evaluated: number; sources: AgentStanding['sources'] }
function add(a: Acc, source: Source, verdict: Verdict, age: number): void {
  a.sources[source]++;
  if (TRUST[source] === 0) return;
  const w = TRUST[source] * 0.5 ** (Math.max(0, age) / HALF_LIFE_MS);
  a.evaluated++; a.num += w * SCORE[verdict]; a.den += w;
}

/** Level and performance of each agent with at least one run (ended or rolled up) or Flash answer, by agent id. */
export function standings(runs: readonly AgentRun[], rollups: readonly RunTally[], now: number, flash: FlashLog | null = null): Map<string, AgentStanding> {
  const ix = earnIndex(runs), { reviews, starts } = ix;
  const acc = new Map<string, Acc>();
  const of = (id: string) => {
    let a = acc.get(id);
    if (!a) acc.set(id, a = { runs: 0, wins: 0, xp: 0, num: 0, den: 0, evaluated: 0, sources: noSources() });
    return a;
  };
  for (const t of rollups) {
    const a = of(t.agentId), wins = t.verdicts.success + (t.earnedWins ?? 0);
    a.runs += t.ended; a.wins += wins; a.xp += t.xp ?? wins * LEGACY_XP;
    // the Orchestrator's decisions among the pruned runs (rollUp keeps their count, successes and XP, ADR 0097, 0131)
    if (t.decisions) of('orchestrator').runs += t.decisions;
    if (t.decisionWins) of('orchestrator').wins += t.decisionWins;
    if (t.decisionXp !== undefined || t.decisionWins) of('orchestrator').xp += t.decisionXp ?? (t.decisionWins ?? 0) * LEGACY_XP;
  }
  for (const r of runs) {
    if (!counts(r)) continue;
    const verified = verifiedVerdict(r, starts.get(r.runId), now), e = earnedVerdict(r, ix);
    const said = verdictOf(r, reviews.get(r.runId), verified);
    // a receipts verdict, a chain or a grade outranks an opinion and the agent's own word, never the user or a review
    const v = e && (e.basis === 'chain' || e.basis === 'graded' || e.basis === 'receipts') && (!said || (said.source !== 'human' && said.source !== 'review'))
      ? { source: e.basis as Source, verdict: e.verdict } : said;
    const age = now - r.endedAt!, own = of(r.agentId);
    own.runs++;
    if (e?.verdict === 'success') { own.wins++; own.xp += runXp(r, ix); }
    if (v) add(own, v.source, v.verdict, age);
    if (!orchestratorDecision(r)) continue;
    const o = of('orchestrator');
    o.runs++;
    if (e?.verdict === 'success') o.wins++;
    o.xp += decisionXp(r, ix, e);
    // the Orchestrator's own verdict on a run it opened is its own word when it is the one rated: self weight
    if (v) add(o, v.source === 'orchestrator' ? 'self' : v.source, v.verdict, age);
    const route = routeVerdict(decisionSignals(r, ix));
    if (route) add(o, 'decision', route, age);
  }
  if (flash) {
    const log = structuredClone(flash);
    settleDue(log, now);
    const settled = log.total.success + log.total.partial + log.total.fail;
    if (settled + log.open.length > 0) {
      const a = of(FLASH_ID);
      a.runs += settled + log.open.length; a.wins += log.total.success; a.xp += log.total.success * FLASH_XP;
      for (const d of log.done) add(a, 'quick', d.verdict, now - d.at);
    }
  }
  const out = new Map<string, AgentStanding>();
  for (const [id, a] of acc) {
    if (a.runs === 0) continue;
    const est = a.evaluated > 0 ? estimate(a.num, a.den) : null;
    const shown = !!est && a.evaluated >= MIN_EVALUATED && est.spread <= MAX_SPREAD;
    const xp = Math.round(a.xp * 100) / 100;
    out.set(id, { runs: a.runs, wins: a.wins, xp, ...levelOf(xp), performance: shown ? est.mean : null, spread: est ? est.spread : null,
      evaluated: a.evaluated, minRuns: MIN_EVALUATED, sources: a.sources });
  }
  return out;
}

/** The metrics with each agent's standing; an agent with a standing but no run of its own (the Orchestrator, rated by
 *  its decisions; Flash, by its answers) gets an entry without metrics, so its card shows its level too. */
export function withStandings(metrics: readonly AgentMetrics[], standing: ReadonlyMap<string, AgentStanding>): AgentMetrics[] {
  const out = metrics.map(m => { const s = standing.get(m.agentId); return s ? { ...m, standing: s } : m; });
  for (const [agentId, s] of standing) if (!metrics.some(m => m.agentId === agentId)) out.push({ agentId, versions: [], all: null, open: 0, standing: s });
  return out.sort((a, b) => a.agentId.localeCompare(b.agentId, 'en'));
}
