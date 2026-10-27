// Role runs (AGENTS-DESIGN §1.2, §5): one record per chat started from a role, kept in agent-runs.json after
// chats.json forgets the chat (60 closed chats). The pure lifecycle steps live here; ChatManager calls them on start,
// end (completed / closed / stale), Brother's reopen, pending requests and settled turns. A run's receipts (what it did,
// agents/receipts.ts, ADR 0130) are bounded there and read back here; ones out of shape are dropped, never the run.
// The same file keeps Flash's answer outcomes (`flash`, agents/flash-outcomes.ts, ADR 0131: Flash records no run) and a
// Strategist run's plan record (`plan`, a decision signal for the Orchestrator); both read leniently.
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import type { AgentRun, AgentRunCorrections, AgentRunEnd, AgentRunOutcome, AgentRunPlan, AgentRunReport, AgentRunTags, AgentRunTokens } from '../../shared/agents';
import { ONE_SHOT_PURPOSES } from '../../shared/agents';
import { errText, log } from '../log';
import { emptyFlashLog, flashAnswered, flashAsked, flashHanded, readFlashLog, type FlashLog } from './flash-outcomes';
import { checkResult } from '../../shared/delegation';
import { MODEL_TIERS, type ModelTier } from '../../shared/roles';
import { SUMMARY_MAX } from './run-report';
import { rollUp, SAMPLE_MAX, type RunTally, type TagTally } from './run-metrics';
import { readLocal, writeLocalText, writeLocalTextAsync } from './local-store';
import { readReceipts } from './receipts';
import { XP_MAX } from './xp';
import { slowStep } from '../perf';

export const RUNS_MAX = 5000;
/** Below the local store's 8 MB cap, with headroom for the run being added. */
export const RUNS_BYTES = 7_000_000;
export const GOAL_MAX = 2000;
/** a run with no turn and nothing waiting on Brother for this long ends as stale (first guess, AGENTS-DESIGN §7) */
export const STALE_MS = 72 * 3600_000;
/** the rollups' share of RUNS_BYTES: past it, the largest samples are halved (counts and sums stay exact) */
export const ROLLUP_BYTES = 1_000_000;

const ENDS: readonly AgentRunEnd[] = ['completed', 'closed', 'stale'];
const VERDICTS: readonly AgentRunOutcome['verdict'][] = ['success', 'partial', 'fail', 'unknown'];
const STARTED_BY: readonly AgentRun['startedBy'][] = ['user', 'orchestrator', 'parent', 'app'];
const BASES: readonly AgentRunOutcome['basis'][] = ['human', 'reviewed-evidence', 'receipts', 'orchestrator-opinion', 'self-report', 'unknown'];
export const RUN_ID = /^r_[a-f0-9]{12}$/;
const AGENT_ID = /^[a-z][a-z0-9_-]{0,79}$/;
const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const time = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const str = (v: unknown, max: number): v is string => typeof v === 'string' && !!v && v.length <= max;

export const newRunId = (): string => `r_${crypto.randomBytes(6).toString('hex')}`;

/** The one answer to a runId that names no run (agent_feedback, agent_run_report): what the caller passed, and the id to
 *  use. A chat id is never taken as a run id (one shape): its run, when it has one, is named so the caller retries with
 *  it. chat = the chat with that id (its run mirror) or undefined; runs = the store, which outlives chats.json. */
export function unknownRunError(id: string, runs: readonly AgentRun[], chat?: (id: string) => { run?: Pick<AgentRun, 'runId'> } | undefined): Error {
  const c = chat?.(id);
  const own = runs.filter(r => r.chatId === id).sort((a, b) => b.startedAt - a.startedAt)[0];
  const runId = c?.run?.runId ?? own?.runId;
  if (runId) return new Error(`${id} is a chat id, not a run id: pass runId "${runId}" (the agent run of that chat, listed by app_chats as run.runId).`);
  if (c) return new Error(`chat ${id} is not an agent run (plain chat or Orchestrator): feedback only applies to runs of catalog agents.`);
  return new Error(`no agent run with id ${id} (it may have been pruned): use the runId listed by app_chats.`);
}

// Run tags (AGENTS-DESIGN §4.8)
export const SKILL_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;
export const SKILLS_MAX = 16;
export const APP_MAX = 40;
export const REPO_MAX = 120;
const CONTROL = /[\u0000-\u001f\u007f]/;
/** An app or repo name: a non-empty single line, bounded. */
export const tagName = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim() === v && !!v && v.length <= max && !CONTROL.test(v);
/** Stored or given skills: valid ids, unique, at most SKILLS_MAX. */
export const skillList = (v: unknown): v is string[] => Array.isArray(v) && v.length <= SKILLS_MAX && v.every(x => typeof x === 'string' && SKILL_ID.test(x)) && new Set(v).size === v.length;
function readTags(v: unknown): AgentRunTags | null {
  const t = v as Record<string, unknown> | null;
  if (!t || typeof t !== 'object' || !skillList(t.skills) || !(t.app === null || tagName(t.app, APP_MAX)) || !(t.repo === null || tagName(t.repo, REPO_MAX))) return null;
  return { skills: [...t.skills], app: t.app as string | null, repo: t.repo as string | null };
}
/** A skill the run's engine loaded while it was open (Claude's Skill tool): added once, up to SKILLS_MAX; frozen at the end.
 *  `name` may be a plugin-qualified `plugin:skill`: the part after the last colon is the id. */
