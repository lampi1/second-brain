// The asking chat's items as the questions window shows them: frozen when the card opens (the owner, 2026-11-10: «a
// volte la modale si modifica da sola mentre è aperta»). The card's context, brief, visuals and the turn's commands all
// read the chat's items; while the chat kept writing in the same turn the text grew or vanished under the reader and the
// Sì / No buttons moved. Now the window keeps the items it opened with (AskItemsProvider) and only a one-line notice says
// something new came («L'agente ha aggiunto qualcosa · Mostra»): a click takes the new items in. Outside the window
// (tiles, lane) the hooks read the live store as before. `turnSignature` (lib/askContext.ts) is the pure part (what counts as new: the
// turn's text, reasoning and attached visuals, never a tool's status), pinned by test/unit/askItems.test.ts.
// Used by QuestionsWindow.tsx (provider), RequestPanel.tsx, AskContext.tsx and GenUi.tsx (useAskItems).
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ChatItem } from '@shared/contract';
import { useApp } from '../store/store';
import { turnSignature } from './askContext';

interface Frozen { chatId: string; items: readonly ChatItem[] | undefined }
const Ctx = createContext<Frozen | null>(null);

/** The chat's items for a question card: the window's frozen copy when it froze this chat, else the live store. */
export function useAskItems(chatId: string): readonly ChatItem[] | undefined {
  const live = useApp(s => s.items[chatId]);
  const f = useContext(Ctx);
  return f && f.chatId === chatId ? f.items : live;
}

/** Freezes `chatId`'s items for one request (`reqKey`): the first loaded copy stays until `refresh`. `changed` = the
 *  live turn reads differently from the frozen one. */
export function useFrozenItems(chatId: string, reqKey: string): { items: readonly ChatItem[] | undefined; changed: boolean; refresh: () => void } {
  const live = useApp(s => s.items[chatId]);
  const [held, setHeld] = useState<{ key: string; items: readonly ChatItem[] | undefined }>({ key: reqKey, items: live });
  // a new request, or the items were not loaded yet when the card opened: take the live ones
  const stale = held.key !== reqKey || (held.items === undefined && live !== undefined);
  useEffect(() => { if (stale) setHeld({ key: reqKey, items: live }); }, [stale, reqKey, live]);
  const liveSig = useMemo(() => turnSignature(live), [live]);
  const heldSig = useMemo(() => turnSignature(held.items), [held.items]);
  const changed = !stale && liveSig !== heldSig;
  // nothing a reader sees changed (a tool's status, a message that stopped streaming): the live items, so a command
  // block that finished streaming still shows
  const items = stale || !changed ? live : held.items;
  return { items, changed, refresh: () => setHeld({ key: reqKey, items: live }) };
}

export function AskItemsProvider({ chatId, items, children }: { chatId: string; items: readonly ChatItem[] | undefined; children: ReactNode }) {
  const v = useMemo(() => ({ chatId, items }), [chatId, items]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}
