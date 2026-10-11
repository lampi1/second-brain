// The harness-neutral contract between ChatManager and one running CLI process (one chat = at most one session).
// Why: the manager must not know whether a chat runs on Claude Code (claude.ts, stream-json control protocol) or on
// Cursor (cursor.ts later, `agent acp` JSON-RPC); each harness implements HarnessSession and reports through a
// SessionSink. Used by manager.ts (creates sessions, owns items/pending/persistence) and by every harness module.
import type { Answer, ChatItem, ChatState, Effort, Harness, PendingRequest, PermissionMode } from '../../shared/contract';

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
}

export interface SessionPatch {
  state?: ChatState;
  sessionId?: string;          // the CLI's own session id (learned at init, or new after a fork)
  model?: string;              // the model actually in use (from init)
  permissionMode?: PermissionMode;
  effort?: Effort | null;
  contextTokens?: number;
  contextMaxTokens?: number;
  /** cost of the turn that just ended (USD, API-equivalent) and the CLI's running total for the session */
  turnCostUsd?: number;
  totalCostUsd?: number;
  /** false: the engine reports no usage, so turnCostUsd is 0 for lack of data (Cursor over ACP today) */
  costKnown?: boolean;
  lastText?: string;
  version?: string;            // CLI version
}

export interface ContextUsage { totalTokens: number; maxTokens: number; percentage: number }

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
  env?: NodeJS.ProcessEnv;
  extraArgs?: string[];
}

export interface HarnessSession {
  readonly harness: Harness;
  readonly state: ChatState;
  readonly sessionId: string | null;
  readonly pid: number | null;
  /** working: a turn in flight (queued ones too), a question open, or booting */
  readonly busy: boolean;
  /** resolves when the engine's session is open or failed (engines that replay a resumed past: Cursor) */
  readonly ready?: Promise<void>;
  start(): void;
  send(text: string): void;
  /** false when the request is unknown (already answered or withdrawn). Throws on an answer of the wrong kind. */
  answer(requestId: string, answer: Answer): boolean;
  interrupt(): Promise<void>;
  setModel(model: string | null): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  setEffort(effort: Effort | null): Promise<void>;
  rename(title: string): Promise<void>;
  contextUsage(): Promise<ContextUsage | null>;
  /** The CLI's own usage report (Claude: get_usage, plan windows included), raw; null when not supported. */
  usage(): Promise<unknown>;
  /** Graceful end: stdin closed, killed after graceMs. Resolves when the process is gone. */
  close(graceMs?: number): Promise<void>;
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