export function addSkill(run: AgentRun, name: unknown): boolean {
  if (run.endedAt !== undefined || !run.tags || typeof name !== 'string') return false;
  const id = name.slice(name.lastIndexOf(':') + 1).trim().toLowerCase();
  if (!SKILL_ID.test(id) || run.tags.skills.includes(id) || run.tags.skills.length >= SKILLS_MAX) return false;
  run.tags.skills.push(id);
  return true;
}

function readOutcome(v: unknown): AgentRunOutcome | null {
  const o = v as Partial<AgentRunOutcome> | null;
  if (!o || typeof o !== 'object' || !VERDICTS.includes(o.verdict!) || !BASES.includes(o.basis!) || !time(o.at) || !str(o.by, 80) || (o.note !== undefined && (typeof o.note !== 'string' || o.note.length > 600))) return null;
  return { verdict: o.verdict!, basis: o.basis!, at: o.at, by: o.by, ...(o.note !== undefined ? { note: o.note } : {}) };
}
function readTokens(v: unknown): AgentRunTokens | null {
  const t = v as Partial<AgentRunTokens> | null;
  return t && typeof t === 'object' && count(t.input) && count(t.cacheRead) && count(t.cacheWrite) && count(t.output) ? { input: t.input, cacheRead: t.cacheRead, cacheWrite: t.cacheWrite, output: t.output } : null;
}

function readReport(v: unknown): AgentRunReport | null {
  const r = v as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || !time(r.at)) return null;
  if (!['done', 'partial', 'blocked'].includes(r.outcome as string) || !['yes', 'partial', 'no'].includes(r.verified as string) || !str(r.summary, SUMMARY_MAX)
    || (r.findings !== undefined && !count(r.findings)) || (r.blocking !== undefined && !count(r.blocking)) || (count(r.findings) && count(r.blocking) && r.blocking > r.findings)) return null;
  let canonical: AgentRunReport['canonical'];
  if (r.canonical !== undefined) {
    const c = r.canonical as NonNullable<AgentRunReport['canonical']>;
    if (!c || !time(c.at) || !str(c.taskId, 80) || !RUN_ID.test(c.runId) || !count(c.taskVersion) || c.taskVersion < 1 || !Array.isArray(c.doneWhen)) return null;
    const { at, taskId, runId, taskVersion, ...result } = c;
    try { canonical = { ...checkResult(result, c.doneWhen.map(d => d.criterion)), at, taskId, runId, taskVersion }; } catch { return null; }
  }
  return { ...(canonical ? { canonical } : {}), at: r.at, outcome: r.outcome as 'done', verified: r.verified as 'yes', summary: r.summary,
    ...(r.findings !== undefined ? { findings: r.findings as number } : {}), ...(r.blocking !== undefined ? { blocking: r.blocking as number } : {}),
    ...(['success', 'partial', 'fail'].includes(r.verdict as string) ? { verdict: r.verdict as 'success' } : {}), ...(r.via === 'agent_report' ? { via: 'agent_report' as const } : {}) };
}
function readCorrections(v: unknown): AgentRunCorrections | null {
  const c = v as Partial<AgentRunCorrections> | null;
  return c && typeof c === 'object' && count(c.tagged) && count(c.afterReport) ? { tagged: c.tagged, afterReport: c.afterReport } : null;
}

