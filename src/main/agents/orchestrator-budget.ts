// The Orchestrator's per-turn workspace budget (ADR 0090, issue #98): the Orchestrator is the user's conversation, so a
// turn of its own must stay short. Its workspace tools (commands, file reads and searches, edits, web fetches, MCP
// servers other than the app's own) count per turn; within the budget they run as before (a quick single Read is
// fine), beyond it each one is refused with a message telling it to delegate with app_create_chat. A speed guard, not a
// permission: the role keeps every tool class (ADR 0085), the app's own tools (app_*, task_estimate, the chat mail)
// and questions to the user never count, and a sub-agent's calls (the Explore search) are its own. Claude only (an
// in-process PreToolUse hook, chats/claude.ts); other engines get the role instructions alone. Used by
// chats/manager.ts startSession; pinned by test/unit/agents/orchestrator-budget.test.ts.
import type { PreToolCall, PreToolHook } from '../chats/session';

/** Workspace calls the Orchestrator may make in one turn before it must delegate. */
export const ORCHESTRATOR_TOOL_BUDGET = 3;

/** Claude's built-in tools that do workspace work (slow chains: shell, reads, searches, edits, the web). */
const WORKSPACE_TOOLS: ReadonlySet<string> = new Set([
  'Bash', 'PowerShell', 'BashOutput', 'Read', 'Grep', 'Glob', 'LS', 'NotebookRead',
  'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch',
]);
/** The app's own MCP servers (/mcp/app, /mcp chat tools): coordination, never workspace work. */
const APP_MCP = ['mcp__second-brain-app__', 'mcp__second-brain__'];

/** True when a call of `tool` counts against the budget: a workspace tool or an MCP server that is not the app's. */
export function budgetedTool(tool: string): boolean {
  if (WORKSPACE_TOOLS.has(tool)) return true;
  return tool.startsWith('mcp__') && !APP_MCP.some(p => tool.startsWith(p));
}

/** The refusal the model reads once the budget is used. */
export function budgetMessage(tool: string, limit = ORCHESTRATOR_TOOL_BUDGET): string {
  return `${tool} refused: you already used ${limit} workspace calls in this turn, and the Orchestrator must stay free for the user. ` +
    'Delegate this work now with app_create_chat (roleId scout to inspect code, files or DevOps state; herald for GitHub issues and writes to external services; artisan for a change; sentinel for checks), ' +
    'tell the user in one line what you started, and end your turn.';
}

/** One Orchestrator session's budget: counts budgeted main-thread calls, refuses beyond `limit`, resets per turn. */
export class TurnToolBudget implements PreToolHook {
  private used = 0;
  constructor(readonly limit = ORCHESTRATOR_TOOL_BUDGET) {}
  decide(call: PreToolCall): { deny: string } | null {
    if (call.agentId || !budgetedTool(call.tool)) return null;
    if (this.used >= this.limit) return { deny: budgetMessage(call.tool, this.limit) };
    this.used++;
    return null;
  }
  turnEnded(): void { this.used = 0; }
  get count(): number { return this.used; }
}
