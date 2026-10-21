// The open requests of a chat's delegated descendants (children, grandchildren…), for the parent's own chat: a child
// that stops for the user shows its panel in the chat the user is looking at, tagged with who asks, and the answer goes
// to the child (its own chat:answer), which then goes on (ADR 0083). Each request renders as an answerable panel ONCE
// (the owner, 2026-10-19: no duplicated popups): requestHost names the one chat that shows it, the asker when its own
// chat is open, else its nearest open ancestor, else the asker's own card or strip (its "Ti aspetta" line); never the
// Orchestrator, which only learns that a chat waits. The questions window shows the same request instead of the panel
// while it is on (ChatTile.tsx InWindowLine). Pure: used by ChatTile.tsx and DelegationCard.tsx; pinned by
// test/unit/chat-tree.test.ts.
import type { ChatSummary, PendingRequest } from '@shared/contract';

export interface ChildRequest { req: PendingRequest; chat: Pick<ChatSummary, 'id' | 'title' | 'harness' | 'agent'> }

export function childRequestsFor(parentId: string, chats: Readonly<Record<string, ChatSummary | undefined>>, pending: readonly PendingRequest[]): ChildRequest[] {
  const below = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of Object.values(chats)) {
      if (!c?.parentId || below.has(c.id) || c.closedAt) continue;
      if (c.parentId === parentId || below.has(c.parentId)) { below.add(c.id); grew = true; }
    }
  }
  below.delete(parentId);
  return pending.filter(p => below.has(p.chatId)).map(req => ({ req, chat: chats[req.chatId]! }));
}

/** The view's state that decides which chat is open on screen. */
export interface OpenView { expanded: Readonly<Record<string, boolean>>; focusMode: string | null; maximized: string | null; treeCollapsed?: Readonly<Record<string, boolean>> }
/** Whether this chat's whole conversation is on screen now: in focus mode only that chat, maximized only that one. */
export function isOpenChat(id: string, v: OpenView): boolean {
  if (v.focusMode) return v.focusMode === id;
  if (v.maximized && v.maximized !== 'orchestrator') return v.maximized === `chat:${id}`;
  return v.expanded[id] === true;
}
/** The one chat whose view shows the requests of `chatId` as panels (see the header). */
export function requestHost(chatId: string, chats: Readonly<Record<string, Pick<ChatSummary, 'parentId' | 'isOrchestrator'> | undefined>>, v: OpenView): string {
  const visible = (id:string):boolean => {
    if (v.focusMode || v.maximized && v.maximized !== 'orchestrator') return isOpenChat(id,v);
    for (let p=chats[id]?.parentId,n=0;p&&n<16;p=chats[p]?.parentId,n++) if(v.treeCollapsed?.[p]) return false;
    return true;
  };
  if (visible(chatId) && isOpenChat(chatId, v)) return chatId;
  for (let p = chats[chatId]?.parentId, n = 0; p && n < 16; p = chats[p]?.parentId, n++) {
    const c = chats[p];
    if (!c || c.isOrchestrator) break;
    if (visible(p) && isOpenChat(p, v)) return p;
  }
  return chatId;
}
