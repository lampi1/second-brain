// How a chat is named in lists and cards, shared by main (appctl, mail's list_chats) and the renderer, so both agree:
// the Orchestrator is "Orchestrator", any other chat its title.
import type { ChatSummary } from './contract';

export const ORCHESTRATOR_TITLE = 'Orchestrator';

export const chatName = (c: Pick<ChatSummary, 'isOrchestrator' | 'title'>): string => c.isOrchestrator ? ORCHESTRATOR_TITLE : c.title;
