// Routine workers and their descendants live on the Routine page, never in the general workspace or sidebar.
// Persisted host placement handles fresh workers; flow bindings cover older chats created before this metadata.
import type { ChatSummary } from '@shared/contract';
import type { FlowSnapshot } from '@shared/flows';
type Chats = Readonly<Record<string, ChatSummary | undefined>>;
/** All archived worker identities, including package-only workers without legacy flow placement metadata. */
export function routineChatIds(chats: Chats): Set<string> {
  return new Set([...routinePlacements(chats).keys(), ...Object.values(chats).filter(c => c?.routineArchived || c?.routinePackage).map(c => c!.id)]);
}
export function routinePlacements(chats: Chats, snapshot?: Pick<FlowSnapshot, 'runs'> | null): Map<string, NonNullable<ChatSummary['routine']>> {
  const found = new Map<string, NonNullable<ChatSummary['routine']>>();
  for (const chat of Object.values(chats)) if (chat?.routine) found.set(chat.id, chat.routine);
  for (const run of snapshot?.runs ?? []) for (const step of run.steps) if (step.chatId && chats[step.chatId] && (!step.chatRunId || chats[step.chatId]?.run?.runId === step.chatRunId)) found.set(step.chatId, { runId: run.id, stepId: step.stepId });
  for (const chat of Object.values(chats)) {
    if (!chat || found.has(chat.id)) continue;
    const seen = new Set([chat.id]); let parent = chat.parentId;
    while (parent && !seen.has(parent)) { seen.add(parent); const placement = found.get(parent); if (placement) { found.set(chat.id, placement); break; } parent = chats[parent]?.parentId; }
  }
  return found;
}
export const routineChatArg = (chatId: string, tabId?: string): string => `chat:${encodeURIComponent(chatId)}${tabId ? `/browser:${encodeURIComponent(tabId)}` : ''}`;
export function readRoutineChatArg(arg?: string | null): { chatId: string; tabId?: string } | null {
  if (!arg?.startsWith('chat:')) return null;
  const [chat, tab] = arg.slice(5).split('/browser:');
  try { return chat ? { chatId: decodeURIComponent(chat), ...(tab ? { tabId: decodeURIComponent(tab) } : {}) } : null; } catch { return null; }
}
