// Agent runs (AGENTS-DESIGN §1.2, §5): one record per chat started from a catalog agent, kept in agent-runs.json after
// chats.json forgets the chat (60 closed chats). The pure lifecycle steps live here; ChatManager calls them on start,
// end (completed / closed / stale), Brother's reopen, pending requests and settled turns.
import path from 'node:path';
import crypto from 'node:crypto';
import type { AgentRun, AgentRunEnd, AgentRunOutcome, AgentRunTokens } from '../../shared/agents';
import { readLocal, writeLocal } from './local-store';

export const RUNS_MAX = 5000;
/** Below the local store's 8 MB cap, with headroom for the run being added. */
export const RUNS_BYTES = 7_000_000;
export const GOAL_MAX = 2000;
/** a run with no turn and nothing waiting on Brother for this long ends as stale (first guess, AGENTS-DESIGN §7) */
export const STALE_MS = 72 * 3600_000;

const ENDS: readonly AgentRunEnd[] = ['completed', 'closed', 'stale'];
const VERDICTS: readonly AgentRunOutcome['verdict'][] = ['success', 'partial', 'fail', 'unknown'];
const BASES: readonly AgentRunOutcome['basis'][] = ['human', 'reviewed-evidence', 'orchestrator-opinion', 'self-report', 'unknown'];
const RUN_ID = /^r_[a-f0-9]{12}$/;
const AGENT_ID = /^[a-z][a-z0-9_-]{0,79}$/;
const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const time = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const str = (v: unknown, max: number): v is string => typeof v === 'string' && !!v && v.length <= max;

export const newRunId = (): string => `r_${crypto.randomBytes(6).toString('hex')}`;

function readOutcome(v: unknown): AgentRunOutcome | null {
  const o = v as Partial<AgentRunOutcome> | null;
  if (!o || typeof o !== 'object' || !VERDICTS.includes(o.verdict!) || !BASES.includes(o.basis!) || !time(o.at) || !str(o.by, 80) || (o.note !== undefined && (typeof o.note !== 'string' || o.note.length > 600))) return null;
  return { verdict: o.verdict!, basis: o.basis!, at: o.at, by: o.by, ...(o.note !== undefined ? { note: o.note } : {}) };
}
function readTokens(v: unknown): AgentRunTokens | null {
  const t = v as Partial<AgentRunTokens> | null;
  return t && typeof t === 'object' && count(t.input) && count(t.cacheRead) && count(t.cacheWrite) && count(t.output) ? { input: t.input, cacheRead: t.cacheRead, cacheWrite: t.cacheWrite, output: t.output } : null;
}

