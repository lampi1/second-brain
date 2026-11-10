// The one place that turns an engine into a running session (ADR 0046): its kind picks the adapter (claude.ts for
// Claude Code's stream-json, acp.ts for any ACP CLI, codex.ts for `codex app-server`, api.ts for an HTTP model), its
// registry entry says how it starts, brain/adapters/ what the brain's rules add to this launch (ADR 0060).
// The user's API key (engines/secrets.ts) goes only here, into its own engine: a CLI's environment variable
// (keyEnv: ACP, Codex's CODEX_API_KEY) or an API session's request header. The chat manager calls sessionFor and never names an engine; tests pass
// their own factory to the manager instead. Every session gets the turn-start watchdog (chats/turn-watchdog.ts).
import path from 'node:path';
import fs from 'node:fs';
import { runtimePerformance } from '../runtime-performance';
import { runtimeAdapter, type PreparedAdapter } from '../agent-runtime/adapter-contract';
import type { CursorReasoning, ModelsSeen } from '../../shared/contract';
import { AcpSession, type AcpOptions } from '../chats/acp';
import { ApiSession } from '../chats/api';
import { claudeLaunch } from '../brain/adapters/claude-plugin';
import { codexLaunch } from '../brain/adapters/codex';
import { acpRules } from '../brain/adapters/acp-rules';
import { codexPolicyFor } from '../brain/adapters/codex-policy';
import { openCodeEnv } from '../brain/adapters/opencode-permission';
import { ClaudeSession } from '../chats/claude';
import { CodexSession } from '../chats/codex';
import { listPrice, registryModels } from '../chats/live-cost';
import type { HarnessSession, SessionOptions, SessionSink } from '../chats/session';
import { TURN_NO_START_MS, watchTurns } from '../chats/turn-watchdog';
import { anthropicApi, appAsks, engineOf, engines, fingerprint, priceEnginesOf, type EngineDef } from './registry';

/** What the app gives a session beyond the chat's own options. */
export interface EngineContext {
  userData: string;
  /** the engine's command override (tests: a .mjs fake); absent = the installed CLI */
  path?: string;
  /** the chat's browser MCP endpoint and, for an Orchestrator, the app-control one (ACP passes them in session/new) */
  mcpUrl: string | null;
  appMcpUrl: string | null;
  /** the app-managed MCP servers this chat may use: their gateway endpoints (ADR 0086); absent = none */
  extMcp?: { name: string; url: string }[];
  /** show the past an ACP engine replays when a session is loaded (a chat restored after a restart has no items) */
  showReplay: boolean;
  appVersion?: string;
  /** ACP model options (reasoning, fast) the user chose in Settings */
  acpModelConfig: { reasoning: CursorReasoning | ''; fast: boolean } | null;
  /** the user's API key for this engine, read when needed; null = none (the engine uses its own login) */
  key: () => string | null;
  /** the brain folder: its Claude deny rules hold on engines given their permission rules (ADR 0232) */
  brainRoot?: string | null;
}

/** The session of a chat on this engine, with the turn-start watchdog around it (chats/turn-watchdog.ts, ADR 0221):
 *  a sent turn with no first event in SB_TURN_WATCHDOG_MS (default 120 s) is shown and logged, never restarted. */
export function sessionFor(engine: EngineDef, opts: SessionOptions, sink: SessionSink, ctx: EngineContext): HarnessSession {
  runtimePerformance.sessionCreated(opts.chatId);
  const noStartMs = Number(process.env.SB_TURN_WATCHDOG_MS) > 0 ? Number(process.env.SB_TURN_WATCHDOG_MS) : TURN_NO_START_MS;
  return watchTurns(watched => startSession(engine, opts, watched, ctx), sink, { chatId: opts.chatId, engine: engine.id, label: engine.label, noStartMs });
}

