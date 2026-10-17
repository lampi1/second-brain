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
import { codexPolicyFor } from './codex-policy';

export interface CodexLaunch {
  configArgs: string[];
  developerInstructions: string | null;
  skillRoots: string[];
  approvalPolicy: CodexApproval;
  sandbox: CodexSandbox;
}

export interface CodexLaunchInput {
  cwd?: string;
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

// Native Codex per-tool policy, limited to the app's own attached loopback MCP servers. Claude already
// pre-allows chat mail/list and app-control; Codex gets only these explicit read/mail tools, never a server wildcard.
const APP_TOOL_APPROVALS = {
  'second-brain': ['send_to_chat', 'list_chats'],
  'second-brain-app': ['app_digest', 'app_send_to_chat', 'app_chats', 'app_chat_items', 'app_pending', 'app_feed', 'app_logs', 'app_state'],
} as const;

function attachMcp(config: string[], server: keyof typeof APP_TOOL_APPROVALS, raw: string | null): void {
  if (!raw || !PLAIN.test(raw)) return;
  config.push(`mcp_servers.${server}.url=${raw}`);
  let url: URL;
  try { url = new URL(raw); } catch { return; }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || !url.pathname.startsWith('/mcp/') || url.username || url.password || url.search || url.hash) return;
  config.push(`mcp_servers.${server}.default_tools_approval_mode=prompt`);
  for (const tool of APP_TOOL_APPROVALS[server]) config.push(`mcp_servers.${server}.tools.${tool}.approval_mode=approve`);
}

export function codexLaunch(i: CodexLaunchInput): CodexLaunch {
  const rules = i.domains && i.brain !== undefined ? null : launchRules();
  const domains = i.domains ?? rules?.domains ?? [];
  const brain = i.brain ?? rules?.codex ?? true;
  const policy = codexPolicyFor(i.cwd ?? '', i.readOnly);
  const approval: CodexApproval = policy.approvalPolicy;
  const sandbox: CodexSandbox = policy.sandbox;
  const c = [`approval_policy=${approval}`, `sandbox_mode=${sandbox}`];
  if (approval === 'never') c.push('sandbox_workspace_write.exclude_tmpdir_env_var=true', 'sandbox_workspace_write.exclude_slash_tmp=true', 'sandbox_workspace_write.network_access=false');
  // a read-only run (the comparison's side b) gets no MCP: it must change nothing, as Claude's read-only run
  if (!i.readOnly) {
    attachMcp(c, 'second-brain', i.mcpUrl);
    attachMcp(c, 'second-brain-app', i.appMcpUrl);
  }
  if (brain && !domains.length) log.info('brain', 'codex chat starts without the brain\'s rules: no brain domain', { ...(i.chatId ? { chat: i.chatId } : {}), hint: 'choose the brain folder in Settings (or switch off «Regole del cervello alle chat Codex»)' });
  return {
    configArgs: c.flatMap(v => ['-c', v]),
    approvalPolicy: approval, sandbox,
    developerInstructions: brain ? instructionsOf(domains) : null,
    skillRoots: brain && !i.readOnly ? skillDirs(domains, ['.agents/skills', '.claude/skills']) : [],
  };
}

