// The order of the agents on screen is the Orchestrator's, never the user's: agents are grouped by area (the project
// folder the Orchestrator opened them in), groups follow the first agent started in each, and inside a group agents
// keep their start order, so a row never jumps when its state changes. Used by AgentStrips.tsx.
import type { ChatSummary } from '@shared/contract';

export interface AgentGroup { area: string; ids: string[] }

/** The area of a chat: the last segment of its working folder ("C:\\repos\\portal" → "portal"), '' when unknown. */
export const areaOf = (chat: Pick<ChatSummary, 'cwd'>): string => chat.cwd.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) ?? '';

/** `order` (start order) grouped by area; ids missing from `chats` are dropped. */
export function agentGroups(order: readonly string[], chats: Readonly<Record<string, Pick<ChatSummary, 'cwd'> | undefined>>): AgentGroup[] {
  const groups = new Map<string, string[]>();
  for (const id of order) {
    const chat = chats[id];
    if (!chat) continue;
    const area = areaOf(chat);
    groups.set(area, [...(groups.get(area) ?? []), id]);
  }
  return [...groups].map(([area, ids]) => ({ area, ids }));
}

/** The flat Orchestrator order: the groups one after the other. */
export const agentOrder = (order: readonly string[], chats: Readonly<Record<string, Pick<ChatSummary, 'cwd'> | undefined>>): string[] =>
  agentGroups(order, chats).flatMap(g => g.ids);