/** A stored run, or null when any field is out of shape (the store skips that record; chats.json drops the mirror). */
export function readRun(v: unknown): AgentRun | null {
  const r = v as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || !str(r.runId, 20) || !RUN_ID.test(r.runId) || !str(r.chatId, 80) || !str(r.agentId, 80) || !AGENT_ID.test(r.agentId)
    || !count(r.version) || typeof r.goal !== 'string' || r.goal.length > GOAL_MAX || !STARTED_BY.includes(r.startedBy as AgentRun['startedBy']) || !time(r.startedAt)) return null;
  for (const k of ['parentRunId', 'reviewOf', 'reworkOf', 'continuedFrom'] as const) if (r[k] !== undefined && !(typeof r[k] === 'string' && RUN_ID.test(r[k]))) return null;
  if (r.tier !== undefined && !MODEL_TIERS.includes(r.tier as ModelTier) || r.model !== undefined && r.model !== null && !str(r.model, 120)) return null;
  if ((r.endedAt === undefined) !== (r.endReason === undefined) || (r.endedAt !== undefined && !time(r.endedAt)) || (r.endReason !== undefined && !ENDS.includes(r.endReason as AgentRunEnd))) return null;
  const outcome = r.outcome === undefined ? undefined : readOutcome(r.outcome);
  if (r.source !== undefined && r.source !== 'chat' && r.source !== 'oneshot') return null;
  if (r.requestOrigin !== undefined && !['user', 'agent', 'app'].includes(r.requestOrigin as string)) return null;
  const oneshot = r.oneshot as AgentRun['oneshot'];
  if (oneshot !== undefined && (!oneshot || typeof oneshot !== 'object' || !str(oneshot.engine, 80)
    || !ONE_SHOT_PURPOSES.includes(oneshot.job) || typeof oneshot.fallback !== 'boolean'
    || !['reported', 'estimated', 'unknown'].includes(oneshot.costBasis) || (oneshot.ok !== undefined && typeof oneshot.ok !== 'boolean'))) return null;
  if (outcome === null) return null;
  const c = r.counters as Record<string, unknown> | null;
  if (!c || typeof c !== 'object' || !count(c.questions) || !count(c.permissions) || !count(c.commands) || !count(c.reopened) || !(c.contextPeak === null || count(c.contextPeak))) return null;
  if (!(r.costUsd === null || time(r.costUsd))) return null;
  const tokens = r.tokens === null ? null : readTokens(r.tokens);
  if (r.tokens !== null && !tokens) return null;
  // a report without its fields (a turn whose block was out of shape) counts as no report
  const report = r.report === undefined || (r.report as { ok?: unknown } | null)?.ok === false ? undefined : readReport(r.report);
  const corrections = r.corrections === undefined ? undefined : readCorrections(r.corrections);
  const tags = r.tags === undefined ? undefined : readTags(r.tags);
  const receipts = r.receipts === undefined ? null : readReceipts(r.receipts);
  if (report === null || corrections === null || tags === null || (r.executionMs !== undefined && !time(r.executionMs))) return null;
  const delivery = r.delivery as AgentRun['delivery'];
  if (delivery !== undefined) {
    if (!delivery || !['display', 'notify', 'synthesize'].includes(delivery.policy) || !time(delivery.reportedAt) || !count(delivery.attempts)) return null;
    for (const stamp of [delivery.deliveredAt, delivery.displayedAt, delivery.synthesisSubmittedAt, delivery.synthesisRequestedAt]) if (stamp !== undefined && (!time(stamp) || stamp < delivery.reportedAt)) return null;
    if (delivery.synthesisPending !== undefined && typeof delivery.synthesisPending !== 'boolean') return null;
    if (delivery.synthesisBatchId !== undefined && !str(delivery.synthesisBatchId, 160)) return null;
    if (delivery.synthesisSubmittedAt !== undefined && !delivery.synthesisBatchId) return null;
    if (delivery.policy !== 'synthesize' && (delivery.synthesisSubmittedAt !== undefined || delivery.synthesisBatchId !== undefined)) return null;
  }
  if (r.turns !== undefined && !count(r.turns)) return null;
  const plan = readPlan(r.plan);
  const scope = r.scope as AgentRun['scope'];
  if (scope !== undefined && (!scope || typeof scope.brainRoot !== 'string' || !path.isAbsolute(scope.brainRoot) || typeof scope.projectRoot !== 'string' || !path.isAbsolute(scope.projectRoot) || scope.brainRoot.length > 4000 || scope.projectRoot.length > 4000)) return null;
  const contract = r.taskContract as AgentRun['taskContract'];
  if (contract?.reportExpected !== undefined && typeof contract.reportExpected !== 'boolean') return null;
  if (contract?.deliveryPolicy !== undefined && !['display', 'notify', 'synthesize'].includes(contract.deliveryPolicy)) return null;
  const snapshot = r.skillSuggestions as AgentRun['skillSuggestions'];
  if (snapshot !== undefined && (!snapshot || !time(snapshot.at) || !skillList(snapshot.suggested) || !skillList(snapshot.used))) return null;
  if (r.taskId !== undefined && !str(r.taskId, 80) || r.taskVersion !== undefined && (!count(r.taskVersion) || r.taskVersion < 1)) return null;
  if (report?.canonical && (report.canonical.runId !== r.runId || report.canonical.taskId !== r.taskId || report.canonical.taskVersion !== r.taskVersion)) return null;
  return {
    ...(r.taskId ? { taskId: r.taskId as string } : {}), ...(r.taskVersion ? { taskVersion: r.taskVersion as number } : {}),
    ...(scope ? { scope: { brainRoot: scope.brainRoot, projectRoot: scope.projectRoot } } : {}),
    ...(r.turns !== undefined ? { turns: r.turns as number } : {}),
    ...(delivery ? { delivery: structuredClone(delivery) } : {}),
    ...(snapshot ? { skillSuggestions: { at: snapshot.at, suggested: [...snapshot.suggested], used: [...snapshot.used] } } : {}),
    ...(r.taskContract && typeof r.taskContract === 'object' && typeof (r.taskContract as { goal?: unknown }).goal === 'string' && Array.isArray((r.taskContract as { doneWhen?: unknown }).doneWhen) && (r.taskContract as { doneWhen: unknown[] }).doneWhen.every(x => typeof x === 'string') ? { taskContract: r.taskContract as AgentRun['taskContract'] } : {}),
    runId: r.runId, chatId: r.chatId, agentId: r.agentId, version: r.version, goal: r.goal, startedBy: r.startedBy as AgentRun['startedBy'], startedAt: r.startedAt,
    ...(r.parentRunId ? { parentRunId: r.parentRunId as string } : {}),
    ...(r.tier ? { tier: r.tier as ModelTier } : {}), ...(r.model !== undefined ? { model: r.model as string | null } : {}),
    ...(r.reviewOf ? { reviewOf: r.reviewOf as string } : {}), ...(r.reworkOf ? { reworkOf: r.reworkOf as string } : {}),
    ...(r.continuedFrom ? { continuedFrom: r.continuedFrom as string } : {}),
    ...(r.endedAt !== undefined ? { endedAt: r.endedAt, endReason: r.endReason as AgentRunEnd } : {}),
    ...(outcome ? { outcome } : {}),
    ...(r.source ? { source: r.source as AgentRun['source'] } : {}),
    ...(r.requestOrigin ? { requestOrigin: r.requestOrigin as AgentRun['requestOrigin'] } : {}),
    ...(oneshot ? { oneshot: { engine: oneshot.engine, job: oneshot.job, fallback: oneshot.fallback, costBasis: oneshot.costBasis, ...(oneshot.ok !== undefined ? { ok: oneshot.ok } : {}) } } : {}),
    counters: { questions: c.questions, permissions: c.permissions, commands: c.commands, reopened: c.reopened, contextPeak: c.contextPeak as number | null },
    costUsd: r.costUsd as number | null, tokens,
    ...(report ? { report } : {}), ...(corrections ? { corrections } : {}), ...(r.executionMs !== undefined ? { executionMs: r.executionMs as number } : {}),
    ...(tags ? { tags } : {}),
    // receipts out of shape are dropped, never the run (ADR 0130)
    ...(receipts ? { receipts } : {}),
    // a plan record out of shape is dropped, never the run (ADR 0131)
    ...(plan ? { plan } : {}),
  };
}
/** A run's plan record (ADR 0131), or null when absent or out of shape. */
function readPlan(v: unknown): AgentRunPlan | null {
  const p = v as Record<string, unknown> | null;
  if (!p || typeof p !== 'object' || !count(p.proposals) || !count(p.changes) || (p.approvedAt !== undefined && !time(p.approvedAt))) return null;
  return { proposals: p.proposals, changes: p.changes, ...(p.approvedAt !== undefined ? { approvedAt: p.approvedAt as number } : {}) };
}

