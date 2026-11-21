// Code Mode's wiring (ADR 0331), kept out of wiring.ts (over its size): adds run_code to the chat endpoint, bound to
// the ChatManager (decideFor, the tool rows, the chat's folder), the chat's own endpoint tools (browser module) and its
// connectors (mcp-servers gateway); and makes the product guard the manager passes internal calls to (the brain's
// PreToolUse rules, as a Claude session answers them in process). Used by wiring.ts.
import type { ChatItem, ChatSummary } from '../../shared/contract';
import type { McpTool } from '../mcp/server';
import { runHook } from '../rules/runtime';
import type { HookInput } from '../rules/types';
import { productHooksOf, type ProductHooks } from '../brain/adapters/claude-plugin';
import type { InternalVerdict } from '../chats/manager-sink';
import { runCodeTool } from './tool';

export interface CodeModeWiring {
  addChatTools(tools: McpTool[]): void;
  chatToolsFor(chatId: string): McpTool[];
  manager: {
    decideFor(chatId: string, tool: string, input: unknown, opts: { signal?: AbortSignal; waited?: (ms: number) => void }): Promise<InternalVerdict>;
    codeModeRow(chatId: string, item: Extract<ChatItem, { kind: 'tool' }>, replace?: boolean): void;
    summary(chatId: string): ChatSummary | undefined;
  };
  gateway: { chatServers(chatId: string): string[]; chatServerTools(chatId: string, server: string): Promise<McpTool[]> };
}

export function wireCodeMode(w: CodeModeWiring): void {
  w.addChatTools([runCodeTool({
    decideFor: (chatId, tool, input, opts) => w.manager.decideFor(chatId, tool, input, opts),
    row: (chatId, item, replace) => w.manager.codeModeRow(chatId, item, replace),
    appTools: chatId => w.chatToolsFor(chatId),
    extServers: chatId => w.gateway.chatServers(chatId),
    extTools: (chatId, server) => w.gateway.chatServerTools(chatId, server),
    cwd: chatId => w.manager.summary(chatId)?.cwd ?? null,
  })]);
}

/** The brain's PreToolUse guard for an internal call: its refusal, or null. The hooks' facts are read again at most
 *  every 30 s (a brain switched or its rules turned off apply soon, without a cost per call). A guard that throws
 *  fails closed in the manager. */
export function productGuard(userData: string, now: () => number = Date.now): (call: { chatId: string; sessionId: string; tool: string; input: unknown }) => string | null {
  let cached: { at: number; hooks: ProductHooks | null } | null = null;
  return call => {
    if (!cached || now() - cached.at > 30_000) cached = { at: now(), hooks: productHooksOf(userData) };
    const p = cached.hooks;
    if (!p) return null;
    const input = { hook_event_name: 'PreToolUse', session_id: call.sessionId, tool_name: call.tool, tool_input: call.input } as unknown as HookInput;
    return runHook(p.root, p.state, input, { ...p.launch, inProcess: true }).deny ?? null;
  };
}
