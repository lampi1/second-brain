// The harness-neutral contract between ChatManager and one running CLI process (one chat = at most one session).
// Why: the manager must not know which engine a chat runs on (Claude Code: claude.ts, stream-json control protocol; an
// ACP engine: acp.ts, JSON-RPC); each adapter implements HarnessSession and reports through a SessionSink. Used by manager.ts (creates sessions, owns items/pending/persistence) and by every harness module.
import type { Root } from './proctree';
import type { AgentChildren, ChildObservation } from '../../shared/agents';
import type { Answer, ChatCommand, ChatItem, ChatState, Effort, Harness, ImageAttachment, PendingRequest, PermissionMode } from '../../shared/contract';

/** What a harness tells its owner. The owner (ChatManager) turns these into contract events. */
export interface SessionSink {
  /** A new item (replace = false) or a newer version of an item already sent with the same id (replace = true). */
  item(item: ChatItem, replace: boolean): void;
  /** A question or permission the CLI is blocked on (chatId is filled in by the owner). */
  pending(req: Omit<PendingRequest, 'chatId'>): void;
  /** A pending request is gone: answered, or withdrawn by the CLI (interrupt, another answer path). */
  resolved(requestId: string): void;
  /** Session facts changed (only the fields present). */
  changed(patch: SessionPatch): void;
  /** The process is gone. error = null for a normal end (stdin closed, close() asked); otherwise why, in Italian. */
  exit(info: { code: number | null; error: string | null }): void;
  /** Plan rate-limit info as the CLI sent it (Claude: a stream-json `rate_limit_event`), for the brain's usage meter. */
  rateLimit?(msg: unknown): void;
  /** The models the CLI offers (Cursor: models.availableModels of session/new or session/load), for the Settings page. */
  models?(list: { id: string; name: string }[]): void;
  /** The commands "/<name>" the engine offers in this chat (skills, its own commands), for the input's "/" list. */
  commands?(list: ChatCommand[]): void;
  /** Provider observations only: an absent callback or event is not a zero child census. */
  children?(observation: ChildObservation): void;
  childrenCoverage?(coverage: AgentChildren['coverage'], reason?: 'exit'): void;
}

/** An engine's command list → ChatCommand[]: Claude ({name, description, argumentHint}: initialize, commands_changed),
 *  ACP ({name, description, input: {hint}}: available_commands_update). Names with spaces (Claude's "x (MCP)") cannot be
 *  typed: left out. skill = a skill of the user or a project (in `skills`, or Claude's "(user)"/"(project)" label). */
