// Native MCP approval scope shared by the engine adapters: exactly Claude's app-control and chat-mail grants.
// Only app-owned loopback endpoints qualify; browser actions and unrelated servers still ask for permission.
export function appEndpoint(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' && u.hostname === '127.0.0.1' && !!u.port && u.pathname.startsWith('/mcp/')
      && !u.username && !u.password && !u.search && !u.hash;
  } catch { return false; }
}

export const APP_MAIL_TOOLS = ['send_to_chat', 'list_chats'] as const;

export function cursorAppPermissions(mcpUrl?: string | null, appMcpUrl?: string | null): string[] {
  return [
    ...(appEndpoint(mcpUrl) ? APP_MAIL_TOOLS.map(t => `Mcp(second-brain:${t})`) : []),
    ...(appEndpoint(appMcpUrl) ? ['Mcp(second-brain-app:*)'] : []),
  ];
}