/** Ends an open run; false when it had already ended (the first end wins). */
export function endRun(run: AgentRun, reason: AgentRunEnd, at: number): boolean {
  if (run.endedAt !== undefined) return false;
  run.endedAt = at; run.endReason = reason;
  return true;
}
/** Brother goes on with an ended run: it is open again, its old verdict no longer holds, and it counts as reworked. */
export function reopenRun(run: AgentRun): boolean {
  if (run.endedAt === undefined) return false;
  delete run.endedAt; delete run.endReason; delete run.outcome;
  if (run.receipts) delete run.receipts.verdict; // decided again at its next end
  run.counters.reopened++;
  return true;
}
/** No turn and nothing waiting on Brother for STALE_MS (a pending request pauses the clock: `idleSince` restarts when it is answered). */
export const staleDue = (run: AgentRun, idleSince: number, waiting: boolean, now: number): boolean => run.endedAt === undefined && !waiting && now - idleSince >= STALE_MS;
/** A settled turn; an explicit result receipt may arrive after completion. Missing engine cost/tokens stay unknown. */
export function addTurn(run: AgentRun, usd: number | null, tokens: AgentRunTokens | undefined, settledReceipt = false): void {
  if (run.endedAt !== undefined && !settledReceipt) return;
  if (run.turns !== undefined) run.turns++;
  run.costUsd = usd === null || run.costUsd === null ? null : Math.round((run.costUsd + usd) * 1e6) / 1e6;
  if (!tokens || !run.tokens) { run.tokens = null; return; }
  for (const k of ['input', 'cacheRead', 'cacheWrite', 'output'] as const) run.tokens[k] += tokens[k];
}

/** Links a new run may carry: the delegating chat's run (agent_delegate), the run an independent review (a Sentinel) reviews, the run it reworks;
 *  each must name a run the store knows. */
export interface RunLinks { parentRunId?: string; reviewOf?: string; reworkOf?: string }
export interface RunStart extends RunLinks { chatId: string; agentId: string; version: number; goal: string; startedBy: AgentRun['startedBy']; requestOrigin?: AgentRun['requestOrigin']; startedAt: number; costKnown: boolean; tags?: AgentRunTags; tier?: ModelTier; model?: string | null }

