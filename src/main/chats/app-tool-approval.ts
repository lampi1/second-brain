// Native MCP approval scope shared by the engine adapters (Claude --allowedTools, Codex approval_mode, Cursor's private
// config): the Orchestrator's app-control tools, and on every chat's own endpoint the mail between chats and the
// delegation tools (agent_delegate, agent_report, agent_children, agent_ask_parent, agent_answer_child: ADR 0083) and a
// Strategist's plan with the user (plan_propose, plan_update: ADR 0108) and the maintenance research's pack and cards
// (maintenance_pack, maintenance_propose: ADR 0132; shown to that chat only). Only app-owned loopback endpoints qualify;
// browser actions and unrelated servers still ask for permission.
export function appEndpoint(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' && u.hostname === '127.0.0.1' && !!u.port && u.pathname.startsWith('/mcp/')
      && !u.username && !u.password && !u.search && !u.hash;
  } catch { return false; }
}

export const APP_CHAT_TOOLS = ['send_to_chat', 'list_chats', 'agent_delegate', 'agent_assign_task', 'agent_task_events', 'agent_work_decisions', 'agent_integrate_child', 'agent_integrate_children', 'agent_report', 'agent_children', 'agent_ask_parent', 'agent_answer_child', 'plan_propose', 'plan_update', 'maintenance_pack', 'maintenance_propose', 'flow_devops_write'] as const;

export function cursorAppPermissions(mcpUrl?: string | null, appMcpUrl?: string | null): string[] {
  return [
    ...(appEndpoint(mcpUrl) ? APP_CHAT_TOOLS.map(t => `Mcp(second-brain:${t})`) : []),
    ...(appEndpoint(appMcpUrl) ? ['Mcp(second-brain-app:*)'] : []),
  ];
}
