// Agent runs (AGENTS-DESIGN §1.2, §5): one record per chat started from a catalog agent, kept in agent-runs.json after
// chats.json forgets the chat (60 closed chats). The pure lifecycle steps live here; ChatManager calls them on start,
// end (completed / closed / stale), Brother's reopen, pending requests and settled turns.
import path from 'node:path';
import crypto from 'node:crypto';
import type { AgentRun, AgentRunCorrections, AgentRunEnd, AgentRunOutcome, AgentRunReport, AgentRunRouting, AgentRunTags, AgentRunTokens } from '../../shared/agents';
import { SUMMARY_MAX } from './run-report';
import { rollUp, SAMPLE_MAX, type RunTally, type TagTally } from './run-metrics';
import { readLocal, writeLocal } from './local-store';

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
const BASES: readonly AgentRunOutcome['basis'][] = ['human', 'reviewed-evidence', 'orchestrator-opinion', 'self-report', 'unknown'];
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
  if (r.ok === false) return { ok: false, at: r.at };
  if (r.ok !== true || !['done', 'partial', 'blocked'].includes(r.outcome as string) || !['yes', 'partial', 'no'].includes(r.verified as string) || !str(r.summary, SUMMARY_MAX)
    || (r.findings !== undefined && !count(r.findings)) || (r.blocking !== undefined && !count(r.blocking)) || (count(r.findings) && count(r.blocking) && r.blocking > r.findings)) return null;
  return { ok: true, at: r.at, outcome: r.outcome as 'done', verified: r.verified as 'yes', summary: r.summary,
    ...(r.findings !== undefined ? { findings: r.findings as number } : {}), ...(r.blocking !== undefined ? { blocking: r.blocking as number } : {}) };
}
function readCorrections(v: unknown): AgentRunCorrections | null {
  const c = v as Partial<AgentRunCorrections> | null;
  return c && typeof c === 'object' && count(c.tagged) && count(c.afterReport) ? { tagged: c.tagged, afterReport: c.afterReport } : null;
}

/** A routing snapshot (agents/routing-snapshot.ts), or null when out of shape. */
export function readRouting(v: unknown): AgentRunRouting | null {
  const r = v as Record<string, unknown> | null;
  const nullable = (x: unknown, ok: (x: unknown) => boolean) => x === null || ok(x);
  if (!r || typeof r !== 'object' || !time(r.at) || !str(r.agentId, 80) || !AGENT_ID.test(r.agentId) || !count(r.version)
    || !nullable(r.mode, x => x === 'hybrid' || x === 'words') || !nullable(r.score, x => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 100)
    || !nullable(r.rank, x => count(x) && (x as number) >= 1)) return null;
  const t = r.trial as Record<string, unknown> | undefined | null;
  if (t !== undefined && (!t || typeof t !== 'object' || !count(t.baseline) || (t.baseline as number) < 1 || !(t.parentWins === null || typeof t.parentWins === 'boolean'))) return null;
  return { at: r.at, agentId: r.agentId, version: r.version, mode: r.mode as AgentRunRouting['mode'], score: r.score as number | null, rank: r.rank as number | null,
    ...(t ? { trial: { baseline: t.baseline as number, parentWins: t.parentWins as boolean | null } } : {}) };
}

