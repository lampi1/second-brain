// A tool's refusal of an agent's call that the tool's own rules expect (wrong role, stale version, invalid input): the
// MCP server answers it as an error to the agent but logs it at info, so Manutenzione does not file it as an app bug
// (issue #274). Thrown by tools (appctl/tools.ts); read by mcp/server.ts.
export class ToolRefusal extends Error {}