export function toCommands(list: unknown, skills?: ReadonlySet<string>): ChatCommand[] {
  const out: ChatCommand[] = [];
  const seen = new Set<string>();
  for (const v of Array.isArray(list) ? list : []) {
    const c = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
    const name = typeof c.name === 'string' ? c.name.trim().replace(/^\//, '') : '';
    if (!name || /\s/.test(name) || seen.has(name) || name.length > 120) continue;
    seen.add(name);
    const raw = typeof c.description === 'string' ? c.description.trim() : '';
    const tag = /\s*\((user|project)\)$/.exec(raw);
    const input = c.input && typeof c.input === 'object' ? (c.input as Record<string, unknown>) : {};
    const hint = typeof c.argumentHint === 'string' ? c.argumentHint : typeof input.hint === 'string' ? input.hint : '';
    out.push({ name, description: cut(tag ? raw.slice(0, tag.index) : raw, 400), ...(hint.trim() ? { hint: hint.trim() } : {}), ...(tag || skills?.has(name) ? { skill: true } : {}) });
  }
  return out;
}

export interface SessionPatch {
  /** Outgoing next-turn parameter, not a provider-resolved effective value. */
  effortSubmitted?: string | null;
  /** Resolved by a supported thread/start or thread/resume response; not the current turn. */
  effortSessionDefault?: string | null;
  state?: ChatState;
  sessionId?: string;          // the CLI's own session id (learned at init, or new after a fork)
  model?: string;              // the model actually in use (from init)
  permissionMode?: PermissionMode;
  effort?: Effort | null;
  contextTokens?: number;
  contextMaxTokens?: number;
  /** true: contextTokens is an estimate (the engine reports none); false: a real count replaced the estimate */
  contextEstimated?: boolean;
  /** cost of the turn that just ended (USD, API-equivalent) and the CLI's running total for the session */
  turnCostUsd?: number;
  totalCostUsd?: number;
  /** estimate of the turn still running (USD, from token usage); 0 when it ended: turnCostUsd then holds the real cost */
  liveCostUsd?: number;
  /** false: the engine reports no usage, so turnCostUsd is 0 for lack of data (Cursor over ACP today) */
  costKnown?: boolean;
  lastText?: string;
  /** background tasks (agents, shell commands) still running after the turn; 0 = none */
  background?: number;
  version?: string;            // CLI version
  /** one API call of the main thread, once per response id (ADR 0031 counters): its context (input + cache read +
   *  cache write), the cache it re-wrote, its list-price cost */
  call?: { context: number; cacheWrite: number; usd: number };
  /** the tokens of the turn that just ended, when the engine reports them (Claude's result usage, ACP's prompt usage,
   *  an HTTP model's usage); absent = unknown. Read by compare/headless.ts for a run's total. */
  turnTokens?: TokenUsage;
  /** the engine compacted the context (compact_boundary) */
  compacted?: { pre: number | null; post: number | null };
}

export interface ContextUsage { totalTokens: number; maxTokens: number; percentage: number }
/** A turn's token counts by kind (input = not from the cache). */
export interface TokenUsage { input: number; cacheRead: number; cacheWrite: number; output: number }

/** A usage object's counts (non-negative finite numbers, else 0), or undefined when it reports none at all. */
export function tokenUsage(input: unknown, cacheRead: unknown, cacheWrite: unknown, output: unknown): TokenUsage | undefined {
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  const u = { input: n(input), cacheRead: n(cacheRead), cacheWrite: n(cacheWrite), output: n(output) };
  return u.input + u.cacheRead + u.cacheWrite + u.output > 0 ? u : undefined;
}

/** Options common to every harness. */
export interface SessionOptions {
  chatId: string;
  cwd: string;
  model?: string | null;
  effort?: Effort | null;
  permissionMode?: PermissionMode | null;
  title?: string | null;
  /** new session: use this id; resume: the id to resume */
  sessionId?: string | null;
  resume?: boolean;
  fork?: boolean;
  worktree?: boolean;
  /** --mcp-config value: a file path or an inline JSON string */
  mcpConfig?: string | null;
  /** running total cost already restored for this session (for per-turn deltas after a resume) */
  costBaseUsd?: number;
  /** Claude: the auto-compact window of this process (inline --settings env, beats a folder's own settings; ADR 0031);
   *  0 or absent = the user's settings decide */
  compactWindowTokens?: number;
  env?: NodeJS.ProcessEnv;
  extraArgs?: string[];
  /** a hidden run that must change nothing (the comparison's side b, compare/headless.ts): each adapter adds its own
   *  read-only means (Claude: plan mode, read tools only, no MCP, no hooks, no transcript; ACP: its read-only mode,
   *  the engine's allow rules left out). Its owner still answers every permission itself. */
  readOnly?: boolean;
  /** with readOnly: absolute folders the run may never read (the comparison's other side and verdicts); each adapter
   *  turns them into deny rules (Claude: Read(//…/**) in its session settings; ACP/Cursor: Read(…/**) in its config
   *  copy). Its owner refuses a read there too when the engine asks. */
  denyRead?: string[];
}

export interface HarnessSession {
  readonly harness: Harness;
  readonly state: ChatState;
  readonly sessionId: string | null;
  readonly pid: number | null;
  /** its Job Object (jobguard.ts), null when it has none (not Windows, helper not ready, tests) */
  readonly jobHandle?: number | null;
  /** exited or its job terminated: the quit's last resort leaves it alone (no taskkill on a pid that may be reused) */
  readonly gone?: boolean;
  /** The process once it exited (pid, start, exit time): the manager reaps a kept one's tools at the real close. */
  readonly root: Root | null;
  /** when we spawned the process (ms; 0 before): the quit's detached reaper (proctree.ts reapAfterQuit) needs it */
  readonly startedAt?: number;
  /** working: a turn in flight (queued ones too), a question open, or booting */
  readonly busy: boolean;
  /** resolves when the engine's session is open or failed (engines that replay a resumed past: Cursor) */
  readonly ready?: Promise<void>;
  start(): void;
  /** text may be empty when images are attached (already checked by the manager: images.ts checkImages) */
  send(text: string, images?: readonly ImageAttachment[]): void;
  /** false when the request is unknown (already answered or withdrawn). Throws on an answer of the wrong kind. */
  answer(requestId: string, answer: Answer): boolean;
  /** keepQueued: only the running turn stops; messages the session already queued still go after it; byUser: the
   *  user's Stop / "Invia subito" (the turn ends as "Interrotto da te", not an error), never the app's own interrupt */
  interrupt(opts?: { keepQueued?: boolean; byUser?: boolean }): Promise<void>;
  /** the running turn is not retried by itself after a network error (Cursor only: a failed hand-off turn) */
  noRetry?(): void;
  setModel(model: string | null): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  setEffort(effort: Effort | null): Promise<void>;
  rename(title: string): Promise<void>;
  contextUsage(): Promise<ContextUsage | null>;
  /** The CLI's own usage report (Claude: get_usage, plan windows included), raw; null when not supported. */
  usage(): Promise<unknown>;
  /** Graceful end: stdin closed, killed after graceMs. Resolves when the process is gone. The tools it left running
   *  are reaped after the exit (proctree.ts), unless `keepChildren`: the chat goes on in a new process (model or Regia
   *  change, continued elsewhere) and a dev server it started stays for the next turn. */
  close(graceMs?: number, keepChildren?: boolean): Promise<void>;
  /** Kill the process tree now, without blocking (the exit is reported through the sink). */
  killNow(): void;
  /** the process is running (not yet exited) */
  readonly alive: boolean;
}

// ---- small shared helpers ----

/** CLI session ids are UUIDs; only those are ever passed to --resume / --session-id or used in a path. */
export const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

let seq = 0;
/** Unique item id inside this app run (prefix = item kind). */
export function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`;
}

/** Shortens long strings inside a tool input before it crosses IPC (the full input stays in the session). */
export function trimInput(input: unknown, max = 4000): unknown {
  if (typeof input === 'string') return input.length > max ? `${input.slice(0, max)}… (+${input.length - max})` : input;
  if (Array.isArray(input)) return input.slice(0, 200).map(v => trimInput(v, max));
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) out[k] = trimInput(v, max);
    return out;
  }
  return input;
}

export function cut(s: string, n: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

/** Last non-empty line of a text, for collapsed tiles and the needs-you lane. */
export function lastLine(text: string, n = 200): string {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return cut(lines.at(-1) ?? '', n);
}

/** Removes ANSI escapes the CLI may put in reasons and errors. */
export function stripAnsi(s: string): string {
  return s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\u001b\][^\u0007]*\u0007/g, '');
}
