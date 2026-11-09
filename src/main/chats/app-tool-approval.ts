// Native MCP approval scope shared by the engine adapters (Claude --allowedTools, Codex approval_mode, Cursor's private
// config, the other ACP agents' permission requests in acp.ts): the Orchestrator's app-control tools, and on every chat's own endpoint the mail between chats and the
// delegation tools (agent_delegate, agent_report, agent_children, agent_ask_parent, agent_answer_child: ADR 0083) and a
// Strategist's plan with the user (plan_propose, plan_update: ADR 0108) and the maintenance research's pack and cards
// (maintenance_pack, maintenance_propose: ADR 0132; maintenance_role_trial: ADR 0195; shown to that chat only). Only app-owned loopback endpoints qualify;
// browser actions and unrelated servers still ask for permission.
export function appEndpoint(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' && u.hostname === '127.0.0.1' && !!u.port && u.pathname.startsWith('/mcp/')
      && !u.username && !u.password && !u.search && !u.hash;
  } catch { return false; }
}

export const APP_CHAT_TOOLS = ['send_to_chat', 'list_chats', 'agent_delegate', 'agent_assign_task', 'agent_task_events', 'agent_work_decisions', 'agent_integrate_child', 'agent_integrate_children', 'agent_report', 'agent_children', 'agent_ask_parent', 'agent_answer_child', 'agent_close_child', 'agent_wake_later', 'plan_propose', 'plan_update', 'maintenance_pack', 'maintenance_propose', 'maintenance_role_trial'] as const;

/** The app's own question surfaces: they only show a card or a question to the user and write nothing, so a native
 *  permission prompt before them is noise (Cursor asked twice before every real question). Kept apart from
 *  APP_CHAT_TOOLS, which also feeds Claude's --allowedTools, Codex's approval_mode and tool-visibility. */
export const APP_UI_TOOLS = ['show_ui', 'ask_user'] as const;

/** Cursor's allow rules for the app's endpoints; uiOnly (read-only chats, whose user allow rules are stripped): only
 *  the question surfaces, never the delegation or mail tools. */
export function cursorAppPermissions(mcpUrl?: string | null, appMcpUrl?: string | null, uiOnly = false): string[] {
  const ui = appEndpoint(mcpUrl) ? APP_UI_TOOLS.map(t => `Mcp(second-brain:${t})`) : [];
  if (uiOnly) return ui;
  return [
    ...(appEndpoint(mcpUrl) ? APP_CHAT_TOOLS.map(t => `Mcp(second-brain:${t})`) : []),
    ...ui,
    ...(appEndpoint(appMcpUrl) ? ['Mcp(second-brain-app:*)'] : []),
  ];
}

/** The same scope for an ACP agent that has no allow rules of its own (OpenCode, the catalog's): true when a
 *  `session/request_permission` of kind "other" names one of the app's tools on the app's own endpoint. OpenCode names an
 *  MCP tool `<server>_<tool>` (its permission key, the request's title); `mcp__<server>__<tool>` is the other spelling an
 *  agent may use. The server names are the ones the app gives its endpoints in session/new and session/load (acp.ts):
 *  a look-alike (second-brain-evil_…) or any other server still asks. */
export function acpAppTool(name: string, mcpUrl?: string | null, appMcpUrl?: string | null, uiOnly = false): boolean {
  const tool = (server: string): string | null => {
    for (const pre of [`${server}_`, `mcp__${server}__`]) if (name.startsWith(pre)) return name.slice(pre.length);
    return null;
  };
  const chat = tool('second-brain');
  if (chat !== null && appEndpoint(mcpUrl)) {
    if ((APP_UI_TOOLS as readonly string[]).includes(chat)) return true;
    if (!uiOnly && (APP_CHAT_TOOLS as readonly string[]).includes(chat)) return true;
  }
  const app = tool('second-brain-app');
  return !uiOnly && app !== null && /^[A-Za-z0-9_-]+$/.test(app) && appEndpoint(appMcpUrl);
}
