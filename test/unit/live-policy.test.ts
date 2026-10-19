// Unit tests of the main-side notification policy (src/main/brain/live.ts, 2026-10-13): kinds' default priorities,
// the end of an app chat's turn (no event for an Orchestrator, "chat-failed" on an error).
import { describe, expect, it } from 'vitest';
import { doneEvent, KINDS } from '../../src/main/brain/live';

describe('live feed policy', () => {
  it('kinds: chat-failed urgent, chat-done and the bookkeeping kinds quiet', () => {
    expect(KINDS['chat-failed']?.priority).toBe('urgent');
    for (const k of ['chat-done', 'now', 'done', 'decision', 'proposal', 'mail', 'sync-ok']) expect(KINDS[k]?.priority).toBe('quiet');
  });

  it('a turn end: nothing for a Orchestrator, chat-failed on an error, chat-done otherwise', () => {
    const c = { id: 'a', title: 'Fix', isOrchestrator: false };
    expect(doneEvent(undefined)).toBeNull();
    expect(doneEvent({ ...c, isOrchestrator: true })).toBeNull();
    expect(doneEvent({ ...c, lastResult: { at: 1, isError: false } })).toMatchObject({ kind: 'chat-done', chatId: 'a', title: 'Fix' });
    expect(doneEvent({ ...c, lastResult: { at: 1, isError: false, interrupted: true } })?.kind).toBe('chat-done');
    expect(doneEvent({ ...c, lastResult: { at: 1, isError: true } })).toMatchObject({ kind: 'chat-failed', chatId: 'a' });
    // the CLI died mid-turn: chat-failed with its error, even after a good last turn; never for an Orchestrator
    expect(doneEvent({ ...c, lastResult: { at: 1, isError: false } }, 'fatal: boom')).toMatchObject({ kind: 'chat-failed', chatId: 'a', detail: expect.stringContaining('fatal: boom') });
    expect(doneEvent({ ...c, isOrchestrator: true }, 'fatal: boom')).toBeNull();
  });

});
