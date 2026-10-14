// The one place that turns an engine into a running session (ADR 0046): its kind picks the adapter (claude.ts for
// Claude Code's stream-json, acp.ts for any ACP CLI, api.ts for an HTTP model), its registry entry says how it starts.
// The user's API key (engines/secrets.ts) goes only here, into its own engine: an ACP CLI's environment variable
// (keyEnv) or an API session's request header. The chat manager calls sessionFor and never names an engine; tests pass
// their own factory to the manager instead.
import path from 'node:path';
import type { CursorReasoning, ModelsSeen } from '../../shared/contract';
import { AcpSession, type AcpOptions } from '../chats/acp';
import { ApiSession } from '../chats/api';
import { ClaudeSession } from '../chats/claude';
import { listPrice, registryModels } from '../chats/live-cost';
import type { HarnessSession, SessionOptions, SessionSink } from '../chats/session';
import { engines, type EngineDef } from './registry';

/** What the app gives a session beyond the chat's own options. */
export interface EngineContext {
  userData: string;
  /** the engine's command override (tests: a .mjs fake); absent = the installed CLI */
  path?: string;
  /** the chat's browser MCP endpoint and, for a Regia, the app-control one (ACP passes them in session/new) */
  mcpUrl: string | null;
  appMcpUrl: string | null;
  /** show the past an ACP engine replays when a session is loaded (a chat restored after a restart has no items) */
  showReplay: boolean;
  appVersion?: string;
  /** ACP model options (reasoning, fast) the user chose in Settings */
  acpModelConfig: { reasoning: CursorReasoning | ''; fast: boolean } | null;
  /** the user's API key for this engine, read when needed; null = none (the engine uses its own login) */
  key: () => string | null;
}

export function sessionFor(engine: EngineDef, opts: SessionOptions, sink: SessionSink, ctx: EngineContext): HarnessSession {
  switch (engine.kind) {
    case 'claude':
      return new ClaudeSession({ ...opts, ...(ctx.path ? { claudePath: ctx.path } : {}) }, sink);
    case 'acp': {
      const command = engine.command ?? engine.id;
      const key = engine.keyEnv ? ctx.key() : null;
      return new AcpSession({
        ...opts, mcpConfig: null, mcpUrl: ctx.mcpUrl, appMcpUrl: ctx.appMcpUrl, showReplay: ctx.showReplay,
        engineId: engine.id, label: engine.label, args: engine.args ?? [], acpCommand: command,
        ...(engine.modelFlag ? { modelFlag: engine.modelFlag } : {}),
        loginCommand: engine.login.length ? [command, ...engine.login].join(' ') : null,
        ...(key && engine.keyEnv ? { env: { ...opts.env, [engine.keyEnv]: key } } : {}),
        ...(engine.cursorExtras ? cursorOptions(engine, ctx) : {}),
        ...(ctx.path ? { pathOverride: ctx.path } : {}), ...(ctx.appVersion ? { appVersion: ctx.appVersion } : {}),
      }, sink);
    }
    case 'api':
      return new ApiSession({
        ...opts, engineId: engine.id, protocol: engine.protocol ?? 'openai', baseUrl: engine.baseUrl ?? '', apiKey: ctx.key,
        historyFile: path.join(ctx.userData, 'api-chats', `${opts.chatId}.json`), showReplay: ctx.showReplay,
        pricesOf: model => listPrice(engine.id, model),
      }, sink);
  }
}

/** The models each engine offers (models:seen): what its CLI listed, and for an HTTP engine, which lists none, its
 *  rows in the brain's table (the user picks one: an API chat has no default model). */
export function withApiModels(seen: ModelsSeen): ModelsSeen {
  const out: ModelsSeen = { ...seen };
  for (const e of engines()) {
    if (e.kind !== 'api' || out[e.id]?.ids.length) continue;
    const ids = registryModels(e.id);
    if (ids.length) out[e.id] = { ids, at: 0 };
  }
  return out;
}

/** What only the Cursor CLI has: its config folder snapshot, the subagent hooks, its price fallback, the model options
 *  from Settings. */
function cursorOptions(engine: EngineDef, ctx: EngineContext): Partial<AcpOptions> {
  return {
    subagentHooks: true, priceFallback: true,
    configDir: path.join(ctx.userData, `${engine.id}-config`), modelConfig: ctx.acpModelConfig,
  };
}
