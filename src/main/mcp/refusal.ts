// A tool's refusal of an agent's call that the tool's own rules expect (wrong role, stale version, invalid input): the
// MCP server answers it as an error to the agent but logs it at info, so Manutenzione does not file it as an app bug
// (issue #274). Thrown by tools (appctl/tools.ts); read by mcp/server.ts. UpstreamError: the user's own MCP server behind
// the gateway failed (mcp-servers/gateway.ts logs it), so tools/list answers an error without «method crashed» (#329).
export class ToolRefusal extends Error {}

/** A failure of a user's MCP server behind the gateway, not of the app's own server. */
export class UpstreamError extends Error {}