const sample = (v: unknown): boolean => { const s = v as { n?: unknown; values?: unknown; sum?: unknown } | null; return !!s && count(s.n) && Array.isArray(s.values) && s.values.length <= SAMPLE_MAX && s.values.length <= s.n && s.values.every(time)
  && (s.sum === undefined || typeof s.sum === 'number' && Number.isFinite(s.sum) && s.sum >= 0); };
const verdicts = (v: unknown): boolean => { const x = v as Record<string, unknown> | null; return !!x && count(x.success) && count(x.partial) && count(x.fail); };
const counts = (v: unknown): v is TagTally => {
  const t = v as Record<string, unknown> | null, c = t?.corrections as Record<string, unknown> | null, a = t?.aiErrors as Record<string, unknown> | null;
  return !!t && typeof t === 'object' && count(t.ended) && verdicts(t.verdicts) && verdicts(t.opinion) && verdicts(t.selfReport) && count(t.reworked) && count(t.questions) && count(t.permissions) && count(t.commands)
    && !!c && count(c.runs) && count(c.tagged) && count(c.afterReport) && !!a && count(a.runs) && count(a.lines);
};
const bucket = (v: unknown, key: (k: string) => boolean): boolean => !!v && typeof v === 'object' && !Array.isArray(v) && Object.entries(v).every(([k, t]) => key(k) && counts(t));
const tagTallies = (v: unknown): boolean => {
  const t = v as Record<string, unknown> | null;
  const combinedKey = (k: string): boolean => {
    try {
      const a: unknown = JSON.parse(k);
      return Array.isArray(a) && a.length === 3 && a.filter(x => x !== null).length >= 2
        && (a[0] === null || typeof a[0] === 'string' && SKILL_ID.test(a[0]))
        && (a[1] === null || tagName(a[1], APP_MAX)) && (a[2] === null || tagName(a[2], REPO_MAX)) && JSON.stringify(a) === k;
    } catch { return false; }
  };
  return !!t && typeof t === 'object' && bucket(t.skills, k => SKILL_ID.test(k)) && bucket(t.apps, k => tagName(k, APP_MAX)) && bucket(t.repos, k => tagName(k, REPO_MAX))
    && (t.combined === undefined || bucket(t.combined, combinedKey));
};
/** A stored rollup, or null when out of shape (the store then refuses the file, like a bad run). */
export function readTally(v: unknown): RunTally | null {
  const t = v as Record<string, unknown> | null;
  if (!t || typeof t !== 'object' || !str(t.agentId, 80) || !AGENT_ID.test(t.agentId) || !count(t.version) || !count(t.ended) || !verdicts(t.verdicts) || !verdicts(t.opinion) || !verdicts(t.selfReport)
    || !count(t.reworked) || !count(t.questions) || !count(t.permissions) || !count(t.commands)) return null;
  const c = t.corrections as Record<string, unknown> | null, a = t.aiErrors as Record<string, unknown> | null, k = t.tokens as Record<string, unknown> | null;
  if (!c || !count(c.runs) || !count(c.tagged) || !count(c.afterReport) || !a || !count(a.runs) || !count(a.lines) || !k || !['input', 'output', 'cacheRead', 'cacheWrite'].every(x => sample(k[x]))
    || ![t.cost, t.contextPeak, t.elapsed, t.execution].every(sample)) return null;
  const reviews = t.reviews as Record<string, Record<string, unknown>> | null;
  if (!reviews || typeof reviews !== 'object' || Array.isArray(reviews) || !Object.entries(reviews).every(([key, r]) => /^[a-z][a-z0-9_-]{0,79}\/\d+$/.test(key) && r && count(r.runs) && r.runs > 0 && count(r.findings) && count(r.blockingRuns) && count(r.blocking))) return null;
  if (t.decisions !== undefined && !count(t.decisions)) return null;
  if (t.decisionWins !== undefined && (!count(t.decisionWins) || t.decisionWins > ((t.decisions as number | undefined) ?? 0))) return null;
  if (t.earnedWins !== undefined && (!count(t.earnedWins) || t.earnedWins > (t.ended as number))) return null;
  // XP (ADR 0131): at most XP_MAX a run; a rollup saved before it has none (its successes count at their floor)
  const xpOk = (v: unknown, max: number) => v === undefined || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max);
  if (!xpOk(t.xp, XP_MAX * (t.ended as number)) || !xpOk(t.decisionXp, XP_MAX * ((t.decisions as number | undefined) ?? 0))) return null;
  if ((t.tags !== undefined && !tagTallies(t.tags)) || (t.tagsLost !== undefined && t.tagsLost !== true) || (t.tags !== undefined && t.tagsLost !== undefined)) return null;
  const result = structuredClone(t) as unknown as RunTally;
  if (result.verdictSchema !== 2) {
    // Old rollups mix self-reported silence with independent outcomes. Counts remain, quality is unknown.
    result.verdicts = { success: 0, partial: 0, fail: 0 };
    result.decisionWins = 0;
    result.earnedWins = 0;
    delete result.xp; delete result.decisionXp;
    for (const bucket of Object.values(result.tags ?? {})) for (const tag of Object.values(bucket as Record<string, TagTally>)) tag.verdicts = { success: 0, partial: 0, fail: 0 };
    result.verdictSchema = 2;
  }
  return result;
}

