// Code Mode's rules (ADR 0331): which chats get run_code, the native tools it replaces on Claude, and the internal
// tool names a script may call. Pure: read by the ChatManager (manager-sessions.ts: launch flags, tool visibility),
// by run_code (code-mode/tool.ts) and by their tests.
import type { ChatSummary } from '../../shared/contract';

/** the app's MCP tool that runs a script (on the chat endpoint: mcp__second-brain__run_code on Claude) */
export const RUN_CODE = 'run_code';

/** Claude's native tools a Code Mode chat does not see (--disallowedTools): run_code's wrappers do their work, through
 *  the app's permission chain. Agent, Skill, web, todo and plan tools stay native. */
export const CODE_MODE_HIDDEN = ['Bash', 'PowerShell', 'Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Grep', 'Glob'] as const;

/** The wrappers a script reaches as tools.<Name>: the same names, inputs and checks as the native ones. */
export const NATIVE_WRAPPERS = ['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob'] as const;
export type NativeWrapper = typeof NATIVE_WRAPPERS[number];

/** Code Mode for one chat, the setting being `on`: a Claude or Cursor chat of the user or of a role; never the
 *  Orchestrator (a short turn of app calls, ADR 0090) nor the app's maintenance research (read-only, its own frame). */
export function codeModeFor(s: Pick<ChatSummary, 'harness' | 'isOrchestrator' | 'research'>, on: boolean): boolean {
  return on && !s.isOrchestrator && !s.research && (s.harness === 'claude' || s.harness === 'cursor');
}

/** A tool name as a script writes it, made the name the app's gates know: the Claude form (mcp__<server>__<tool>) for
 *  an MCP tool, the bare name for a native wrapper. `app` = a tool of the chat's own endpoint. */
export function gateName(kind: 'native' | 'app' | 'ext', tool: string, server?: string): string {
  if (kind === 'native') return tool;
  if (kind === 'app') return `mcp__second-brain__${tool}`;
  return `mcp__${server ?? 'ext'}__${tool}`;
}
