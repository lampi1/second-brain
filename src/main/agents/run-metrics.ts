// Role metrics and pruned-run rollups used by agent cards. Verified quality uses only human or independent evidence;
// self-reports and observation proxies do not enter success. Costs and usage retain their own data coverage.
import type { DeliveryMetrics, AgentMetrics, AgentRun, AgentRunTokens, AgentRunOutcome, Metric, VersionMetrics } from '../../shared/agents';
import { counts, countedDecision, decisionXp, earnIndex, earnedVerdict, runXp, unrated } from './standing';
import { FACTS_SETTLE_MS, reworkStartsOf, reworkedWithin, verifiedVerdict } from '../../shared/run-verdict';
import { VERDICT_WEIGHT } from '../../shared/success';
import { LEGACY_XP } from './xp';
import { roleJudges } from './judge-agreement';

/** the newest values kept per sample for medians (n counts them all) */
export const SAMPLE_MAX = 200;
/** a new run continuing or reworking an ended one within this time makes the ended one reworked */
export const REWORK_MS = FACTS_SETTLE_MS;
const TOKEN_KINDS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const;
type TokenKind = keyof AgentRunTokens;

/** sum: of all n values (the values list keeps only the last SAMPLE_MAX); missing on samples saved before it was kept (#125) */
export interface Sample { n: number; values: number[]; sum?: number }
export interface Verdicts { success: number; partial: number; fail: number }
export interface ReviewTally { runs: number; findings: number; blockingRuns: number; blocking: number }
/** Additive per (agentId, version): the kept runs fold into one; the pruned ones live on as one (agent-runs.json `rollups`). */
export interface RunTally {
  agentId: string; version: number;
  /** The current rollup excludes silence proxies; older aggregate verdicts have no recoverable provenance. */
  verdictSchema?: 2;
  ended: number;
  /** Verified only: basis human or reviewed-evidence. */
  verdicts: Verdicts;
  /** never in the rate: the Orchestrator's opinion, and the agent's own word (outcome self-report or its run-report) */
  opinion: Verdicts; selfReport: Verdicts;
  /** runs whose corrections were counted (recorded since A6) and their sums */
  corrections: { runs: number; tagged: number; afterReport: number };
  /** ai-errors.md lines naming the run, seen by Brother: runs checked against the file, and lines */
  reworked: number;
  // no permissions count nor context peak (ADR 0186): with every role's permissions on by default the first was 0 on
  // every run, and no page showed the second; an older rollup's fields are dropped on load (runs.ts readTally)
  questions: number; commands: number;
  cost: Sample; tokens: Record<TokenKind, Sample>; elapsed: Sample; execution: Sample;
  /** findings on this key's runs, per Reviewer `agentId/version`: the first parsed review of each run */
  reviews: Record<string, ReviewTally>;
  /** the same counts per run tag (AGENTS-DESIGN §4.8), for filtered metrics over pruned runs; untagged runs are in none */
  tags?: TagTallies;
  /** of these runs, the Orchestrator's decisions (standing.ts orchestratorDecision): kept so its record survives a prune */
  decisions?: number;
  /** of those decisions, the verified successes at prune time: the Orchestrator's level (its XP, ADR 0100) */
  decisionWins?: number;
  /** successes earned at prune time by a verified parent (chain), a review's grade or the receipts (standing.ts earnedVerdict,
   *  ADR 0125, 0130): XP that `verdicts` (verified runs only) does not hold */
  earnedWins?: number;
  /** the XP of this key's verified successes at prune time (verdicts.success + earnedWins, each by its job's size, ADR
   *  0131); missing on a rollup pruned before: each of its successes counts LEGACY_XP */
  xp?: number;
  /** the Orchestrator's XP from these decisions at prune time (standing.ts decisionXp); missing: decisionWins × LEGACY_XP */
  decisionXp?: number;
  /** fitRollups dropped `tags` to stay in budget: later prunes do not rebuild a partial set, and filters leave this rollup out */
  tagsLost?: true;
}
/** Counts only (no samples): what a filtered metric can still say about pruned runs. */
export type TagTally = Pick<RunTally, 'ended' | 'verdicts' | 'opinion' | 'selfReport' | 'corrections' | 'reworked' | 'questions' | 'commands'>;
export interface TagTallies { skills: Record<string, TagTally>; apps: Record<string, TagTally>; repos: Record<string, TagTally>; combined?: Record<string, TagTally> }
/** JSON tuple avoids collisions between arbitrary app/repo names and absent dimensions. */
export const tagFilterKey = (f: TagFilter): string => JSON.stringify([f.skill ?? null, f.app ?? null, f.repo ?? null]);
/** One tag filter per dimension; together they must all match. */
export interface TagFilter { skill?: string; app?: string; repo?: string }
export interface MetricsInput {
  rollups?: readonly RunTally[];
  /** only runs ended from then on; the rollups (older by construction) are then left out */
  since?: number;
  /** the clock for the facts' verdict (default: now) */
  now?: number;
  /** Only runs whose tags match; untagged runs never match. Rollups retain counts for combined filters too. */
  filter?: TagFilter;
  /** Whether an open run still belongs to a chat in the app (not closed, not gone, still its current run): a run left
   *  open by a crash or a chat that went away is not "in corso" (the Agenti card, 2026-10-22). Absent = every open run. */
  live?: (run: AgentRun) => boolean;
}

