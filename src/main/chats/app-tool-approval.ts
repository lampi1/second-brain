// Native MCP approval scope shared by the engine adapters (Claude --allowedTools, Codex approval_mode, Cursor's private
// config): the Orchestrator's app-control tools, and on every chat's own endpoint the mail between chats and the
// delegation tools (agent_delegate, agent_report, agent_children, agent_ask_parent, agent_answer_child: ADR 0083). Only app-owned loopback endpoints qualify;
// browser actions and unrelated servers still ask for permission.
export function appEndpoint(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' && u.hostname === '127.0.0.1' && !!u.port && u.pathname.startsWith('/mcp/')
      && !u.username && !u.password && !u.search && !u.hash;
  } catch { return false; }
}

export const APP_CHAT_TOOLS = ['send_to_chat', 'list_chats', 'agent_delegate', 'agent_report', 'agent_children', 'agent_ask_parent', 'agent_answer_child'] as const;

export function cursorAppPermissions(mcpUrl?: string | null, appMcpUrl?: string | null): string[] {
  return [
    ...(appEndpoint(mcpUrl) ? APP_CHAT_TOOLS.map(t => `Mcp(second-brain:${t})`) : []),
    ...(appEndpoint(appMcpUrl) ? ['Mcp(second-brain-app:*)'] : []),
  ];
}
