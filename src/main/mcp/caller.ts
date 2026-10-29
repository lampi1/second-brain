// The chat calling a tool on its own MCP endpoint (/mcp/chat/:chatId/:token): the caller is the endpoint's chat, never
// an argument the model could fill in. Used by the chat-endpoint tools (agents/delegation.ts, agents/strategy-tools.ts,
// agents/child-feedback.ts, brainmodel/research-tools.ts).
export function callerOf(params: Record<string, string>): string {
  const id = params.chatId;
  if (!id) throw new Error('This tool works only on a chat\'s own endpoint.');
  return id;
}
