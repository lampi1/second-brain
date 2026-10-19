// Cloud agents (ADR 0080, issue #79): agents that run in a vendor's cloud (Cursor Cloud Agents, Codex cloud tasks,
// Claude Code cloud sessions) instead of on this PC. The shapes main (src/main/cloud/) and the renderer (the Grindhouse's
// cloud strips, the "Dove: Locale / Cloud" choice of "Nuovo agente") share; contract.ts re-exports them and adds the
// cloud:* channels. Pure data, no imports: used by contract.ts, src/main/cloud/*, the renderer's store/cloud.ts.

/** The engines that offer cloud agents (their ids in the engine registry). */
export const CLOUD_ENGINES = ['cursor', 'codex', 'claude'] as const;
export type CloudEngine = (typeof CLOUD_ENGINES)[number];
export const isCloudEngine = (v: unknown): v is CloudEngine => typeof v === 'string' && (CLOUD_ENGINES as readonly string[]).includes(v);

/** What an engine's cloud agents can do from the app (each a documented vendor surface, never a scraped page);
 *  whatever is false falls back to "Apri" (the vendor's page in an internal browser tab). */
export interface CloudCaps {
  start: boolean;
  /** the vendor lists the agents (polled); false = the app knows only the ones it started */
  list: boolean;
  /** the vendor streams the agent's messages (shown in the expanded strip) */
  stream: boolean;
  followUp: boolean;
  stop: boolean;
  /** "Porta in locale": the result into a new worktree (git fetch of its branch, codex apply) */
  apply: boolean;
}

/** queued: accepted, not started · running · waiting: the vendor waits for the user (open its page) · done · failed ·
 *  stopped: cancelled · unknown: the vendor has no status the app may read (Claude: open it on claude.ai). */
export type CloudStatus = 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'stopped' | 'unknown';
export const CLOUD_ACTIVE: readonly CloudStatus[] = ['queued', 'running', 'waiting'];

/** One message of a cloud agent, as its vendor streams it (Cursor only, v1). */
export interface CloudMessage { id: string; kind: 'user' | 'assistant' | 'tool' | 'status'; text: string; at: number }

export interface CloudAgent {
  /** the vendor's id (Cursor agent id, Codex task id, Claude session id) */
  id: string;
  engine: CloudEngine;
  title: string;
  status: CloudStatus;
  /** the vendor's page of the agent (https, the vendor's own host) */
  url: string | null;
  /** "owner/name" of the GitHub repo; the strip's area is its name */
  repo: string;
  /** the branch the agent pushes (its own: cursor/…, codex/…, claude/…), when known */
  branch?: string;
  /** the local folder it was started from (the app's own starts) */
  cwd?: string;
  updatedAt: number;
  summary?: string;
  /** real API spend so far (Cursor, at the vendor's figure); absent = drawn from the plan (Codex, Claude) */
  costUsd?: number;
  /** the vendor's current run (Cursor v1: follow-up and stop act on it) */
  runId?: string;
  /** who started it: the user's click, an agent through app_create_chat, or the vendor's list (started elsewhere) */
  by: 'user' | 'agent' | 'vendor';
  /** the last messages streamed (Cursor, while its strip is open) */
  messages?: CloudMessage[];
  /** the last error the app met acting on it (Italian, for the strip) */
  error?: string;
}

/** Whether an engine can start cloud agents now; why says what is missing (Italian, for the dialog). */
export interface CloudReady { ok: boolean; why?: string }

/** cloud:list → every cloud agent the app knows, newest first, and each engine's capabilities. */
export interface CloudState {
  agents: CloudAgent[];
  caps: Record<CloudEngine, CloudCaps>;
  /** this local day's Cursor cloud spend (counted in the budget's Cursor daily limit) */
  todayUsd: number;
  /** true while the app polls (window visible, something running) */
  polling: boolean;
}

export interface CloudStartRequest {
  engine: CloudEngine;
  /** the local checkout whose GitHub remote and pushed branch the agent works on */
  cwd: string;
  prompt: string;
  title?: string;
  model?: string;
  /** Codex: the cloud environment id (`codex cloud exec --env`); remembered per repo */
  env?: string;
}

/** "Porta in locale": the new worktree the result landed in. */
export interface CloudApplyResult { worktree: string; branch: string }

const ALL: CloudCaps = { start: true, list: true, stream: true, followUp: true, stop: true, apply: true };
/** What each vendor documents (checked 2026-10-19, issue #79): Cursor has a full REST API; Codex's CLI starts, lists and
 *  applies (follow-up and stop only on its web page); Claude Code's CLI starts and queues follow-ups (no list, no
 *  output, no stop outside claude.ai). */
export const CLOUD_CAPS: Record<CloudEngine, CloudCaps> = {
  cursor: ALL,
  codex: { ...ALL, stream: false, followUp: false, stop: false },
  claude: { start: true, list: false, stream: false, followUp: true, stop: false, apply: true },
};
