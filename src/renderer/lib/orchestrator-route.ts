// The Orchestrator's chat id (the right column). Also the commands a chat gave in the turn that ends with its question (commandsOfTurn: shown with "Esegui" on the question's popup, the
// questions window). "Domande all'Orchestrator" is gone: a work chat's request never shows in the Orchestrator (the user,
// 2026-10-13: "l’Orchestrator mi serve principalmente per lo stato… e per spostarmi da una chat all'altra"). Pure (no store
// import). Used by OrchestratorOverlay.tsx, OrchestratorTile.tsx, QuestionsWindow.tsx, ChatMenu.tsx, Home.tsx and actions.ts.
import type { ChatItem } from '@shared/contract';
import { isRunnable } from '@shared/runnable';
import type { AppState } from '../store/state';
import { codeBlocks } from './markdown';

/** The Orchestrator's chat id: the one coordinator of all work, null while there is none. The right column and every
 *  "the Orchestrator" lookup. */
export const orchestratorIdOf = (s: Pick<AppState, 'order' | 'chats'>): string | null =>
  s.order.find(x => { const c = s.chats[x]; return !!c?.isOrchestrator && !c.closedAt; }) ?? null;

export interface TurnCommand { itemId: string; lang: string; code: string }

/** The shell blocks of the chat's current turn (its assistant messages after the user's last one), in order: the
 *  commands a chat gave the user before asking, run from the question's popup as blocks of that chat's message. */
export function commandsOfTurn(items: readonly ChatItem[] | undefined): TurnCommand[] {
  if (!items?.length) return [];
  let from = items.length;
  while (from > 0 && items[from - 1]!.kind !== 'user') from--;
  const out: TurnCommand[] = [];
  for (const it of items.slice(from)) {
    if (it.kind !== 'assistant' || it.streaming || !/^\s{0,3}(`{3,}|~{3,})/m.test(it.text)) continue;
    for (const p of codeBlocks(it.text)) if (isRunnable(p.lang) && p.code.trim()) out.push({ itemId: it.id, lang: p.lang, code: p.code });
  }
  return out;
}