const emptySample = (): Sample => ({ n: 0, values: [], sum: 0 });
const verdicts = (): Verdicts => ({ success: 0, partial: 0, fail: 0 });
export function emptyTally(agentId: string, version: number): RunTally {
  return { agentId, version, verdictSchema: 2, ended: 0, verdicts: verdicts(), opinion: verdicts(), selfReport: verdicts(), corrections: { runs: 0, tagged: 0, afterReport: 0 },
    reworked: 0, questions: 0, commands: 0, cost: emptySample(), tokens: { input: emptySample(), output: emptySample(), cacheRead: emptySample(), cacheWrite: emptySample() },
    elapsed: emptySample(), execution: emptySample(), reviews: {} };
}
const push = (s: Sample, v: number): void => { s.n++; if (s.sum !== undefined) s.sum += v; s.values.push(v); if (s.values.length > SAMPLE_MAX) s.values.splice(0, s.values.length - SAMPLE_MAX); };
const addVerdict = (v: Verdicts, verdict: AgentRunOutcome['verdict']): void => { if (verdict !== 'unknown') v[verdict]++; };
const REPORTED = { done: 'success', partial: 'partial', blocked: 'fail' } as const;
const keyOf = (agentId: string, version: number): string => `${agentId}/${version}`;

/** Lookups over every run known at fold time: reworks and reviews point at runs by id; `now` settles the facts. */
export interface RunIndex { reworkStarts: Map<string, number[]>; reviews: Map<string, AgentRun[]>; now: number }
export function indexRuns(all: readonly AgentRun[], now = Date.now()): RunIndex {
  const reviews = new Map<string, AgentRun[]>();
  for (const r of all) if (r.reviewOf) reviews.set(r.reviewOf, [...(reviews.get(r.reviewOf) ?? []), r]);
  return { reworkStarts: reworkStartsOf(all), reviews, now };
}

/** Adds one ended run (an open one is ignored: the unit is the ended run). */
export function foldRun(t: RunTally, run: AgentRun, index: RunIndex): void {
  if (run.endedAt === undefined) return;
  // Headline and fallback runs are not comparable with the agent version's card/task baseline.
  // Their complete cost ledger remains available under Battito's job budgets.
  if (run.oneshot?.fallback || run.oneshot?.job === 'headline') return;
  t.ended++;
  const o = run.outcome, starts = index.reworkStarts.get(run.runId);
  const verified = verifiedVerdict(run, starts, index.now);
  if (verified) addVerdict(t.verdicts, verified.verdict);
  if (o?.basis === 'orchestrator-opinion') addVerdict(t.opinion, o.verdict);
  if (o?.basis === 'self-report') addVerdict(t.selfReport, o.verdict);
  else if (run.report) addVerdict(t.selfReport, REPORTED[run.report.outcome]);
  if (run.corrections) { t.corrections.runs++; t.corrections.tagged += run.corrections.tagged; t.corrections.afterReport += run.corrections.afterReport; }
  const end = run.endedAt;
  if (reworkedWithin(run, starts)) t.reworked++;
  t.questions += run.counters.questions; t.commands += run.counters.commands;
  if (run.costUsd !== null) push(t.cost, run.costUsd);
  if (run.tokens) for (const k of TOKEN_KINDS) push(t.tokens[k], run.tokens[k]);
  push(t.elapsed, Math.max(0, end - run.startedAt));
  if (typeof run.executionMs === 'number') push(t.execution, run.executionMs);
  const first = new Map<string, AgentRun>();
  for (const v of index.reviews.get(run.runId) ?? []) {
    if (!v.report || v.report.findings === undefined) continue;
    const k = keyOf(v.agentId, v.version), seen = first.get(k);
    if (!seen || v.report.at < seen.report!.at) first.set(k, v);
  }
  for (const [k, v] of first) {
    const rep = v.report!;
    const r = t.reviews[k] ??= { runs: 0, findings: 0, blockingRuns: 0, blocking: 0 };
    r.runs++; r.findings += rep.findings!;
    if (rep.blocking !== undefined) { r.blockingRuns++; r.blocking += rep.blocking; }
  }
}