/** agent-runs.json `{version:1, runs, rollups}`: bounded by count and bytes; only ended runs are ever pruned, oldest end
 *  first, and only after they are folded into their (agentId, version) rollup. A review is pruned with the run it reviews. */
export class AgentRunStore {
  private readonly file: string;
  private runs = new Map<string, AgentRun>();
  private rollups: RunTally[] = [];
  /** the latest end among the pruned runs: a chat mirror of an ended run up to it is already in the rollups, never adopted */
  private prunedThrough = 0;
  private flash: FlashLog = emptyFlashLog();
  private dirty = false;
  /** Exact preimage retained until an exclusive recovery copy is durable; repair never discards malformed rows. */
  private recoverySource: Buffer | null = null;
  /** the runs just pruned (folded into the rollups): ChatManager drops their chat mirrors */
  onPrune?: (runIds: Set<string>) => void;
  /** set when the file cannot be read: it is kept as it is and no run is recorded until Brother fixes or moves it */
  problem: string | null = null;
  constructor(userData: string) {
    this.file = path.join(userData, 'agent-runs.json');
    try {
      const raw = readLocal(this.file) as { version?: unknown; runs?: unknown; rollups?: unknown; prunedThrough?: unknown } | undefined;
      if (raw === undefined) return;
      if (raw.version !== 1 || !Array.isArray(raw.runs) || raw.runs.length > RUNS_MAX || (raw.rollups !== undefined && !Array.isArray(raw.rollups)) || (raw.prunedThrough !== undefined && !time(raw.prunedThrough))) throw new Error('Invalid agent runs');
      this.prunedThrough = (raw.prunedThrough as number | undefined) ?? 0;
      // Flash's outcomes (ADR 0131): out of shape = a fresh log, never a reason to refuse the file
      if ((raw as { flash?: unknown }).flash !== undefined) this.flash = readFlashLog((raw as { flash?: unknown }).flash);
      const keys = new Set<string>();
      for (const v of (raw.rollups ?? []) as unknown[]) {
        const t = readTally(v);
        if (!t || keys.has(`${t.agentId}/${t.version}`)) throw new Error('Invalid agent run rollup');
        keys.add(`${t.agentId}/${t.version}`); this.rollups.push(t);
      }
      let skipped = 0;
      for (const v of raw.runs) {
        const run = readRun(v);
        if (!run || this.runs.has(run.runId)) { skipped++; continue; }
        this.runs.set(run.runId, run);
      }
      if (skipped) {
        // Preserve the original before the next repaired write; a concurrent file change refuses recovery.
        const source = fs.readFileSync(this.file);
        if (JSON.stringify(JSON.parse(source.toString('utf8'))) !== JSON.stringify(raw)) throw new Error('Run file changed during recovery');
        this.recoverySource = source;
        this.dirty = true;
        log.warn('agents', 'invalid agent run records skipped', { data: { skipped, kept: this.runs.size },
          hint: 'valid runs were recovered; new runs can still be recorded' });
      }
    } catch { this.runs.clear(); this.rollups = []; this.prunedThrough = 0; this.flash = emptyFlashLog(); this.problem = 'Il registro delle esecuzioni degli Agenti non è leggibile. Il file è conservato; le nuove esecuzioni non vengono registrate.'; }
  }

  /** Flash's answer outcomes (flash-outcomes.ts, ADR 0131): a copy. */
  flashLog(): FlashLog { return structuredClone(this.flash); }
  /** The user asked Flash / Flash answered / the user wrote to the Orchestrator: written with the next flush. */
  flashEvent(e: { kind: 'asked' | 'handed'; text: string; at: number } | { kind: 'answered'; at: number }): void {
    if (this.problem) return;
    if (e.kind === 'asked') flashAsked(this.flash, e.text, e.at);
    else if (e.kind === 'handed') { if (!this.flash.open.length) return; flashHanded(this.flash, e.text, e.at); }
    else flashAnswered(this.flash, e.at);
    this.dirty = true;
  }

  /** The live record (the chat's mirror is this same object). */
  get(runId: string): AgentRun | undefined { return this.runs.get(runId); }
  list(): AgentRun[] { return [...this.runs.values()]; }
  /** What the pruned runs left (runMetrics merges them in). */
  rolledUp(): RunTally[] { return structuredClone(this.rollups); }
  /** Open runs delegated by this one (agent_delegate). */
  children(runId: string): AgentRun[] { return this.list().filter(r => r.parentRunId === runId && r.endedAt === undefined); }

  /** Refuses links to unknown runs. */
  checkLinks(l: RunLinks): void {
    for (const k of ['parentRunId', 'reviewOf', 'reworkOf'] as const) if (l[k] !== undefined && !this.runs.has(l[k])) throw new Error(`Esecuzione collegata non trovata: ${String(l[k])}`);
  }

