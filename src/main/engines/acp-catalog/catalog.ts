// The ACP agent catalog (ADR 0221): known Agent Client Protocol CLIs the user may turn on in Impostazioni → Account e
// strumenti, as proposals. Why: «usare tutte le harness» becomes a switch instead of a hand-written models.json entry.
// Each entry is off and untrusted until the user's own click records its start definition (engines/trust.ts): the app
// never installs a CLI (company PCs), never runs its sign-in by itself (only the user's «Accedi», in a visible terminal),
// and an agent editing the brain cannot turn one on. Used by engines/registry.ts.
//
// The data (command, ACP arguments, sign-in command, install page, skill folders) is taken from cloudroom
// gui/plugins/provider-acp/src/known-agents.ts:36-356 at commit becdfa79 (Apache License 2.0; LICENSE and NOTICE beside
// this file). Changes from the source: Cursor and OpenCode are left out (built in, registry.ts); the installer scripts,
// icons, model lists, permission and reasoning flags and per-agent environment variables are left out (the app runs no
// installer, and a catalog entry starts exactly as Settings shows it); a sign-in that installs something (OpenClaw's
// `onboard --install-daemon`) or that is the bare CLI (Droid) is left empty, so «Accedi» is off for them.
// Antigravity (ADR 0332) is the app's own entry, not cloudroom's: `agy acp`, checked by hand against agy 1.5.14.
import type { EngineCatalogInfo } from '../../../shared/contract';

export interface CatalogEntry {
  id: string;
  label: string;
  name: string;
  command: string;
  args: string[];
  /** the arguments of its own sign-in after the command (registry.ts EngineDef.login); empty = none */
  login: string[];
  catalog: EngineCatalogInfo;
  /** the model is the session's "model" config option (registry.ts EngineDef.modelOption) */
  modelOption?: boolean;
  /** takes http MCP servers without announcing mcpCapabilities.http (registry.ts EngineDef.mcpHttp) */
  mcpHttp?: boolean;
  /** tight eager MCP schema budget: omits direct extMcp and compacts chat-endpoint descriptions (registry.ts EngineDef.mcpCompact) */
  mcpCompact?: boolean;
  /** an end_turn with its own background command still running gets one follow-up (registry.ts EngineDef.waitBackground) */
  waitBackground?: boolean;
  /** starts in the folder's long real path (registry.ts EngineDef.realCwd) */
  realCwd?: boolean;
  /** never runs a read-only chat (registry.ts EngineDef.noReadOnly) */
  noReadOnly?: boolean;
  /** prints its models without a session (registry.ts EngineDef.modelsArgs) */
  modelsArgs?: string[];
}

const entry = (id: string, name: string, command: string, args: string[], login: string[], installUrl: string, skillDirs: string[] = []): CatalogEntry =>
  ({ id, label: name, name, command, args, login, catalog: { installUrl, signIn: login.length ? [command, ...login].join(' ') : null, skillDirs } });

/** The catalog, in cloudroom's order (without the two built in). */
export const ACP_CATALOG: readonly CatalogEntry[] = [
  entry('omp', 'omp', 'omp', ['acp'], ['login'], 'https://omp.sh', ['.omp/skills', '.agents/skills', '.claude/skills']),
  entry('grok', 'Grok Build', 'grok', ['agent', 'stdio'], ['login'], 'https://docs.x.ai/build/overview', ['.grok/skills', '.agents/skills']),
  entry('fx', 'fx', 'fx', ['acp'], ['login'], 'https://fx.sh'),
  entry('hermes', 'Hermes Agent', 'hermes', ['acp'], ['login'], 'https://hermes-agent.nousresearch.com'),
  entry('openclaw', 'OpenClaw', 'openclaw', ['acp', '--no-prefix-cwd'], [], 'https://openclaw.ai', ['.agents/skills']),
  entry('devin', 'Devin', 'devin', ['acp'], ['auth', 'login'], 'https://devin.ai'),
  entry('droid', 'Droid', 'droid', ['exec', '--output-format', 'acp'], [], 'https://docs.factory.com/droid-cli/quickstart', ['.factory/skills', '.agents/skills']),
  entry('kilo', 'Kilo Code', 'kilo', ['acp'], ['auth', 'login'], 'https://kilo.ai/docs/cli'),
  entry('cline', 'Cline', 'cline', ['--acp'], ['auth'], 'https://docs.cline.bot/cline-cli/installation'),
  // Antigravity CLI (ADR 0332): never --dangerously-skip-permissions (its permissions reach the app's gates through
  // session/request_permission); no --model flag (the model is its "model" config option); it announces no
  // mcpCapabilities but takes http MCP servers (real run 2026-11-22); its folder as the long real path, and no read-only
  // chats until a live check explains why it once wrote without asking on an 8.3 short-name path; its models from
  // `agy models` (no session, no token), so a first chat can already name one
  { ...entry('antigravity', 'Antigravity', 'agy', ['acp', '--disable-telemetry'], ['acp', '--login'], 'https://antigravity.google'), modelOption: true, mcpHttp: true, mcpCompact: true, waitBackground: true, realCwd: true, noReadOnly: true, modelsArgs: ['models'] },
];
