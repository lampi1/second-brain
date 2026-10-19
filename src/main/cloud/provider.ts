// One interface for the three vendors' cloud agents (ADR 0080): cursor.ts (REST v1), codex.ts (`codex cloud`),
// claude.ts (`claude --cloud`). The service (service.ts) asks a provider only what its caps (shared/cloud.ts CLOUD_CAPS)
// say it offers; everything else is "Apri" in the renderer. Every failure is an Error whose message the user reads
// (Italian), logged by the service with cause + hint. Used by service.ts and the providers.
import type { CloudAgent, CloudEngine, CloudMessage, CloudReady } from '../../shared/cloud';
import type { RepoInfo } from './repo';

export interface StartInput { prompt: string; title: string; repo: RepoInfo; model?: string; env?: string }

export interface CloudProvider {
  engine: CloudEngine;
  /** can it start now (key present, signed in with the right account); cached by the service */
  readiness(): Promise<CloudReady>;
  start(input: StartInput): Promise<CloudAgent>;
  /** the vendor's list (caps.list) */
  list?(): Promise<CloudAgent[]>;
  followUp?(agent: CloudAgent, text: string): Promise<Partial<CloudAgent>>;
  stop?(agent: CloudAgent): Promise<Partial<CloudAgent>>;
  /** Cursor: the run's messages as they stream; resolves when the stream ends or the signal aborts */
  stream?(agent: CloudAgent, onMessage: (m: CloudMessage) => void, signal: AbortSignal): Promise<void>;
  /** Cursor: the agent's spend so far (usd), null = unknown */
  usage?(agent: CloudAgent): Promise<number | null>;
  /** Codex: apply the task's diff in this (fresh) worktree */
  applyIn?(agent: CloudAgent, worktree: string): Promise<void>;
}

/** The vendors' own pages: a url from a vendor answer is kept only on its host (it opens in an internal tab). */
const HOSTS: Record<CloudEngine, RegExp> = {
  cursor: /^(?:www\.)?cursor\.com$/,
  codex: /^(?:chatgpt\.com|(?:www\.)?openai\.com)$/,
  claude: /^claude\.ai$/,
};
export function vendorUrl(engine: CloudEngine, v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 500) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !u.username && !u.password && HOSTS[engine].test(u.hostname) ? u.toString() : null;
  } catch { return null; }
}

/** A vendor time (ISO string, seconds or ms) → ms; now when missing. */
export function timeOf(v: unknown, now = Date.now()): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string') { const t = Date.parse(v); if (!Number.isNaN(t)) return t; }
  return now;
}

export const str = (v: unknown, max = 500): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
export const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