/** a sample's total: kept, or read back from its values while it still holds them all (a summary saved before `sum`) */
const sumOf = (s: Sample): number | undefined => s.sum ?? (s.values.length === s.n ? s.values.reduce((t, v) => t + v, 0) : undefined);
const mergeSample = (a: Sample, b: Sample): Sample => { const x = sumOf(a), y = sumOf(b); return { n: a.n + b.n, values: [...a.values, ...b.values].slice(-SAMPLE_MAX), ...(x !== undefined && y !== undefined ? { sum: x + y } : {}) }; };
const mergeVerdicts = (a: Verdicts, b: Verdicts): Verdicts => ({ success: a.success + b.success, partial: a.partial + b.partial, fail: a.fail + b.fail });
/** a tally's XP: kept, or its verified successes at their floor (a rollup pruned before ADR 0131) */
export const tallyXp = (t: RunTally): number => t.xp ?? (t.verdicts.success + (t.earnedWins ?? 0)) * LEGACY_XP;
const round2 = (n: number): number => Math.round(n * 100) / 100;
/** a then b (a older: its sample values go first and are the first to fall out) */
export function mergeTallies(a: RunTally, b: RunTally, agentId = a.agentId, version = a.version): RunTally {
  const reviews: Record<string, ReviewTally> = structuredClone(a.reviews);
  for (const [k, r] of Object.entries(b.reviews)) { const x = reviews[k] ??= { runs: 0, findings: 0, blockingRuns: 0, blocking: 0 }; x.runs += r.runs; x.findings += r.findings; x.blockingRuns += r.blockingRuns; x.blocking += r.blocking; }
  return {
    agentId, version, verdictSchema: 2, ended: a.ended + b.ended, verdicts: mergeVerdicts(a.verdicts, b.verdicts), opinion: mergeVerdicts(a.opinion, b.opinion), selfReport: mergeVerdicts(a.selfReport, b.selfReport),
    corrections: { runs: a.corrections.runs + b.corrections.runs, tagged: a.corrections.tagged + b.corrections.tagged, afterReport: a.corrections.afterReport + b.corrections.afterReport },
    reworked: a.reworked + b.reworked, questions: a.questions + b.questions, commands: a.commands + b.commands,
    cost: mergeSample(a.cost, b.cost), tokens: Object.fromEntries(TOKEN_KINDS.map(k => [k, mergeSample(a.tokens[k], b.tokens[k])])) as Record<TokenKind, Sample>,
    elapsed: mergeSample(a.elapsed, b.elapsed), execution: mergeSample(a.execution, b.execution), reviews,
    ...(a.decisions || b.decisions ? { decisions: (a.decisions ?? 0) + (b.decisions ?? 0) } : {}),
    ...(a.decisionWins || b.decisionWins ? { decisionWins: (a.decisionWins ?? 0) + (b.decisionWins ?? 0) } : {}),
    ...(a.earnedWins || b.earnedWins ? { earnedWins: (a.earnedWins ?? 0) + (b.earnedWins ?? 0) } : {}),
    // a side without XP (pruned before ADR 0131) gets its successes' floor, so the merged XP stays a whole record
    ...(a.xp !== undefined || b.xp !== undefined ? { xp: tallyXp(a) + tallyXp(b) } : {}),
    ...(a.decisionXp !== undefined || b.decisionXp !== undefined ? { decisionXp: (a.decisionXp ?? (a.decisionWins ?? 0) * LEGACY_XP) + (b.decisionXp ?? (b.decisionWins ?? 0) * LEGACY_XP) } : {}),
    ...(a.tagsLost || b.tagsLost ? { tagsLost: true as const } : (() => { const tags = mergeTags(a.tags, b.tags); return tags ? { tags } : {}; })()),
  };
}