function startSession(engine: EngineDef, opts: SessionOptions, sink: SessionSink, ctx: EngineContext): HarnessSession {
  if (opts.agentAssets) {
    const { pluginDir, skillRoot } = opts.agentAssets, base = path.join(ctx.userData, 'agent-pack-runtime');
    if (!/^[a-f0-9]{64}$/.test(path.basename(pluginDir)) || path.resolve(path.dirname(pluginDir)) !== path.resolve(base)
      || path.resolve(skillRoot) !== path.resolve(pluginDir, 'skills') || fs.lstatSync(pluginDir).isSymbolicLink() || fs.lstatSync(skillRoot).isSymbolicLink()) throw new Error('Invalid agent skill snapshot');
  }
  // A running session retains its endpoint/command. A key for a replacement definition must never reach it.
  const binding = fingerprint(engine);
  const boundKey = (): string | null => {
    const current = engineOf(engine.id);
    return current && fingerprint(current) === binding ? ctx.key() : null;
  };
  switch (engine.kind) {
    case 'claude': {
      // the brain as a plugin (off by default); a read-only run (comparison side b) takes nothing that could act; a role
      // chat takes the brain without its skills and its launch's own plugin (only the skills it was given)
      const launch = opts.readOnly ? null : claudeLaunch(ctx.userData, opts.env?.SB_ROUTINE_PACKAGE || opts.env?.SB_ROUTINE_BROWSER ? { domains: [], on: false } : undefined, { skills: !opts.agentAssets });
      const brain = launch ? [...launch.args, ...(opts.agentAssets ? ['--plugin-dir', opts.agentAssets.pluginDir] : [])] : [];
      return prepared({ kind: 'claude', options: { ...opts, ...(brain.length ? { extraArgs: [...brain, ...(opts.extraArgs ?? [])] } : {}), ...(launch?.productHooks ? { productHooks: launch.productHooks } : {}), ...(ctx.path ? { claudePath: ctx.path } : {}) } }, sink);
    }
    case 'codex': {
      const command = engine.command ?? engine.id;
      const key = engine.keyEnv ? boundKey() : null;
      const agentPolicy = opts.toolPolicy || opts.ceiling ? { tools: opts.toolPolicy ?? null, ceiling: opts.ceiling ?? null } : null;
      const launch = codexLaunch({ ...(opts.env?.SB_ROUTINE_PACKAGE ? { domains: [], brain: false } : {}), cwd: opts.cwd, mcpUrl: ctx.mcpUrl, appMcpUrl: ctx.appMcpUrl, extMcp: ctx.extMcp ?? [], readOnly: opts.readOnly, chatId: opts.chatId, agentPolicy });
      return prepared({ kind: 'codex', options: {
        ...opts, mcpConfig: null, engineId: engine.id, label: engine.label, command, args: engine.args ?? ['app-server'],
        configArgs: launch.configArgs, developerInstructions: launch.developerInstructions, skillRoots: opts.readOnly ? [] : opts.agentAssets ? [opts.agentAssets.skillRoot] : launch.skillRoots,
        approvalPolicy: launch.approvalPolicy, sandbox: launch.sandbox,
        executionPolicy: () => codexPolicyFor(opts.cwd, opts.readOnly, agentPolicy),
        showReplay: ctx.showReplay, loginCommand: engine.login.length ? [command, ...engine.login].join(' ') : null,
        ...(key && engine.keyEnv ? { env: { ...opts.env, [engine.keyEnv]: key } } : {}),
        ...(ctx.path ? { pathOverride: ctx.path } : {}), ...(ctx.appVersion ? { appVersion: ctx.appVersion } : {}),
      } }, sink);
    }
    case 'acp': {
      const command = engine.command ?? engine.id;
      const key = engine.keyEnv ? boundKey() : null;
      const perms = engine.permissionConfig === 'opencode'
        ? openCodeEnv({ tools: opts.toolPolicy ?? null, ceiling: opts.ceiling ?? null, readOnly: opts.readOnly }, opts.cwd, ctx.brainRoot ?? null, { ...process.env, ...opts.env })
        : null;
      const env = key && engine.keyEnv || perms ? { ...opts.env, ...perms, ...(key && engine.keyEnv ? { [engine.keyEnv]: key } : {}) } : null;
      return prepared({ kind: 'acp', options: {
        brainInstructions: opts.env?.SB_ROUTINE_PACKAGE ? null : acpRules(opts.readOnly),
        ...opts, mcpConfig: null, mcpUrl: ctx.mcpUrl, appMcpUrl: ctx.appMcpUrl, extMcp: opts.readOnly ? [] : ctx.extMcp ?? [], showReplay: ctx.showReplay,
        engineId: engine.id, label: engine.label, args: engine.args ?? [], acpCommand: command,
        ...(engine.modelFlag ? { modelFlag: engine.modelFlag } : {}),
        ...(engine.modelOption ? { modelOption: true } : {}),
        ...(appAsks(engine) ? { appAsk: true } : {}),
        loginCommand: engine.login.length ? [command, ...engine.login].join(' ') : null,
        ...(env ? { env } : {}),
        ...(engine.cursorExtras ? cursorOptions(engine, ctx, opts.readOnly ? opts.chatId : null) : {}),
        ...(ctx.path ? { pathOverride: ctx.path } : {}), ...(ctx.appVersion ? { appVersion: ctx.appVersion } : {}),
      } }, sink);
    }
    case 'api':
      return prepared({ kind: 'api', options: {
        ...opts, engineId: engine.id, protocol: engine.protocol ?? 'openai', baseUrl: engine.baseUrl ?? '', apiKey: boundKey,
        historyFile: path.join(ctx.userData, 'api-chats', `${opts.chatId}.json`), showReplay: ctx.showReplay,
        pricesOf: model => listPrice(priceEnginesOf(engine), model),
      } }, sink);
  }
}

