// Agent metrics per agent and version (AGENTS-DESIGN §5), read from agent-runs.json: the ended runs still kept plus the
// rollups of the ones pruned. Pure. Every metric is `value · n · coverage`: n = the runs it was computed on, coverage =
// n / ended runs. v0 (legacy, what it ran is unknown) has its own row but never enters the agent's all-versions row.
import type { AgentMetrics, AgentRun, AgentRunTokens, AgentRunOutcome, Metric, VersionMetrics } from '../../shared/agents';

/** the newest values kept per sample for medians (n counts them all) */
export const SAMPLE_MAX = 200;
/** a new run continuing or reworking an ended one within this time makes the ended one reworked */
export const REWORK_MS = 7 * 86_400_000;
const TOKEN_KINDS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const;
type TokenKind = keyof AgentRunTokens;

export interface Sample { n: number; values: number[] }
export interface Verdicts { success: number; partial: number; fail: number }
export interface ReviewTally { runs: number; findings: number; blockingRuns: number; blocking: number }
/** Additive per (agentId, version): the kept runs fold into one; the pruned ones live on as one (agent-runs.json `rollups`). */
export interface RunTally {
  agentId: string; version: number;
  ended: number;
  /** basis human or reviewed-evidence only */
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
}
export interface MetricsInput {
  rollups?: readonly RunTally[];
  /** ai-errors.md lines per runId (aiErrorRuns); missing = the file was not read: the column stays unknown */
  aiErrors?: ReadonlyMap<string, number>;
  /** only runs ended from then on; the rollups (older by construction) are then left out */
  since?: number;
  /** the model window of an agent version, for context peak ÷ window */
  windowOf?: (agentId: string, version: number) => number | null;
}

const emptySample = (): Sample => ({ n: 0, values: [] });
const verdicts = (): Verdicts => ({ success: 0, partial: 0, fail: 0 });
export function emptyTally(agentId: string, version: number): RunTally {
  return { agentId, version, ended: 0, verdicts: verdicts(), opinion: verdicts(), selfReport: verdicts(), corrections: { runs: 0, tagged: 0, afterReport: 0 }, aiErrors: { runs: 0, lines: 0 },
    reworked: 0, questions: 0, permissions: 0, commands: 0, cost: emptySample(), tokens: { input: emptySample(), output: emptySample(), cacheRead: emptySample(), cacheWrite: emptySample() },
    contextPeak: emptySample(), elapsed: emptySample(), execution: emptySample(), reviews: {} };
}
const push = (s: Sample, v: number): void => { s.n++; s.values.push(v); if (s.values.length > SAMPLE_MAX) s.values.splice(0, s.values.length - SAMPLE_MAX); };
const addVerdict = (v: Verdicts, verdict: AgentRunOutcome['verdict']): void => { if (verdict !== 'unknown') v[verdict]++; };
const REPORTED = { done: 'success', partial: 'partial', blocked: 'fail' } as const;
const keyOf = (agentId: string, version: number): string => `${agentId}/${version}`;

/** Lookups over every run known at fold time: reworks and reviews point at runs by id. */
export interface RunIndex { reworkStarts: Map<string, number[]>; reviews: Map<string, AgentRun[]> }
export function indexRuns(all: readonly AgentRun[]): RunIndex {
  const reworkStarts = new Map<string, number[]>(), reviews = new Map<string, AgentRun[]>();
  for (const r of all) {
    for (const target of new Set([r.reworkOf, r.continuedFrom])) if (target) reworkStarts.set(target, [...(reworkStarts.get(target) ?? []), r.startedAt]);
    if (r.reviewOf) reviews.set(r.reviewOf, [...(reviews.get(r.reviewOf) ?? []), r]);
  }
  return { reworkStarts, reviews };
}

