// The open requests of a chat's delegated descendants (children, grandchildren…), for the parent's own chat: a child
// that stops for the user shows its panel in the chat the user is looking at, tagged with who asks, and the answer goes
// to the child (its own chat:answer), which then goes on (ADR 0083). Pure: used by ChatTile.tsx; pinned by
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
