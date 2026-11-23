// How many agents are working right now, for the badge beside the Grindhouse entry of the sidebar (Sidebar.tsx):
// open chats whose engine is starting or running a turn. Idle, waiting for the user, failed or closed chats are not
// counted, nor a turn that is only closing (turnClosing: the reply is complete, ADR 0318). Pure; pinned by
// test/unit/working-count.test.ts.
import type { ChatSummary } from '@shared/contract';

type Row = Pick<ChatSummary, 'state' | 'closedAt' | 'turnClosing'>;

export function workingCount(chats: Readonly<Record<string, Row | undefined>>): number {
  let n = 0;
  for (const c of Object.values(chats)) {
    if (!c || c.closedAt || c.turnClosing) continue;
    if (c.state === 'running' || c.state === 'starting') n++;
  }
  return n;
}
