// Which of the app's MCP servers and tools one chat may use (ADR 0086): its tool policy first (a role without the
// 'mcp' class gets none; a named `mcp` list keeps only those), then the MCP access of its own role and of every parent
// up to the root (shared/mcp-servers.ts chainAllows: a child never gets more than its parent). Disabled servers are
// never offered. Pure; used by gateway.ts (at every request, so a change on the agent card counts at once) and by the
// launch (which endpoints a chat is given). Flash (a quick chat, role 'flash') gets a server only when the user turned it
// on for Flash, and then only its reading tools (ADR 0207).
import type { AgentPolicy } from '../agents/tool-policy';
import { FLASH_MCP_ROLE, chainAllows, chainOffers, type McpServerDef, type McpToolInfo, type RoleMcpAccess } from '../../shared/mcp-servers';

/** A chat as the MCP access sees it: its role and its parents' roles (own first; null = a plain chat), its policy. */
export interface ChatMcpContext { roles: (string | null)[]; policy: AgentPolicy | null }

export function policyAllowsServer(policy: AgentPolicy | null | undefined, id: string): boolean {
  if (!policy?.tools) return true;
  if (!policy.tools.allow.includes('mcp')) return false;
  return !policy.tools.mcp || policy.tools.mcp.includes(id);
}

export const levelsOf = (ctx: ChatMcpContext, access: (role: string) => RoleMcpAccess | undefined): (RoleMcpAccess | undefined)[] =>
  ctx.roles.map(r => (r ? access(r) : undefined));

/** The servers this chat is given (ids), in the store's order. */
export function serversFor(servers: readonly McpServerDef[], ctx: ChatMcpContext, access: (role: string) => RoleMcpAccess | undefined): string[] {
  const levels = levelsOf(ctx, access);
  return servers.filter(s => s.enabled && policyAllowsServer(ctx.policy, s.id) && chainOffers(levels, s.id)).map(s => s.id);
}

export function toolFor(ctx: ChatMcpContext, access: (role: string) => RoleMcpAccess | undefined, server: string, tool: Pick<McpToolInfo, 'name' | 'readOnly'>): boolean {
  // Flash is read-only (ADR 0107): only a server's reading tools, whatever was picked (ADR 0207)
  if (ctx.roles[0] === FLASH_MCP_ROLE && !tool.readOnly) return false;
  return policyAllowsServer(ctx.policy, server) && chainAllows(levelsOf(ctx, access), server, tool);
}
