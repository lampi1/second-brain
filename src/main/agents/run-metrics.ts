// Role metrics per role and version (AGENTS-DESIGN §5), read from agent-runs.json: the ended runs still kept plus the
// rollups of the ones pruned. Pure but for the clock (the facts' verdict settles 7 days after a run's end: `now`, by
// default the current time). Every metric is `value · n · coverage`: n = the runs it was computed on, coverage = n /
// ended runs. The success rate rests on verified verdicts only: the user's, a verified review's, or the facts'
// (shared/run-verdict.ts, ADR 0100). Used by run-feedback.ts (agent_metrics), trials.ts and the Agenti page.
import type { AgentMetrics, AgentRun, AgentRunTokens, AgentRunOutcome, Metric, VersionMetrics } from '../../shared/agents';
import { countedDecision } from './standing';
import { FACTS_SETTLE_MS, reworkStartsOf, reworkedWithin, verifiedVerdict } from '../../shared/run-verdict';

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
  ended: number;
  /** verified only: basis human or reviewed-evidence, else the facts' settled verdict (shared/run-verdict.ts); a run
   *  pruned while its facts were still provisional is folded without one */
  verdicts: Verdicts;
  /** never in the rate: the Orchestrator's opinion, and the agent's own word (outcome self-report or its run-report) */
  opinion: Verdicts; selfReport: Verdicts;
  /** runs whose corrections were counted (recorded since A6) and their sums */
  corrections: { runs: number; tagged: number; afterReport: number };
  /** ai-errors.md lines naming the run, seen by Brother: runs checked against the file, and lines */
  aiErrors: { runs: number; lines: number };
  reworked: number;
  questions: number; permissions: number; commands: number;
  cost: Sample; tokens: Record<TokenKind, Sample>; contextPeak: Sample; elapsed: Sample; execution: Sample;
  /** findings on this key's runs, per Reviewer `agentId/version`: the first parsed review of each run */
  reviews: Record<string, ReviewTally>;
  /** the same counts per run tag (AGENTS-DESIGN §4.8), for filtered metrics over pruned runs; untagged runs are in none */
  tags?: TagTallies;
  /** of these runs, the Orchestrator's decisions (standing.ts orchestratorDecision): kept so its record survives a prune */
  decisions?: number;
  /** of those decisions, the verified successes at prune time: the Orchestrator's level (its XP, ADR 0100) */
  decisionWins?: number;
  /** fitRollups dropped `tags` to stay in budget: later prunes do not rebuild a partial set, and filters leave this rollup out */
  tagsLost?: true;
}
/** Counts only (no samples): what a filtered metric can still say about pruned runs. */
export type TagTally = Pick<RunTally, 'ended' | 'verdicts' | 'opinion' | 'selfReport' | 'corrections' | 'aiErrors' | 'reworked' | 'questions' | 'permissions' | 'commands'>;
export interface TagTallies { skills: Record<string, TagTally>; apps: Record<string, TagTally>; repos: Record<string, TagTally>; combined?: Record<string, TagTally> }
/** JSON tuple avoids collisions between arbitrary app/repo names and absent dimensions. */
export const tagFilterKey = (f: TagFilter): string => JSON.stringify([f.skill ?? null, f.app ?? null, f.repo ?? null]);
/** One tag filter per dimension; together they must all match. */
export interface TagFilter { skill?: string; app?: string; repo?: string }
export interface MetricsInput {
  rollups?: readonly RunTally[];
  /** ai-errors.md lines per runId (aiErrorRuns); missing = the file was not read: the column stays unknown */
  aiErrors?: ReadonlyMap<string, number>;
  /** only runs ended from then on; the rollups (older by construction) are then left out */
  since?: number;
  /** the clock for the facts' verdict (default: now) */
  now?: number;
  /** the model window of an agent version, for context peak ÷ window */
  windowOf?: (agentId: string, version: number) => number | null;
  /** Only runs whose tags match; untagged runs never match. Rollups retain counts for combined filters too. */
  filter?: TagFilter;
}