function prepared(launch: PreparedAdapter, sink: SessionSink): HarnessSession {
  const remote = runtimeAdapter(launch, sink);
  if (remote) return remote;
  switch (launch.kind) {
    case 'claude': return new ClaudeSession(launch.options, sink);
    case 'acp': return new AcpSession(launch.options, sink);
    case 'codex': return new CodexSession(launch.options, sink);
    case 'api': return new ApiSession(launch.options, sink);
  }
}

/** The models each engine offers (models:seen, ADR 0256): its live list (engines/model-lists.ts, or a chat's session),
 *  the cached one when the source failed (the store keeps the last), and only for an engine that never listed any its
 *  rows in the brain's harness/models.json (at 0: the last fallback). A Claude engine also gets the claude-* models the
 *  Anthropic Models API listed on the user's Anthropic API key, so a model out today shows up even when the bundled
 *  Claude Code does not name it yet (the key itself never leaves its own engine). */
export function withApiModels(seen: ModelsSeen): ModelsSeen {
  const out: ModelsSeen = { ...seen };
  for (const e of engines()) {
    if (!out[e.id]?.ids.length) {
      const ids = registryModels(priceEnginesOf(e));
      if (ids.length) out[e.id] = { ids, at: 0 };
    }
    const api = anthropicApi();
    const extra = e.kind === 'claude' && api ? (seen[api.id]?.ids ?? []).filter(m => /^claude-/.test(m.id)) : [];
    const have = new Set((out[e.id]?.ids ?? []).map(m => m.id.replace(/-\d{8}$/, '')));
    const add = extra.filter(m => !have.has(m.id.replace(/-\d{8}$/, '')));
    // a registry fallback (at 0) stays labelled so: only the ids are added
    if (add.length) out[e.id] = { ids: [...(out[e.id]?.ids ?? []), ...add], at: out[e.id] ? out[e.id]!.at : seen[api!.id]!.at };
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
