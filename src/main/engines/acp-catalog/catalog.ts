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
];
