// The Codex adapter (ADR 0060): what one `codex app-server` launch gets from the app and the brain, never written into
// the user's ~/.codex (repo rule 6): `-c key=value` overrides on its command line (approval policy, sandbox, the app's
// MCP servers), the domains' AGENTS.md as the thread's developer instructions, the domains' skill folders for
// skills/extraRoots/set. With the brain switched off (Settings) only the app's own part stays (approval, sandbox, MCP).
// UNVERIFIED (docs read 16/10, no CLI run): the -c keys `approval_policy`, `sandbox_mode`, `mcp_servers.<name>.url`
// (streamable HTTP) and their place before the subcommand; the values are left unquoted (TOML that does not parse is
// taken as a string) because an npm-installed codex.cmd only takes plain arguments (chats/cli.ts cliArgv).
// A Codex chat that starts with the brain switched on but no domain (no brain folder, or it is gone) logs it at info,
// so "Codex does not follow my rules" is visible in `npm run logs`. Used by engines/sessions.ts.
import { log } from '../../log';
import { instructionsOf, launchRules, skillDirs, type BrainDomain } from './domains';
import type { CodexApproval, CodexSandbox } from '../../chats/codex';

export interface CodexLaunch {
  configArgs: string[];
  developerInstructions: string | null;
  skillRoots: string[];
}

export interface CodexLaunchInput {
  mcpUrl: string | null;
  appMcpUrl: string | null;
  readOnly?: boolean;
  /** absent: from launchRules() (wiring.ts) */
  domains?: BrainDomain[];
  brain?: boolean;
  /** the chat being started (only for the log line) */
  chatId?: string;
}

/** A value safe on a cmd.exe command line and in a -c override (chats/cli.ts cliArgv's plain-argument rule). */
const PLAIN = /^[\w.:@/=[\],-]+$/;

export function codexLaunch(i: CodexLaunchInput): CodexLaunch {
  const rules = i.domains && i.brain !== undefined ? null : launchRules();
  const domains = i.domains ?? rules?.domains ?? [];
  const brain = i.brain ?? rules?.codex ?? true;
  const approval: CodexApproval = 'on-request';
  const sandbox: CodexSandbox = i.readOnly ? 'read-only' : 'workspace-write';
  const c = [`approval_policy=${approval}`, `sandbox_mode=${sandbox}`];
  // a read-only run (the comparison's side b) gets no MCP: it must change nothing, as Claude's read-only run
  if (!i.readOnly) {
    if (i.mcpUrl && PLAIN.test(i.mcpUrl)) c.push(`mcp_servers.second-brain.url=${i.mcpUrl}`);
    if (i.appMcpUrl && PLAIN.test(i.appMcpUrl)) c.push(`mcp_servers.second-brain-app.url=${i.appMcpUrl}`);
  }
  if (brain && !domains.length) log.info('brain', 'codex chat starts without the brain\'s rules: no brain domain', { ...(i.chatId ? { chat: i.chatId } : {}), hint: 'choose the brain folder in Settings (or switch off «Regole del cervello alle chat Codex»)' });
  return {
    configArgs: c.flatMap(v => ['-c', v]),
    developerInstructions: brain ? instructionsOf(domains) : null,
    skillRoots: brain && !i.readOnly ? skillDirs(domains, ['.agents/skills', '.claude/skills']) : [],
  };
}