/** A stored run, or null when any field is out of shape (the store refuses the file; chats.json drops the mirror). */
export function readRun(v: unknown): AgentRun | null {
  const r = v as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || !str(r.runId, 20) || !RUN_ID.test(r.runId) || !str(r.chatId, 80) || !str(r.agentId, 80) || !AGENT_ID.test(r.agentId)
    || !count(r.version) || typeof r.goal !== 'string' || r.goal.length > GOAL_MAX || (r.startedBy !== 'user' && r.startedBy !== 'orchestrator') || !time(r.startedAt)) return null;
  for (const k of ['parentRunId', 'spawnedBy', 'reviewOf', 'reworkOf', 'continuedFrom'] as const) if (r[k] !== undefined && !(typeof r[k] === 'string' && RUN_ID.test(r[k]))) return null;
  if ((r.endedAt === undefined) !== (r.endReason === undefined) || (r.endedAt !== undefined && !time(r.endedAt)) || (r.endReason !== undefined && !ENDS.includes(r.endReason as AgentRunEnd))) return null;
  const outcome = r.outcome === undefined ? undefined : readOutcome(r.outcome);
  if (r.source !== undefined && r.source !== 'chat' && r.source !== 'oneshot') return null;
  const oneshot = r.oneshot as AgentRun['oneshot'];
  if (oneshot !== undefined && (!oneshot || typeof oneshot !== 'object' || !str(oneshot.engine, 80)
    || !['pulse', 'headline'].includes(oneshot.job) || typeof oneshot.fallback !== 'boolean'
    || !['reported', 'estimated', 'unknown'].includes(oneshot.costBasis))) return null;
  if (outcome === null) return null;
  const c = r.counters as Record<string, unknown> | null;
  if (!c || typeof c !== 'object' || !count(c.questions) || !count(c.permissions) || !count(c.commands) || !count(c.reopened) || !(c.contextPeak === null || count(c.contextPeak))) return null;
  if (!(r.costUsd === null || time(r.costUsd))) return null;
  const tokens = r.tokens === null ? null : readTokens(r.tokens);
  if (r.tokens !== null && !tokens) return null;
  const report = r.report === undefined ? undefined : readReport(r.report);
  const corrections = r.corrections === undefined ? undefined : readCorrections(r.corrections);
  const tags = r.tags === undefined ? undefined : readTags(r.tags);
  const routing = r.routing === undefined ? undefined : readRouting(r.routing);
  if (report === null || corrections === null || tags === null || routing === null || (r.executionMs !== undefined && !time(r.executionMs))) return null;
  return {
    runId: r.runId, chatId: r.chatId, agentId: r.agentId, version: r.version, goal: r.goal, startedBy: r.startedBy, startedAt: r.startedAt,
    ...(r.parentRunId ? { parentRunId: r.parentRunId as string } : {}), ...(r.spawnedBy ? { spawnedBy: r.spawnedBy as string } : {}),
    ...(r.reviewOf ? { reviewOf: r.reviewOf as string } : {}), ...(r.reworkOf ? { reworkOf: r.reworkOf as string } : {}),
    ...(r.continuedFrom ? { continuedFrom: r.continuedFrom as string } : {}),
    ...(r.endedAt !== undefined ? { endedAt: r.endedAt, endReason: r.endReason as AgentRunEnd } : {}),
    ...(outcome ? { outcome } : {}),
    ...(r.source ? { source: r.source as AgentRun['source'] } : {}),
    ...(oneshot ? { oneshot: { engine: oneshot.engine, job: oneshot.job, fallback: oneshot.fallback, costBasis: oneshot.costBasis } } : {}),
    counters: { questions: c.questions, permissions: c.permissions, commands: c.commands, reopened: c.reopened, contextPeak: c.contextPeak as number | null },
    costUsd: r.costUsd as number | null, tokens,
    ...(report ? { report } : {}), ...(corrections ? { corrections } : {}), ...(r.executionMs !== undefined ? { executionMs: r.executionMs as number } : {}),
    ...(tags ? { tags } : {}), ...(routing ? { routing } : {}),
  };
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
  run.counters.reopened++;
  return true;
}
/** No turn and nothing waiting on Brother for STALE_MS (a pending request pauses the clock: `idleSince` restarts when it is answered). */
export const staleDue = (run: AgentRun, idleSince: number, waiting: boolean, now: number): boolean => run.endedAt === undefined && !waiting && now - idleSince >= STALE_MS;
/** A settled turn while the run is open: its cost (null stays null: the engine reports none) and its tokens (one turn without them = unknown). */
export function addTurn(run: AgentRun, usd: number | null, tokens: AgentRunTokens | undefined): void {
  if (run.endedAt !== undefined) return;
  run.costUsd = usd === null || run.costUsd === null ? null : Math.round((run.costUsd + usd) * 1e6) / 1e6;
  if (!tokens || !run.tokens) { run.tokens = null; return; }
  for (const k of ['input', 'cacheRead', 'cacheWrite', 'output'] as const) run.tokens[k] += tokens[k];
}

/** Links a new run may carry (set by the Orchestrator tools, A7): each must name a run the store knows. */
export interface RunLinks { parentRunId?: string; spawnedBy?: string; reviewOf?: string; reworkOf?: string }
export interface RunStart extends RunLinks { chatId: string; agentId: string; version: number; goal: string; startedBy: AgentRun['startedBy']; startedAt: number; costKnown: boolean; tags?: AgentRunTags }

const sample = (v: unknown): boolean => { const s = v as { n?: unknown; values?: unknown } | null; return !!s && count(s.n) && Array.isArray(s.values) && s.values.length <= SAMPLE_MAX && s.values.length <= s.n && s.values.every(time); };
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
  if ((t.tags !== undefined && !tagTallies(t.tags)) || (t.tagsLost !== undefined && t.tagsLost !== true) || (t.tags !== undefined && t.tagsLost !== undefined)) return null;
  return structuredClone(t) as unknown as RunTally;
}

/** agent-runs.json `{version:1, runs, rollups}`: bounded by count and bytes; only ended runs are ever pruned, oldest end
 *  first, and only after they are folded into their (agentId, version) rollup. A review is pruned with the run it reviews. */
