// The Codex adapter (ADR 0060): what one `codex app-server` launch gets from the app and the brain, never written into
// the user's ~/.codex (repo rule 6): `-c key=value` overrides on its command line (approval policy, sandbox, the app's
// MCP servers), the domains' AGENTS.md as the thread's developer instructions, the domains' skill folders for
// skills/extraRoots/set. With the brain switched off (Settings) only the app's own part stays (approval, sandbox, MCP).
// CLI 0.163.0-alpha.10.2 accepted these -c overrides and reported the streamable HTTP URL via `mcp get` (18/10).
// Native approval keys follow the official config reference; live model/tool approval behavior is not verified.
// Values stay unquoted (invalid TOML falls back to a string): codex.cmd takes plain arguments (chats/cli.ts cliArgv).
// A Codex chat that starts with the brain switched on but no domain (no brain folder, or it is gone) logs it at info,
// so "Codex does not follow my rules" is visible in `npm run logs`. Used by engines/sessions.ts.
import { log } from '../../log';
import { productInstructions } from '../../rules/instructions';
import { assets, enabled } from '../../rules/delivery';
import { memoryInstructions } from '../../rules/new-brain';
import { toolsRef } from '../../rules/tools';
import { instructionsOf, launchRules, skillDirs, type BrainDomain } from './domains';
import type { CodexApproval, CodexSandbox } from '../../chats/codex';
import { codexPolicyFor } from './codex-policy';
import type { AgentPolicy } from '../../agents/tool-policy';
import { APP_MAIL_TOOLS, appEndpoint } from '../../chats/app-tool-approval';

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
  /** the agent's tool policy and ceiling (A2): they only narrow the folder's policy */
  agentPolicy?: AgentPolicy | null;
}

/** A value safe on a cmd.exe command line and in a -c override (chats/cli.ts cliArgv's plain-argument rule). */
const PLAIN = /^[\w.:@/=[\],-]+$/;

// Match Claude: every app-control tool, but only mail/list on the browser server.
function attachMcp(config: string[], server: 'second-brain' | 'second-brain-app', raw: string | null): void {
  if (!raw || !PLAIN.test(raw)) return;
  config.push(`mcp_servers.${server}.url=${raw}`);
  if (!appEndpoint(raw)) return;
  config.push(`mcp_servers.${server}.default_tools_approval_mode=${server === 'second-brain-app' ? 'approve' : 'prompt'}`);
  if (server === 'second-brain') for (const tool of APP_MAIL_TOOLS) config.push(`mcp_servers.${server}.tools.${tool}.approval_mode=approve`);
}

export function codexLaunch(i: CodexLaunchInput): CodexLaunch {
  const rules = i.domains && i.brain !== undefined ? null : launchRules();
  const domains = i.domains ?? rules?.domains ?? [];
  const brain = i.brain ?? rules?.codex ?? true;
  const policy = codexPolicyFor(i.cwd ?? '', i.readOnly, i.agentPolicy);
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
    developerInstructions: brain ? domains.map(d => {
      if (!enabled(d.root) || i.readOnly) return productInstructions(d.root, true) ?? instructionsOf([d]);
      const tools = toolsRef(d.root);
      return `${productInstructions(d.root, true, tools)}\n\n${memoryInstructions(assets(), d.root, tools)}`;
    }).filter(Boolean).join('\n\n') || null : null,
    skillRoots: brain && !i.readOnly ? skillDirs(domains, ['.agents/skills', '.claude/skills']) : [],
  };
}

