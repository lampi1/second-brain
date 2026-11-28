// «Stai aspettando» (ADR 0367): ChatSummary.userWait mirrors main's userWaits (a root chat the Orchestrator opened while
// answering the user's own message); a finished wait keeps its doneAt until a new wait starts.
import { describe, expect, it } from 'vitest';
import { syncUserWait } from '../../../src/main/chats/manager-core';
import type { Rec } from '../../../src/main/chats/manager-types';

type R = Parameters<typeof syncUserWait>[0];
const rec = (p: Partial<Pick<Rec, 'userWaits' | 'heldResult'>>, userWait?: Rec['s']['userWait']): R => ({ ...p, s: userWait ? { userWait } : {} }) as R;

describe('syncUserWait', () => {
  it('starts a wait when the user waits, and keeps its start', () => {
    const r = rec({ userWaits: true });
    syncUserWait(r, 100);
    expect(r.s.userWait).toEqual({ since: 100 });
    syncUserWait(r, 200);
    expect(r.s.userWait).toEqual({ since: 100 });
  });
  it('a held result the user waits for still counts as waiting', () => {
    const r = rec({ heldResult: { userWaits: true } as Rec['heldResult'] });
    syncUserWait(r, 5);
    expect(r.s.userWait).toEqual({ since: 5 });
  });
  it('drops an open wait the user no longer waits for, keeps a finished one, restarts after it', () => {
    const open = rec({}, { since: 1 });
    syncUserWait(open, 9);
    expect(open.s.userWait).toBeUndefined();
    const done = rec({}, { since: 1, doneAt: 5 });
    syncUserWait(done, 9);
    expect(done.s.userWait).toEqual({ since: 1, doneAt: 5 });
    const again = rec({ userWaits: true }, { since: 1, doneAt: 5 });
    syncUserWait(again, 9);
    expect(again.s.userWait).toEqual({ since: 9 });
  });
});
