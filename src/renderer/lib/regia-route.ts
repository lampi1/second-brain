// Which Regia is which (ADR 0021): the first Regia, the Orchestrator (the right column), every work Regia's id, the
// Regia a chat answers to and the chats of "Migliora l'app". Also the commands a chat
// gave in the turn that ends with its question (commandsOfTurn: shown with "Esegui" on the question's popup, the
// questions window). "Domande alla Regia" is gone: a work chat's request never shows in the Regia (the user,
// 2026-10-13: "la regia mi serve principalmente per lo stato… e per spostarmi da una chat all'altra"). Pure (no store
// import). Used by RegiaOverlay.tsx, RegiaTile.tsx, QuestionsWindow.tsx, ChatMenu.tsx, Home.tsx and actions.ts.
import type { ChatItem } from '@shared/contract';
import { isRunnable } from '@shared/runnable';
import type { AppState } from '../store/state';
import { codeBlocks } from './markdown';
import { regiaOfChat, regieOf } from '@shared/regia';

/** The Regia's chat id, if there is one. */
export const regiaIdOf = (s: Pick<AppState, 'order' | 'chats'>): string | null => s.order.find(x => s.chats[x]?.isRegia) ?? null;

/** The Orchestrator's id: the one coordinator of work and app improvements (main marks it `orchestrator`, migrating
 *  the old work and app Regie into it), null while there is none. The right column and every "the Regia" lookup. */
export const orchestratorIdOf = (s: Pick<AppState, 'order' | 'chats'>): string | null =>
  s.order.find(x => { const c = s.chats[x]; return !!c?.orchestrator && c.isRegia && !c.closedAt; }) ?? null;

/** Every work Regia's id, in tab order (regiaSince). */
export const regieIdsOf = (s: Pick<AppState, 'order' | 'chats'>): string[] => regieOf(s.order.flatMap(x => (s.chats[x] ? [s.chats[x]!] : []))).map(c => c.id);

/** The Regia a chat answers to (itself for a Regia; null with none). */
export function regiaOfIn(s: Pick<AppState, 'order' | 'chats'>, chatId: string): string | null {
  return regiaOfChat(s.chats[chatId], s.order.map(x => s.chats[x]).filter(c => !!c));
}

/** The chats of "Migliora l'app" (their own section and Regia), in order. */
export const appChatIds = (s: Pick<AppState, 'order' | 'chats'>): string[] => s.order.filter(x => s.chats[x]?.space === 'app');

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