const TAG_FIELDS = ['ended', 'reworked', 'questions', 'commands'] as const;
export function countsOf(t: TagTally): TagTally {
  return { ended: t.ended, verdicts: { ...t.verdicts }, opinion: { ...t.opinion }, selfReport: { ...t.selfReport }, corrections: { ...t.corrections },
    reworked: t.reworked, questions: t.questions, commands: t.commands };
}
function addCounts(a: TagTally, b: TagTally): void {
  for (const k of TAG_FIELDS) a[k] += b[k];
  for (const k of ['verdicts', 'opinion', 'selfReport'] as const) { a[k].success += b[k].success; a[k].partial += b[k].partial; a[k].fail += b[k].fail; }
  a.corrections.runs += b.corrections.runs; a.corrections.tagged += b.corrections.tagged; a.corrections.afterReport += b.corrections.afterReport;
}
/** Own keys only: a tag named like an Object.prototype member never reaches the prototype. */
export const tagOf = (rec: Record<string, TagTally>, key: string): TagTally | undefined => Object.hasOwn(rec, key) ? rec[key] : undefined;
function addTag(rec: Record<string, TagTally>, key: string, counts: TagTally): void {
  const known = tagOf(rec, key);
  if (known) addCounts(known, counts);
  else Object.defineProperty(rec, key, { value: countsOf(counts), enumerable: true, writable: true, configurable: true });
}
function mergeTags(a: TagTallies | undefined, b: TagTallies | undefined): TagTallies | undefined {
  if (!a && !b) return undefined;
  const out: TagTallies = { skills: {}, apps: {}, repos: {} };
  for (const t of [a, b]) if (t) for (const d of ['skills', 'apps', 'repos'] as const) for (const [k, v] of Object.entries(t[d])) addTag(out[d], k, v);
  for (const t of [a, b]) if (t?.combined) for (const [k, v] of Object.entries(t.combined)) addTag(out.combined ??= {}, k, v);
  return out;
}

/** Pruned runs into the rollups: `all` = every run known before the prune (their reworks and reviews). Each pruned run is
 *  folded once, into its tally and into one bucket per tag it carries. */
