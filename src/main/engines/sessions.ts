// The one place that turns an engine into a running session (ADR 0046): its kind picks the adapter (claude.ts for
// Claude Code's stream-json, acp.ts for any ACP CLI, codex.ts for `codex app-server`, api.ts for an HTTP model), its
// registry entry says how it starts, brain/adapters/ what the brain's rules add to this launch (ADR 0060).
// The user's API key (engines/secrets.ts) goes only here, into its own engine: a CLI's environment variable
// (keyEnv: ACP, Codex's CODEX_API_KEY) or an API session's request header. The chat manager calls sessionFor and never names an engine; tests pass
// their own factory to the manager instead.
import path from 'node:path';
import type { CursorReasoning, ModelsSeen } from '../../shared/contract';
import { AcpSession, type AcpOptions } from '../chats/acp';
import { ApiSession } from '../chats/api';
import { claudeLaunch } from '../brain/adapters/claude-plugin';
import { codexLaunch } from '../brain/adapters/codex';
import { codexPolicyFor } from '../brain/adapters/codex-policy';
import { ClaudeSession } from '../chats/claude';
import { CodexSession } from '../chats/codex';
import { listPrice, registryModels } from '../chats/live-cost';
import type { HarnessSession, SessionOptions, SessionSink } from '../chats/session';
import { engineOf, engines, fingerprint, priceEnginesOf, type EngineDef } from './registry';

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
  // A running session retains its endpoint/command. A key for a replacement definition must never reach it.
  const binding = fingerprint(engine);
  const boundKey = (): string | null => {
    const current = engineOf(engine.id);
    return current && fingerprint(current) === binding ? ctx.key() : null;
  };
  switch (engine.kind) {
    case 'claude': {
      // the brain as a plugin (off by default); a read-only run (comparison side b) takes nothing that could act
      const brain = opts.readOnly ? [] : claudeLaunch(ctx.userData).args;
      return new ClaudeSession({ ...opts, ...(brain.length ? { extraArgs: [...brain, ...(opts.extraArgs ?? [])] } : {}), ...(ctx.path ? { claudePath: ctx.path } : {}) }, sink);
    }
    case 'codex': {
      const command = engine.command ?? engine.id;
      const key = engine.keyEnv ? boundKey() : null;
      const agentPolicy = opts.toolPolicy || opts.ceiling ? { tools: opts.toolPolicy ?? null, ceiling: opts.ceiling ?? null } : null;
      const launch = codexLaunch({ cwd: opts.cwd, mcpUrl: ctx.mcpUrl, appMcpUrl: ctx.appMcpUrl, readOnly: opts.readOnly, chatId: opts.chatId, agentPolicy });
      return new CodexSession({
        ...opts, mcpConfig: null, engineId: engine.id, label: engine.label, command, args: engine.args ?? ['app-server'],
        configArgs: launch.configArgs, developerInstructions: launch.developerInstructions, skillRoots: launch.skillRoots,
        approvalPolicy: launch.approvalPolicy, sandbox: launch.sandbox,
        executionPolicy: () => codexPolicyFor(opts.cwd, opts.readOnly, agentPolicy),
        showReplay: ctx.showReplay, loginCommand: engine.login.length ? [command, ...engine.login].join(' ') : null,
        ...(key && engine.keyEnv ? { env: { ...opts.env, [engine.keyEnv]: key } } : {}),
        ...(ctx.path ? { pathOverride: ctx.path } : {}), ...(ctx.appVersion ? { appVersion: ctx.appVersion } : {}),
      }, sink);
    }
    case 'acp': {
      const command = engine.command ?? engine.id;
      const key = engine.keyEnv ? boundKey() : null;
      return new AcpSession({
        ...opts, mcpConfig: null, mcpUrl: ctx.mcpUrl, appMcpUrl: ctx.appMcpUrl, showReplay: ctx.showReplay,
        engineId: engine.id, label: engine.label, args: engine.args ?? [], acpCommand: command,
        ...(engine.modelFlag ? { modelFlag: engine.modelFlag } : {}),
        loginCommand: engine.login.length ? [command, ...engine.login].join(' ') : null,
        ...(key && engine.keyEnv ? { env: { ...opts.env, [engine.keyEnv]: key } } : {}),
        ...(engine.cursorExtras ? cursorOptions(engine, ctx, opts.readOnly ? opts.chatId : null) : {}),
        ...(ctx.path ? { pathOverride: ctx.path } : {}), ...(ctx.appVersion ? { appVersion: ctx.appVersion } : {}),
      }, sink);
    }
    case 'api':
      return new ApiSession({
        ...opts, engineId: engine.id, protocol: engine.protocol ?? 'openai', baseUrl: engine.baseUrl ?? '', apiKey: boundKey,
        historyFile: path.join(ctx.userData, 'api-chats', `${opts.chatId}.json`), showReplay: ctx.showReplay,
        pricesOf: model => listPrice(priceEnginesOf(engine), model),
      }, sink);
  }
}

/** The models each engine offers (models:seen): what its CLI listed, and for an HTTP engine, which lists none, its
 *  rows in the brain's table (the user picks one: an API chat has no default model). */
export function withApiModels(seen: ModelsSeen): ModelsSeen {
  const out: ModelsSeen = { ...seen };
  for (const e of engines()) {
    if (e.kind !== 'api' || out[e.id]?.ids.length) continue;
    const ids = registryModels(priceEnginesOf(e));
    if (ids.length) out[e.id] = { ids, at: 0 };
  }
  return out;
}

/** What only the Cursor CLI has: its config folder snapshot, the subagent hooks, its price fallback, the model options
 *  from Settings. A read-only run (the comparison's side b; readOnlyRun = its chat id) gets a folder of its own per run
 *  (its copy has no allow rules and the run's own deny rules: a chat or another run starting meanwhile must not change
 *  them) and no subagent hooks (they would capture its subagents as new comparison rounds). */
function cursorOptions(engine: EngineDef, ctx: EngineContext, readOnlyRun: string | null): Partial<AcpOptions> {
  return {
    subagentHooks: !readOnlyRun, priceFallback: true,
    configDir: readOnlyRun ? readOnlyConfigDir(ctx.userData, engine.id, readOnlyRun) : path.join(ctx.userData, `${engine.id}-config`), modelConfig: ctx.acpModelConfig,
  };
}

/** The Cursor config folder of one read-only run (removed by its owner when the run ends: compare/headless.ts). */
export const readOnlyConfigDir = (userData: string, engineId: string, chatId: string): string => path.join(userData, `${engineId}-config-readonly`, chatId);