  /** save = false: the caller writes once after several starts. */
  start(s: RunStart, save = true): AgentRun {
    if (this.problem) throw new Error(this.problem);
    if (!AGENT_ID.test(s.agentId) || !str(s.chatId, 80) || !count(s.version) || (s.tags !== undefined && !readTags(s.tags))) throw new Error('Esecuzione non valida.');
    this.checkLinks(s);
    const run: AgentRun = {
      runId: newRunId(), chatId: s.chatId, agentId: s.agentId, version: s.version, goal: s.goal.trim().slice(0, GOAL_MAX), startedBy: s.startedBy, startedAt: s.startedAt,
      requestOrigin: s.requestOrigin ?? (s.startedBy === 'user' ? 'user' : s.startedBy === 'app' ? 'app' : 'agent'),
      ...(s.parentRunId ? { parentRunId: s.parentRunId } : {}),
      ...(s.tier ? { tier: s.tier } : {}), ...(s.model !== undefined ? { model: s.model } : {}),
      ...(s.reviewOf ? { reviewOf: s.reviewOf } : {}), ...(s.reworkOf ? { reworkOf: s.reworkOf } : {}),
      counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null },
      costUsd: s.costKnown ? 0 : null, turns: 0, tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
      corrections: { tagged: 0, afterReport: 0 }, executionMs: 0,
      ...(s.tags ? { tags: readTags(s.tags)! } : {}),
    };
    this.runs.set(run.runId, run);
    if (!save) { this.dirty = true; return run; }
    try { this.save(); } catch (e) { this.runs.delete(run.runId); throw e; }
    return run;
  }
  /** A run known only from a chat's mirror (written before a lost or reset store): taken back as it is; undefined = an
   *  ended run already pruned into the rollups (adopting it would count it twice). */
  adopt(run: AgentRun): AgentRun | undefined {
    if (this.problem) throw new Error(this.problem);
    const known = this.runs.get(run.runId);
    if (known) return known;
    if (run.endedAt !== undefined && run.endedAt <= this.prunedThrough) return undefined;
    this.runs.set(run.runId, run); this.dirty = true;
    return run;
  }
  /** Something changed in a record that is worth a write on the next flush (cost, tokens, context peak). */
  touch(): void { this.dirty = true; }
  /** A deferred write still in flight counts as unsaved: the quit's flush writes synchronously over it. */
  flush(): void { if (this.dirty || this.inflight) this.save(); }
  /** something is waiting to be written (dirty) or being written (a deferred write in flight) */
  get pending(): boolean { return this.dirty || this.inflight > 0; }

  /** bumped by every write started: a deferred write that sees a newer one drops itself and commits nothing */
  private gen = 0;
  private inflight = 0;

  save(): void {
    const t = performance.now();
    try { const w = this.prepare(); this.gen++; writeLocalText(this.file, w.body); this.dirty = false; w.commit(); } finally { slowStep('agent-runs.json write', performance.now() - t); }
  }

  /** The deferred save (ChatManager with writeDelayMs): serialized now, written asynchronously (tmp + rename with
   *  retries that never block the main process). Its prune (if any) is committed only when its own body landed and no
   *  newer write was started meanwhile; a failure leaves the store dirty for the next flush. Never throws. */
  async saveAsync(): Promise<void> {
    if (!this.dirty || this.problem) return;
    // a pending recovery copy is a rare, synchronous, one-off path
    if (this.recoverySource) { try { this.save(); } catch (e) { log.warn('agents', 'agent runs not saved', { cause: errText(e), hint: 'the next run change writes them again' }); } return; }
    const t = performance.now();
    let w: { body: string; commit: () => void };
    try { w = this.prepare(); } catch (e) { log.warn('agents', 'agent runs not saved', { cause: errText(e), hint: 'the next run change writes them again' }); return; }
    finally { slowStep('agent-runs.json serialize', performance.now() - t); }
    const gen = ++this.gen;
    this.dirty = false; // a change from now on sets it again
    this.inflight++;
    try {
      if (await writeLocalTextAsync(this.file, w.body, () => this.gen === gen)) w.commit();
    } catch (e) {
      if (this.gen === gen) this.dirty = true;
      log.warn('agents', 'agent runs not saved (deferred)', { cause: errText(e), hint: 'the next run change or the quit writes them again' });
    } finally { this.inflight--; }
  }

  /** The body to write now and what to apply once it is on disk (the pruned runs leave memory, the rollups grow). */
  private prepare(): { body: string; commit: () => void } {
    if (this.problem) throw new Error(this.problem);
    if (this.recoverySource) {
      const stat = fs.lstatSync(this.file);
      if (!stat.isFile() || stat.nlink !== 1 || !fs.readFileSync(this.file).equals(this.recoverySource)) throw new Error('Il registro è cambiato durante il recupero: riapri l’app prima di salvare.');
      const hash = crypto.createHash('sha256').update(this.recoverySource).digest('hex');
      const recovered = path.join(path.dirname(this.file), `agent-runs-recovery-${hash}.json`);
      let fd: number | undefined;
      try {
        fd = fs.openSync(recovered, 'wx', 0o600);
        fs.writeFileSync(fd, this.recoverySource); fs.fsyncSync(fd);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const saved = fs.lstatSync(recovered);
        if (!saved.isFile() || saved.nlink !== 1 || !fs.readFileSync(recovered).equals(this.recoverySource)) throw new Error('La copia del registro recuperato non è valida; originale conservato.');
      } finally { if (fd !== undefined) fs.closeSync(fd); }
      this.recoverySource = null;
    }
    const all = this.list();
    const ended = all.filter(r => r.endedAt !== undefined).sort((a, b) => a.endedAt! - b.endedAt! || a.startedAt - b.startedAt);
    // Runs on the main process at every run event: the file (up to RUNS_BYTES) is written compact and serialized once
    // when nothing has to go; only a store over its budget measures runs one by one.
    const bytesOf = (v: unknown) => Buffer.byteLength(JSON.stringify(v), 'utf8');
    const record = (runs: AgentRun[], rollups: RunTally[], prunedThrough: number) =>
      ({ version: 1, runs, ...(rollups.length ? { rollups } : {}), ...(prunedThrough ? { prunedThrough } : {}),
        // Flash's outcomes: bounded by flash-outcomes.ts (a few tens of KB at most), inside the same byte budget
        ...(this.flash.open.length || this.flash.done.length || this.flash.asking || this.flash.total.success + this.flash.total.partial + this.flash.total.fail ? { flash: this.flash } : {}) });
    const whole = `${JSON.stringify(record(all, this.rollups, this.prunedThrough))}\n`;
    // the rollups only grow when runs are pruned: their budget is checked with the runs about to go
    const budget = RUNS_BYTES - Math.min(ROLLUP_BYTES, this.rollups.length ? bytesOf(this.rollups) : 0);
    const drop = new Set<AgentRun>();
    let bytes = Buffer.byteLength(whole, 'utf8');
    const over = () => all.length - drop.size > RUNS_MAX || bytes > budget;
    this.dirty = true; // stays set when the write fails: the next flush tries again
    if (!over()) return { body: whole, commit: () => {} };
    const take = (r: AgentRun) => { if (!drop.has(r)) { drop.add(r); bytes -= bytesOf(r); } };
    // a review goes with the run it reviews (its findings count there); then, if still over, any ended run
    for (const r of ended) {
      if (!over()) break;
      if (r.reviewOf && this.runs.has(r.reviewOf)) continue;
      if (all.some(v => v.reviewOf === r.runId && v.endedAt === undefined)) continue; // its review is still being written
      take(r);
      for (const v of ended) if (v.reviewOf === r.runId) take(v);
    }
    for (const r of ended) { if (!over()) break; take(r); }
    const rollups = drop.size ? fitRollups(rollUp(this.rollups, [...drop], all)) : this.rollups;
    const next = all.filter(r => !drop.has(r));
    const prunedThrough = Math.max(this.prunedThrough, ...[...drop].map(r => r.endedAt!));
    return {
      body: `${JSON.stringify(record(next, rollups, prunedThrough))}\n`,
      commit: () => {
        for (const r of drop) this.runs.delete(r.runId);
        this.rollups = rollups; this.prunedThrough = prunedThrough;
        if (drop.size) this.onPrune?.(new Set([...drop].map(r => r.runId)));
      },
    };
  }
}