export class AgentRunStore {
  private readonly file: string;
  private runs = new Map<string, AgentRun>();
  private rollups: RunTally[] = [];
  /** the latest end among the pruned runs: a chat mirror of an ended run up to it is already in the rollups, never adopted */
  private prunedThrough = 0;
  private dirty = false;
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
      const keys = new Set<string>();
      for (const v of (raw.rollups ?? []) as unknown[]) {
        const t = readTally(v);
        if (!t || keys.has(`${t.agentId}/${t.version}`)) throw new Error('Invalid agent run rollup');
        keys.add(`${t.agentId}/${t.version}`); this.rollups.push(t);
      }
      for (const v of raw.runs) {
        const run = readRun(v);
        if (!run || this.runs.has(run.runId)) throw new Error('Invalid agent run');
        this.runs.set(run.runId, run);
      }
    } catch { this.runs.clear(); this.rollups = []; this.prunedThrough = 0; this.problem = 'Il registro delle esecuzioni degli Agenti non è leggibile. Il file è conservato; le nuove esecuzioni non vengono registrate.'; }
  }

  /** The live record (the chat's mirror is this same object). */
  get(runId: string): AgentRun | undefined { return this.runs.get(runId); }
  list(): AgentRun[] { return [...this.runs.values()]; }
  /** What the pruned runs left (runMetrics merges them in). */
  rolledUp(): RunTally[] { return structuredClone(this.rollups); }
  /** Open runs started by this one through agent_spawn. */
  children(runId: string): AgentRun[] { return this.list().filter(r => r.spawnedBy === runId && r.endedAt === undefined); }

  /** Refuses links to unknown runs, and a spawned run whose parent is another run. */
  checkLinks(l: RunLinks): void {
    for (const k of ['parentRunId', 'spawnedBy', 'reviewOf', 'reworkOf'] as const) if (l[k] !== undefined && !this.runs.has(l[k])) throw new Error(`Esecuzione collegata non trovata: ${String(l[k])}`);
    if (l.spawnedBy && l.parentRunId && l.parentRunId !== l.spawnedBy) throw new Error('Un’esecuzione avviata da un’altra ha quella come genitore.');
  }

  /** save = false: the caller writes once after several starts (the backfill). */
  start(s: RunStart, save = true): AgentRun {
    if (this.problem) throw new Error(this.problem);
    if (!AGENT_ID.test(s.agentId) || !str(s.chatId, 80) || !count(s.version) || (s.tags !== undefined && !readTags(s.tags))) throw new Error('Esecuzione non valida.');
    this.checkLinks(s);
    const run: AgentRun = {
      runId: newRunId(), chatId: s.chatId, agentId: s.agentId, version: s.version, goal: s.goal.trim().slice(0, GOAL_MAX), startedBy: s.startedBy, startedAt: s.startedAt,
      ...(s.spawnedBy ? { parentRunId: s.spawnedBy, spawnedBy: s.spawnedBy } : s.parentRunId ? { parentRunId: s.parentRunId } : {}),
      ...(s.reviewOf ? { reviewOf: s.reviewOf } : {}), ...(s.reworkOf ? { reworkOf: s.reworkOf } : {}),
      counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null },
      costUsd: s.costKnown ? 0 : null, tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
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
  /** The routing snapshot of a known run, set once (its agent and version must match the run's); false = refused. */
  setRouting(runId: string, routing: AgentRunRouting): boolean {
    const run = this.runs.get(runId), checked = readRouting(routing);
    if (this.problem || !run || run.routing || !checked || checked.agentId !== run.agentId || checked.version !== run.version) return false;
    run.routing = checked; this.dirty = true;
    return true;
  }
  /** Something changed in a record that is worth a write on the next flush (cost, tokens, context peak). */
  touch(): void { this.dirty = true; }
  flush(): void { if (this.dirty) this.save(); }

  save(): void {
    if (this.problem) throw new Error(this.problem);
    const all = this.list();
    const ended = all.filter(r => r.endedAt !== undefined).sort((a, b) => a.endedAt! - b.endedAt! || a.startedAt - b.startedAt);
    const bytesOf = (v: unknown) => Buffer.byteLength(JSON.stringify(v, null, 2), 'utf8');
    // the rollups only grow when runs are pruned: their budget is checked with the runs about to go
    const budget = (rollups: RunTally[]) => RUNS_BYTES - Math.min(ROLLUP_BYTES, bytesOf(rollups));
    const drop = new Set<AgentRun>();
    let bytes = bytesOf({ version: 1, runs: all, rollups: this.rollups }) + 1;
    const over = () => all.length - drop.size > RUNS_MAX || bytes > budget(this.rollups);
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
    this.dirty = true; // stays set when the write fails: the next flush tries again
    writeLocal(this.file, { version: 1, runs: next, ...(rollups.length ? { rollups } : {}), ...(prunedThrough ? { prunedThrough } : {}) });
    for (const r of drop) this.runs.delete(r.runId);
    this.rollups = rollups; this.prunedThrough = prunedThrough;
    this.dirty = false;
    if (drop.size) this.onPrune?.(new Set([...drop].map(r => r.runId)));
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