const emptySample = (): Sample => ({ n: 0, values: [], sum: 0 });
const verdicts = (): Verdicts => ({ success: 0, partial: 0, fail: 0 });
export function emptyTally(agentId: string, version: number): RunTally {
  return { agentId, version, ended: 0, verdicts: verdicts(), opinion: verdicts(), selfReport: verdicts(), corrections: { runs: 0, tagged: 0, afterReport: 0 }, aiErrors: { runs: 0, lines: 0 },
    reworked: 0, questions: 0, permissions: 0, commands: 0, cost: emptySample(), tokens: { input: emptySample(), output: emptySample(), cacheRead: emptySample(), cacheWrite: emptySample() },
    contextPeak: emptySample(), elapsed: emptySample(), execution: emptySample(), reviews: {} };
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
export function foldRun(t: RunTally, run: AgentRun, index: RunIndex, aiErrors?: ReadonlyMap<string, number>): void {
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
  if (aiErrors) { t.aiErrors.runs++; t.aiErrors.lines += aiErrors.get(run.runId) ?? 0; }
  const end = run.endedAt;
  if (reworkedWithin(run, starts)) t.reworked++;
  t.questions += run.counters.questions; t.permissions += run.counters.permissions; t.commands += run.counters.commands;
  if (run.costUsd !== null) push(t.cost, run.costUsd);
  if (run.tokens) for (const k of TOKEN_KINDS) push(t.tokens[k], run.tokens[k]);
  if (run.counters.contextPeak !== null) push(t.contextPeak, run.counters.contextPeak);
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
/** a then b (a older: its sample values go first and are the first to fall out) */
export function mergeTallies(a: RunTally, b: RunTally, agentId = a.agentId, version = a.version): RunTally {
  const reviews: Record<string, ReviewTally> = structuredClone(a.reviews);
  for (const [k, r] of Object.entries(b.reviews)) { const x = reviews[k] ??= { runs: 0, findings: 0, blockingRuns: 0, blocking: 0 }; x.runs += r.runs; x.findings += r.findings; x.blockingRuns += r.blockingRuns; x.blocking += r.blocking; }
  return {
    agentId, version, ended: a.ended + b.ended, verdicts: mergeVerdicts(a.verdicts, b.verdicts), opinion: mergeVerdicts(a.opinion, b.opinion), selfReport: mergeVerdicts(a.selfReport, b.selfReport),
    corrections: { runs: a.corrections.runs + b.corrections.runs, tagged: a.corrections.tagged + b.corrections.tagged, afterReport: a.corrections.afterReport + b.corrections.afterReport },
    aiErrors: { runs: a.aiErrors.runs + b.aiErrors.runs, lines: a.aiErrors.lines + b.aiErrors.lines },
    reworked: a.reworked + b.reworked, questions: a.questions + b.questions, permissions: a.permissions + b.permissions, commands: a.commands + b.commands,
    cost: mergeSample(a.cost, b.cost), tokens: Object.fromEntries(TOKEN_KINDS.map(k => [k, mergeSample(a.tokens[k], b.tokens[k])])) as Record<TokenKind, Sample>,
    contextPeak: mergeSample(a.contextPeak, b.contextPeak), elapsed: mergeSample(a.elapsed, b.elapsed), execution: mergeSample(a.execution, b.execution), reviews,
    ...(a.decisions || b.decisions ? { decisions: (a.decisions ?? 0) + (b.decisions ?? 0) } : {}),
    ...(a.decisionWins || b.decisionWins ? { decisionWins: (a.decisionWins ?? 0) + (b.decisionWins ?? 0) } : {}),
    ...(a.tagsLost || b.tagsLost ? { tagsLost: true as const } : (() => { const tags = mergeTags(a.tags, b.tags); return tags ? { tags } : {}; })()),
  };
}

const TAG_FIELDS = ['ended', 'reworked', 'questions', 'permissions', 'commands'] as const;
export function countsOf(t: TagTally): TagTally {
  return { ended: t.ended, verdicts: { ...t.verdicts }, opinion: { ...t.opinion }, selfReport: { ...t.selfReport }, corrections: { ...t.corrections }, aiErrors: { ...t.aiErrors },
    reworked: t.reworked, questions: t.questions, permissions: t.permissions, commands: t.commands };
}
function addCounts(a: TagTally, b: TagTally): void {
  for (const k of TAG_FIELDS) a[k] += b[k];
  for (const k of ['verdicts', 'opinion', 'selfReport'] as const) { a[k].success += b[k].success; a[k].partial += b[k].partial; a[k].fail += b[k].fail; }
  a.corrections.runs += b.corrections.runs; a.corrections.tagged += b.corrections.tagged; a.corrections.afterReport += b.corrections.afterReport;
  a.aiErrors.runs += b.aiErrors.runs; a.aiErrors.lines += b.aiErrors.lines;
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
  const index = indexRuns(all, now), out = new Map(rollups.map(t => [keyOf(t.agentId, t.version), structuredClone(t)]));
  for (const run of [...pruned].sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))) {
    const k = keyOf(run.agentId, run.version);
    if (!out.has(k)) out.set(k, emptyTally(run.agentId, run.version));
    const t = out.get(k)!;
    foldRun(t, run, index);
    if (countedDecision(run)) {
      t.decisions = (t.decisions ?? 0) + 1;
      if (verifiedVerdict(run, index.reworkStarts.get(run.runId), index.now)?.verdict === 'success') t.decisionWins = (t.decisionWins ?? 0) + 1;
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
const rate = (v: Verdicts): { value: number | null; n: number } => { const n = v.success + v.partial + v.fail; return { value: ratio(v.success + 0.5 * v.partial, n), n }; };

export function finalize(t: RunTally, version: number | null, window: number | null = null): VersionMetrics {
  const e = t.ended, success = rate(t.verdicts), peak = median(t.contextPeak.values);
  return {
    agentId: t.agentId, version, ended: e,
    successRate: metric(success.value, success.n, e), opinion: rate(t.opinion), selfReport: rate(t.selfReport),
    correctionsPerRun: metric(ratio(t.corrections.tagged + t.corrections.afterReport, t.corrections.runs), t.corrections.runs, e),
    aiErrorsPerRun: metric(ratio(t.aiErrors.lines, t.aiErrors.runs), t.aiErrors.runs, e),
    reworkRate: metric(ratio(t.reworked, e), e, e),
    costPerRun: { median: metric(median(t.cost.values), t.cost.n, e), p90: p90(t.cost.values), total: t.cost.n > 0 ? sumOf(t.cost) ?? null : null },
    tokensPerRun: Object.fromEntries(TOKEN_KINDS.map(k => [k, metric(median(t.tokens[k].values), t.tokens[k].n, e)])) as Record<TokenKind, Metric>,
    contextPeak: { median: metric(peak, t.contextPeak.n, e), max: t.contextPeak.values.length ? Math.max(...t.contextPeak.values) : null, ofWindow: peak !== null && window ? peak / window : null },
    timeToDone: { elapsed: metric(median(t.elapsed.values), t.elapsed.n, e), execution: metric(median(t.execution.values), t.execution.n, e) },
    questionsPerRun: metric(ratio(t.questions, e), e, e), permissionsPerRun: metric(ratio(t.permissions, e), e, e), commandsPerRun: metric(ratio(t.commands, e), e, e),
    reviews: Object.entries(t.reviews).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([k, r]) => {
      const cut = k.lastIndexOf('/');
      return { reviewer: { agentId: k.slice(0, cut), version: Number(k.slice(cut + 1)) }, runs: r.runs, findingsPerRun: r.findings / r.runs, blockingPerRun: metric(ratio(r.blocking, r.blockingRuns), r.blockingRuns, r.runs) };
    }),
  };
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
    if (run.endedAt === undefined) { open.set(run.agentId, (open.get(run.agentId) ?? 0) + 1); continue; }
    if (input.since !== undefined && run.endedAt < input.since) continue;
    const k = keyOf(run.agentId, run.version);
    if (!tallies.has(k)) tallies.set(k, emptyTally(run.agentId, run.version));
    foldRun(tallies.get(k)!, run, index, input.aiErrors);
  }
  const agents = new Set([...[...tallies.values()].map(t => t.agentId), ...open.keys()]);
  return [...agents].sort((a, b) => a.localeCompare(b, 'en')).map(agentId => {
    const own = [...tallies.values()].filter(t => t.agentId === agentId).sort((a, b) => a.version - b.version);
    return {
      agentId, open: open.get(agentId) ?? 0,
      versions: own.map(t => finalize(t, t.version, input.windowOf?.(agentId, t.version) ?? null)),
      all: own.length ? finalize(own.slice(1).reduce((acc, t) => mergeTallies(acc, t, agentId, 0), own[0]!), null) : null,
    };
  });
}

/** ai-errors.md lines with `run: r_…` (mem.mjs writes it) seen by Brother: lines per runId. */
export function aiErrorRuns(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('- ')) continue;
    const fields = line.slice(2).split(' · ');
    const run = fields.find(f => /^run: r_[a-f0-9]{12}$/.test(f))?.slice(5);
    if (!run || !fields.some(f => /^visto da: .*\bBrother\b/i.test(f))) continue;
    out.set(run, (out.get(run) ?? 0) + 1);
  }
  return out;
}