/** Past ROLLUP_BYTES, first drops the per-tag counts of the rollup with the most tags (filters then leave it out), then
 *  halves the samples of the largest rollup until they fit: medians then rest on fewer, newest values. */
export function fitRollups(rollups: RunTally[]): RunTally[] {
  const out = structuredClone(rollups);
  const tagCount = (t: RunTally) => t.tags ? Object.keys(t.tags.skills).length + Object.keys(t.tags.apps).length + Object.keys(t.tags.repos).length + Object.keys(t.tags.combined ?? {}).length + 1 : 0;
  while (Buffer.byteLength(JSON.stringify(out, null, 2), 'utf8') > ROLLUP_BYTES) {
    const big = out.reduce((a, b) => tagCount(b) > tagCount(a) ? b : a, out[0]!);
    if (!big || tagCount(big) === 0) break;
    delete big.tags; big.tagsLost = true;
  }
  const samples = (t: RunTally) => [t.cost, t.contextPeak, t.elapsed, t.execution, ...Object.values(t.tokens)];
  const size = (t: RunTally) => samples(t).reduce((n, s) => n + s.values.length, 0);
  while (Buffer.byteLength(JSON.stringify(out, null, 2), 'utf8') > ROLLUP_BYTES) {
    const big = out.reduce((a, b) => size(b) > size(a) ? b : a, out[0]!);
    if (!big || size(big) === 0) break;
    for (const s of samples(big)) s.values = s.values.slice(Math.ceil(s.values.length / 2));
  }
  return out;
}