/** Adds one ended run (an open one is ignored: the unit is the ended run). */
export function foldRun(t: RunTally, run: AgentRun, index: RunIndex, aiErrors?: ReadonlyMap<string, number>): void {
  if (run.endedAt === undefined) return;
  t.ended++;
  const o = run.outcome;
  if (o && (o.basis === 'human' || o.basis === 'reviewed-evidence')) addVerdict(t.verdicts, o.verdict);
  if (o?.basis === 'orchestrator-opinion') addVerdict(t.opinion, o.verdict);
  if (o?.basis === 'self-report') addVerdict(t.selfReport, o.verdict);
  else if (run.report?.ok) addVerdict(t.selfReport, REPORTED[run.report.outcome]);
  if (run.corrections) { t.corrections.runs++; t.corrections.tagged += run.corrections.tagged; t.corrections.afterReport += run.corrections.afterReport; }
  if (aiErrors) { t.aiErrors.runs++; t.aiErrors.lines += aiErrors.get(run.runId) ?? 0; }
  const end = run.endedAt;
  if (run.counters.reopened > 0 || (index.reworkStarts.get(run.runId) ?? []).some(at => at <= end + REWORK_MS)) t.reworked++;
  t.questions += run.counters.questions; t.permissions += run.counters.permissions; t.commands += run.counters.commands;
  if (run.costUsd !== null) push(t.cost, run.costUsd);
  if (run.tokens) for (const k of TOKEN_KINDS) push(t.tokens[k], run.tokens[k]);
  if (run.counters.contextPeak !== null) push(t.contextPeak, run.counters.contextPeak);
  push(t.elapsed, Math.max(0, end - run.startedAt));
  if (typeof run.executionMs === 'number') push(t.execution, run.executionMs);
  const first = new Map<string, AgentRun>();
  for (const v of index.reviews.get(run.runId) ?? []) {
    if (!v.report?.ok || v.report.findings === undefined) continue;
    const k = keyOf(v.agentId, v.version), seen = first.get(k);
    if (!seen || v.report.at < (seen.report as { at: number }).at) first.set(k, v);
  }
  for (const [k, v] of first) {
    const rep = v.report as Extract<NonNullable<AgentRun['report']>, { ok: true }>;
    const r = t.reviews[k] ??= { runs: 0, findings: 0, blockingRuns: 0, blocking: 0 };
    r.runs++; r.findings += rep.findings!;
    if (rep.blocking !== undefined) { r.blockingRuns++; r.blocking += rep.blocking; }
  }
}

const mergeSample = (a: Sample, b: Sample): Sample => ({ n: a.n + b.n, values: [...a.values, ...b.values].slice(-SAMPLE_MAX) });
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
  };
}

/** Pruned runs into the rollups: `all` = every run known before the prune (their reworks and reviews). */
export function rollUp(rollups: readonly RunTally[], pruned: readonly AgentRun[], all: readonly AgentRun[]): RunTally[] {
  const index = indexRuns(all), out = new Map(rollups.map(t => [keyOf(t.agentId, t.version), structuredClone(t)]));
  for (const run of [...pruned].sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))) {
    const k = keyOf(run.agentId, run.version);
    if (!out.has(k)) out.set(k, emptyTally(run.agentId, run.version));
    foldRun(out.get(k)!, run, index);
  }
  return [...out.values()];
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
    agentId: t.agentId, version, legacy: version === 0, ended: e,
    successRate: metric(success.value, success.n, e), opinion: rate(t.opinion), selfReport: rate(t.selfReport),
    correctionsPerRun: metric(ratio(t.corrections.tagged + t.corrections.afterReport, t.corrections.runs), t.corrections.runs, e),
    aiErrorsPerRun: metric(ratio(t.aiErrors.lines, t.aiErrors.runs), t.aiErrors.runs, e),
    reworkRate: metric(ratio(t.reworked, e), e, e),
    costPerRun: { median: metric(median(t.cost.values), t.cost.n, e), p90: p90(t.cost.values) },
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

/** The §5 read model: per agent, one row per version (v0 flagged legacy) and an all-versions row without v0. */
export function runMetrics(runs: readonly AgentRun[], input: MetricsInput = {}): AgentMetrics[] {
  const index = indexRuns(runs), tallies = new Map<string, RunTally>(), open = new Map<string, number>();
  const rollupsIn = input.since === undefined;
  if (rollupsIn) for (const t of input.rollups ?? []) tallies.set(keyOf(t.agentId, t.version), structuredClone(t));
  for (const run of runs) {
    if (run.endedAt === undefined) { open.set(run.agentId, (open.get(run.agentId) ?? 0) + 1); continue; }
    if (input.since !== undefined && run.endedAt < input.since) continue;
    const k = keyOf(run.agentId, run.version);
    if (!tallies.has(k)) tallies.set(k, emptyTally(run.agentId, run.version));
    foldRun(tallies.get(k)!, run, index, input.aiErrors);
  }
  const agents = new Set([...[...tallies.values()].map(t => t.agentId), ...open.keys()]);
  return [...agents].sort((a, b) => a.localeCompare(b, 'en')).map(agentId => {
    const own = [...tallies.values()].filter(t => t.agentId === agentId).sort((a, b) => a.version - b.version);
    const real = own.filter(t => t.version > 0);
    return {
      agentId, open: open.get(agentId) ?? 0,
      versions: own.map(t => finalize(t, t.version, input.windowOf?.(agentId, t.version) ?? null)),
      all: real.length ? finalize(real.slice(1).reduce((acc, t) => mergeTallies(acc, t, agentId, 0), real[0]!), null) : null,
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