export function rollUp(rollups: readonly RunTally[], pruned: readonly AgentRun[], all: readonly AgentRun[], now = Date.now()): RunTally[] {
  const index = indexRuns(all, now), earn = earnIndex(all), out = new Map(rollups.map(t => [keyOf(t.agentId, t.version), structuredClone(t)]));
  for (const run of [...pruned].sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))) {
    const k = keyOf(run.agentId, run.version);
    if (!out.has(k)) out.set(k, emptyTally(run.agentId, run.version));
    const t = out.get(k)!;
    const xp0 = tallyXp(t), dxp0 = t.decisionXp ?? (t.decisionWins ?? 0) * LEGACY_XP;
    foldRun(t, run, index);
    const e = counts(run) ? earnedVerdict(run, earn) : null;
    if (e?.verdict === 'success' && (e.basis === 'chain' || e.basis === 'graded' || e.basis === 'receipts')) t.earnedWins = (t.earnedWins ?? 0) + 1;
    // the XP (a rollup pruned before ADR 0131 starts from its successes' floor, xp0)
    if (e) t.xp = round2(xp0 + (e.verdict === 'success' ? runXp(run, earn) : 0));
    if (countedDecision(run)) {
      t.decisions = (t.decisions ?? 0) + 1;
      // the same verified success as the live standing (receipts and chains too: before ADR 0131 only the user's or a
      // review's survived a prune, so the Orchestrator lost the receipts' XP of its pruned decisions)
      if (e?.verdict === 'success') t.decisionWins = (t.decisionWins ?? 0) + 1;
      t.decisionXp = round2(dxp0 + decisionXp(run, earn, e));
    }
    if (!run.tags || run.endedAt === undefined || t.tagsLost) continue;
    const one = emptyTally(run.agentId, run.version);
    foldRun(one, run, index);
    const tags = t.tags ??= { skills: {}, apps: {}, repos: {} };
    for (const skill of new Set(run.tags.skills)) addTag(tags.skills, skill, one);
    if (run.tags.app !== null) addTag(tags.apps, run.tags.app, one);
    if (run.tags.repo !== null) addTag(tags.repos, run.tags.repo, one);
    const { app, repo } = run.tags;
    const combined = tags.combined ??= {};
    if (app !== null && repo !== null) addTag(combined, tagFilterKey({ app, repo }), one);
    for (const skill of new Set(run.tags.skills)) {
      if (app !== null) addTag(combined, tagFilterKey({ skill, app }), one);
      if (repo !== null) addTag(combined, tagFilterKey({ skill, repo }), one);
      if (app !== null && repo !== null) addTag(combined, tagFilterKey({ skill, app, repo }), one);
    }
  }
  return [...out.values()];
}
/** A run matches when it carries every tag asked for; an untagged run (recorded before tags) never matches. */
export function matchesTags(run: AgentRun, f: TagFilter): boolean {
  if (f.skill === undefined && f.app === undefined && f.repo === undefined) return true;
  if (!run.tags) return false;
  return (f.skill === undefined || run.tags.skills.includes(f.skill)) && (f.app === undefined || run.tags.app === f.app) && (f.repo === undefined || run.tags.repo === f.repo);
}
/** The rollup restricted to matching tags (counts only, no samples); null when tag counts were dropped. */
function filteredRollup(t: RunTally, f: TagFilter): RunTally | null {
  const asked = (['skill', 'app', 'repo'] as const).filter(k => f[k] !== undefined);
  if (asked.length === 0) return structuredClone(t);
  if (t.tagsLost) return null;
  if (asked.length > 1) {
    const counts = t.tags?.combined ? tagOf(t.tags.combined, tagFilterKey(f)) : undefined;
    return counts ? { ...emptyTally(t.agentId, t.version), ...countsOf(counts) } : null;
  }
  const d = asked[0]!, key = f[d]!;
  const counts = t.tags ? tagOf(t.tags[d === 'skill' ? 'skills' : d === 'app' ? 'apps' : 'repos'], key) : undefined;
  return counts ? { ...emptyTally(t.agentId, t.version), ...countsOf(counts) } : null;
}

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b), mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
/** nearest rank */
export function p90(values: readonly number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.ceil(0.9 * s.length) - 1]!;
}
const ratio = (num: number, den: number): number | null => den > 0 ? num / den : null;
const metric = (value: number | null, n: number, ended: number): Metric => ({ value: n > 0 ? value : null, n, coverage: ratio(n, ended) });
// the one success definition (shared/success.ts, ADR 0186): a partial counts half
const rate = (v: Verdicts): { value: number | null; n: number } => { const n = v.success + v.partial + v.fail; return { value: ratio(v.success * VERDICT_WEIGHT.success + v.partial * VERDICT_WEIGHT.partial, n), n }; };

export function finalize(t: RunTally, version: number | null): VersionMetrics {
  const e = t.ended, success = rate(t.verdicts);
  return {
    agentId: t.agentId, version, ended: e,
    successRate: metric(success.value, success.n, e), opinion: rate(t.opinion), selfReport: rate(t.selfReport),
    correctionsPerRun: metric(ratio(t.corrections.tagged + t.corrections.afterReport, t.corrections.runs), t.corrections.runs, e),
    reworkRate: metric(ratio(t.reworked, e), e, e),
    costPerRun: { median: metric(median(t.cost.values), t.cost.n, e), p90: p90(t.cost.values), total: t.cost.n > 0 ? sumOf(t.cost) ?? null : null },
    tokensPerRun: Object.fromEntries(TOKEN_KINDS.map(k => [k, metric(median(t.tokens[k].values), t.tokens[k].n, e)])) as Record<TokenKind, Metric>,
    timeToDone: { elapsed: metric(median(t.elapsed.values), t.elapsed.n, e), execution: metric(median(t.execution.values), t.execution.n, e) },
    questionsPerRun: metric(ratio(t.questions, e), e, e), commandsPerRun: metric(ratio(t.commands, e), e, e),
    reviews: Object.entries(t.reviews).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([k, r]) => {
      const cut = k.lastIndexOf('/');
      return { reviewer: { agentId: k.slice(0, cut), version: Number(k.slice(cut + 1)) }, runs: r.runs, findingsPerRun: r.findings / r.runs, blockingPerRun: metric(ratio(r.blocking, r.blockingRuns), r.blockingRuns, r.runs) };
    }),
  };
}