/** A stored run, or null when any field is out of shape (the store refuses the file; chats.json drops the mirror). */
export function readRun(v: unknown): AgentRun | null {
  const r = v as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || !str(r.runId, 20) || !RUN_ID.test(r.runId) || !str(r.chatId, 80) || !str(r.agentId, 80) || !AGENT_ID.test(r.agentId)
    || !count(r.version) || typeof r.goal !== 'string' || r.goal.length > GOAL_MAX || (r.startedBy !== 'user' && r.startedBy !== 'orchestrator') || !time(r.startedAt)) return null;
  for (const k of ['parentRunId', 'spawnedBy', 'reviewOf', 'reworkOf'] as const) if (r[k] !== undefined && !(typeof r[k] === 'string' && RUN_ID.test(r[k]))) return null;
  if ((r.endedAt === undefined) !== (r.endReason === undefined) || (r.endedAt !== undefined && !time(r.endedAt)) || (r.endReason !== undefined && !ENDS.includes(r.endReason as AgentRunEnd))) return null;
  const outcome = r.outcome === undefined ? undefined : readOutcome(r.outcome);
  if (outcome === null) return null;
  const c = r.counters as Record<string, unknown> | null;
  if (!c || typeof c !== 'object' || !count(c.questions) || !count(c.permissions) || !count(c.commands) || !count(c.reopened) || !(c.contextPeak === null || count(c.contextPeak))) return null;
  if (!(r.costUsd === null || time(r.costUsd))) return null;
  const tokens = r.tokens === null ? null : readTokens(r.tokens);
  if (r.tokens !== null && !tokens) return null;
  return {
    runId: r.runId, chatId: r.chatId, agentId: r.agentId, version: r.version, goal: r.goal, startedBy: r.startedBy, startedAt: r.startedAt,
    ...(r.parentRunId ? { parentRunId: r.parentRunId as string } : {}), ...(r.spawnedBy ? { spawnedBy: r.spawnedBy as string } : {}),
    ...(r.reviewOf ? { reviewOf: r.reviewOf as string } : {}), ...(r.reworkOf ? { reworkOf: r.reworkOf as string } : {}),
    ...(r.endedAt !== undefined ? { endedAt: r.endedAt, endReason: r.endReason as AgentRunEnd } : {}),
    ...(outcome ? { outcome } : {}),
    counters: { questions: c.questions, permissions: c.permissions, commands: c.commands, reopened: c.reopened, contextPeak: c.contextPeak as number | null },
    costUsd: r.costUsd as number | null, tokens,
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
export interface RunStart extends RunLinks { chatId: string; agentId: string; version: number; goal: string; startedBy: AgentRun['startedBy']; startedAt: number; costKnown: boolean }

/** agent-runs.json `{version:1, runs}`: bounded by count and bytes; only ended runs are ever pruned, oldest end first. */
export class AgentRunStore {
  private readonly file: string;
  private runs = new Map<string, AgentRun>();
  private dirty = false;
  /** set when the file cannot be read: it is kept as it is and no run is recorded until Brother fixes or moves it */
  problem: string | null = null;
  constructor(userData: string) {
    this.file = path.join(userData, 'agent-runs.json');
    try {
      const raw = readLocal(this.file) as { version?: unknown; runs?: unknown } | undefined;
      if (raw === undefined) return;
      if (raw.version !== 1 || !Array.isArray(raw.runs) || raw.runs.length > RUNS_MAX) throw new Error('Invalid agent runs');
      for (const v of raw.runs) {
        const run = readRun(v);
        if (!run || this.runs.has(run.runId)) throw new Error('Invalid agent run');
        this.runs.set(run.runId, run);
      }
    } catch { this.runs.clear(); this.problem = 'Il registro delle esecuzioni degli Agenti non è leggibile. Il file è conservato; le nuove esecuzioni non vengono registrate.'; }
  }

  /** The live record (the chat's mirror is this same object). */
  get(runId: string): AgentRun | undefined { return this.runs.get(runId); }
  list(): AgentRun[] { return [...this.runs.values()]; }
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
    if (!AGENT_ID.test(s.agentId) || !str(s.chatId, 80) || !count(s.version)) throw new Error('Esecuzione non valida.');
    this.checkLinks(s);
    const run: AgentRun = {
      runId: newRunId(), chatId: s.chatId, agentId: s.agentId, version: s.version, goal: s.goal.trim().slice(0, GOAL_MAX), startedBy: s.startedBy, startedAt: s.startedAt,
      ...(s.spawnedBy ? { parentRunId: s.spawnedBy, spawnedBy: s.spawnedBy } : s.parentRunId ? { parentRunId: s.parentRunId } : {}),
      ...(s.reviewOf ? { reviewOf: s.reviewOf } : {}), ...(s.reworkOf ? { reworkOf: s.reworkOf } : {}),
      counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null },
      costUsd: s.costKnown ? 0 : null, tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
    };
    this.runs.set(run.runId, run);
    if (!save) { this.dirty = true; return run; }
    try { this.save(); } catch (e) { this.runs.delete(run.runId); throw e; }
    return run;
  }
  /** A run known only from a chat's mirror (written before a lost or reset store): taken back as it is. */
  adopt(run: AgentRun): AgentRun {
    if (this.problem) throw new Error(this.problem);
    const known = this.runs.get(run.runId);
    if (known) return known;
    this.runs.set(run.runId, run); this.dirty = true;
    return run;
  }
  /** Something changed in a record that is worth a write on the next flush (cost, tokens, context peak). */
  touch(): void { this.dirty = true; }
  flush(): void { if (this.dirty) this.save(); }

  save(): void {
    if (this.problem) throw new Error(this.problem);
    const all = this.list();
    const ended = all.filter(r => r.endedAt !== undefined).sort((a, b) => a.endedAt! - b.endedAt! || a.startedAt - b.startedAt);
    const drop = new Set<AgentRun>(ended.slice(0, Math.max(0, all.length - RUNS_MAX)));
    const size = (list: AgentRun[]) => Buffer.byteLength(JSON.stringify({ version: 1, runs: list }, null, 2), 'utf8') + 1;
    let bytes = size(all.filter(r => !drop.has(r)));
    for (const r of ended) {
      if (bytes <= RUNS_BYTES) break;
      if (drop.has(r)) continue;
      drop.add(r);
      bytes -= Buffer.byteLength(JSON.stringify(r, null, 2), 'utf8');
    }
    const next = all.filter(r => !drop.has(r));
    this.dirty = true; // stays set when the write fails: the next flush tries again
    writeLocal(this.file, { version: 1, runs: next });
    for (const r of drop) this.runs.delete(r.runId);
    this.dirty = false;
  }
}
