// Engines: the engine registry's shapes, API spend and stored API keys (ADR 0046).
// One area of the IPC contract: src/shared/contract.ts re-exports it and assembles the channel maps (change a shape
// here first, then both sides).
import type { CliStatus } from './app';
import type { ModelsSeen } from './brain';

/** An engine id from the engine registry (src/main/engines/registry.ts, ADR 0046): 'claude', 'cursor', … */
export type Harness = string;
/** The protocol an engine speaks; each kind has one adapter (claude: Claude Code stream-json · acp: Agent Client
 *  Protocol over stdio · codex: `codex app-server` JSON-RPC over stdio, ADR 0060 · api: an HTTP model endpoint, OpenAI-
 *  or Anthropic-compatible, text only). */
export type EngineKind = 'claude' | 'acp' | 'codex' | 'api';
/** What an engine can do. The app asks these, never the engine's name. */
export interface EngineCaps {
  /** an effort level per chat (Claude's --effort) */
  effort: boolean;
  /** the model changes inside a running session (false: the session reopens with the new model) */
  liveModel: boolean;
  /** a chat can be copied with its history (fork) */
  fork: boolean;
  /** an engine started ahead for the next new chat (warm.ts) */
  warm: boolean;
  /** a chat may run in its own git worktree */
  worktree: boolean;
  /** the user picks the permission mode (plan, auto, …) */
  permissionMode: boolean;
  /** true: the app picks the session id and reads the past from the engine's transcript files; false: the engine gives
   *  the id and replays the past itself when a session is loaded */
  transcript: boolean;
  /** the engine reports each turn's cost */
  cost: boolean;
  /** the engine answers the plan's usage windows (get_usage) */
  usage: boolean;
  /** the engine takes a list of pre-allowed tools at start (--allowedTools) */
  preAllow: boolean;
  /** the engine works with tools (files, shell, MCP: the browser, the app's tools); false = text only (api) */
  tools: boolean;
}
/** An engine as the renderer sees it: label = short ("Claude"), name = full ("Claude Code"). */
export interface EngineInfo {
  id: Harness; label: string; name: string; kind: EngineKind; caps: EngineCaps;
  /** app = built in or one of the app's presets; brain = an entry of the brain's harness/models.json */
  source: 'app' | 'brain';
  /** whether it takes the user's API key: required (api), optional (a CLI that also has its own login), none */
  key: 'required' | 'optional' | 'none';
  /** how it starts, as Settings shows it ("agent acp", an endpoint URL) */
  runs: string;
  /** false: its start definition is not the one the user turned on (changed in the brain, or never on): it does not start */
  trusted: boolean;
}
/** The app's own engine for the Anthropic Messages API (engines/registry.ts, ADR 0052): the judge and the other text-only
 *  calls (engines/text.ts) and the writing rows «Sui crediti API» run on it, with the key saved in Settings. */
export const ANTHROPIC_API = 'anthropic';
/** One engine's API spend in a month, as the app computed it at list prices (engines/spend.ts): calls = requests and chat
 *  turns; unpriced = those whose model has no price in the brain's table (counted, not in usd). */
export interface ApiSpendLine { usd: number; calls: number; unpriced: number }
/** engines:spend → this month's spend per API engine (month "2026-10", local time); measured = always 'app' (the API
 *  shows spend only to an Admin key, ADR 0052). */
export interface ApiSpendInfo { month: string; measured: 'app'; engines: Record<Harness, ApiSpendLine> }
/** The stored API keys as the renderer sees them (engines/secrets.ts): never a key, only its mask. */
export interface SecretsStatus {
  /** false: this machine offers no safe encryption (why says so); no key can be stored */
  available: boolean;
  why?: string;
  /** stale: the engine's start changed since the key was saved, so it is not used */
  keys: Record<Harness, { mask: string; stale: boolean }>;
}

/** renderer → main, engines: each entry [argument, result]. Part of InvokeMap (src/shared/contract.ts). */
export interface EnginesInvokeMap {
  'cli:status': [{ harness: Harness; checkLogin?: boolean }, CliStatus];
  'cli:login': [{ harness: Harness }, void];
  /** the stored API keys' masks; set and delete answer the same (a key never comes back, engines/secrets.ts) */
  'secrets:status': [void, SecretsStatus];
  'secrets:set': [{ engine: Harness; key: string }, SecretsStatus];
  'secrets:delete': [{ engine: Harness }, SecretsStatus];
  /** the user's "Riaccendi" on an engine whose definition changed: trust its definition of now and turn it on */
  'engines:trust': [{ engine: Harness }, void];
  /** this month's API spend per engine, computed by the app (engines/spend.ts) */
  'engines:spend': [void, ApiSpendInfo];
  'models:seen': [void, ModelsSeen];
}