/** Retained reported runs only: no inferred observations from old rollups, and one engine submission per batch. */
export function deliveryMetrics(runs: readonly AgentRun[]): DeliveryMetrics {
  const reported = runs.filter(r => r.report?.canonical);
  const observed = reported.filter(r => r.delivery);
  const displayed = observed.flatMap(r => r.delivery!.displayedAt === undefined ? [] : [r.delivery!.displayedAt! - r.delivery!.reportedAt]);
  const delivered = observed.filter(r => r.delivery!.deliveredAt !== undefined).length;
  const batches = new Set(observed.flatMap(r => r.delivery!.synthesisSubmittedAt !== undefined && r.delivery!.synthesisBatchId ? [r.delivery!.synthesisBatchId] : []));
  return { reported: reported.length, instrumented: observed.length, delivered,
    coverage: ratio(observed.length, reported.length), rate: ratio(delivered, observed.length),
    displayLatencyMs: { median: median(displayed), n: displayed.length },
    synthesisSubmissions: observed.length ? batches.size : null };
}

/** The §5 read model: per role, one row per version and an all-versions row. */
export function runMetrics(runs: readonly AgentRun[], input: MetricsInput = {}): AgentMetrics[] {
  const index = indexRuns(runs, input.now), tallies = new Map<string, RunTally>(), open = new Map<string, number>();
  const rollupsIn = input.since === undefined, filter = input.filter ?? {};
  if (rollupsIn) for (const t of input.rollups ?? []) {
    const own = filteredRollup(t, filter);
    if (own) tallies.set(keyOf(t.agentId, t.version), own);
  }
  for (const run of runs) {
    if (!matchesTags(run, filter)) continue;
    if (run.endedAt === undefined) { if (input.live?.(run) !== false) open.set(run.agentId, (open.get(run.agentId) ?? 0) + 1); continue; }
    if (input.since !== undefined && run.endedAt < input.since) continue;
    const k = keyOf(run.agentId, run.version);
    if (!tallies.has(k)) tallies.set(k, emptyTally(run.agentId, run.version));
    foldRun(tallies.get(k)!, run, index);
  }
  // the retired roles and Pulse have no catalog stats (ADR 0186): their runs stay in the file, readable
  const agents = new Set([...[...tallies.values()].map(t => t.agentId), ...open.keys()].filter(id => !unrated(id)));
  // ADR 0197: the PPI success and the Sentinel's agreement, over the kept runs the filter matches (reviews looked up in all)
  const judges = roleJudges(runs.filter(r => r.endedAt !== undefined && (input.since === undefined || r.endedAt >= input.since) && matchesTags(r, filter)), earnIndex(runs));
  return [...agents].sort((a, b) => a.localeCompare(b, 'en')).map(agentId => {
    const own = [...tallies.values()].filter(t => t.agentId === agentId).sort((a, b) => a.version - b.version);
    const retained = runs.filter(r => r.agentId === agentId && r.endedAt !== undefined && (input.since === undefined || r.endedAt >= input.since) && matchesTags(r, filter));
    return {
      agentId, open: open.get(agentId) ?? 0,
      versions: own.map(t => ({ ...finalize(t, t.version), delivery: deliveryMetrics(retained.filter(r => r.version === t.version)) })),
      all: own.length ? { ...finalize(own.slice(1).reduce((acc, t) => mergeTallies(acc, t, agentId, 0), own[0]!), null), delivery: deliveryMetrics(retained), ...(judges.has(agentId) ? { judges: judges.get(agentId)! } : {}) } : null,
    };
  });
}

