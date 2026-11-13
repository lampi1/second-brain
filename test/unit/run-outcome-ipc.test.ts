// run:outcome handler: only a bounded chat id and one of three verdicts reach ChatManager.markRun, and only once the
// run has settled (no turn, queue or open request). Basis, author and time never come from the renderer. run:touch:
// only a bounded chat id and +1 or -1 reach ChatManager.touchRun (ADR 0297), at any moment of the run.
import { describe, expect, it, vi } from 'vitest';
import { markRunOutcome, touchRunOf } from '../../src/main/run/outcome';
import type { ChatService } from '../../src/main/services';
import type { ChatSummary, PendingRequest } from '../../src/shared/contract';

function chats(chat: Partial<ChatSummary>, pending: Partial<PendingRequest>[] = [], withMark = true) {
  const summary = { id: 'c1', state: 'idle', pending: 0, run: { runId: 'r1', chatId: 'c1' }, ...chat } as ChatSummary;
  const markRun = vi.fn((_id: string, _verdict: string) => summary);
  const service = { list: () => [summary], pending: () => pending as PendingRequest[], ...(withMark ? { markRun } : {}) } as unknown as ChatService;
  return { service, markRun };
}

describe('run:outcome handler', () => {
  it('passes only chat id and verdict to markRun', () => {
    const { service, markRun } = chats({});
    markRunOutcome(service, { chatId: 'c1', verdict: 'partial', basis: 'self', by: 'agent', at: 1, note: 'x' });
    expect(markRun).toHaveBeenCalledWith('c1', 'partial');
  });
  it('rejects malformed payloads', () => {
    const { service, markRun } = chats({});
    for (const bad of [undefined, null, 'c1', {}, { chatId: '', verdict: 'success' }, { chatId: 'x'.repeat(121), verdict: 'success' },
      { chatId: 1, verdict: 'success' }, { chatId: 'c1', verdict: 'unknown' }, { chatId: 'c1', verdict: 'SUCCESS' }, { chatId: 'c1' }])
      expect(() => markRunOutcome(service, bad), JSON.stringify(bad)).toThrow();
    expect(markRun).not.toHaveBeenCalled();
  });
  it('rejects when the service cannot record outcomes or the chat is not a run', () => {
    expect(() => markRunOutcome(chats({}, [], false).service, { chatId: 'c1', verdict: 'success' })).toThrow(/non disponibile/);
    expect(() => markRunOutcome(chats({ run: undefined }).service, { chatId: 'c1', verdict: 'success' })).toThrow(/esecuzione/);
    expect(() => markRunOutcome(chats({}).service, { chatId: 'other', verdict: 'success' })).toThrow(/esecuzione/);
  });
  it('rejects a busy run: starting, running, waiting, queued or with an open request', () => {
    for (const busy of [{ state: 'starting' }, { state: 'running' }, { state: 'waiting' }, { queued: { position: 1 } }, { pending: 1 }] as Partial<ChatSummary>[]) {
      const { service, markRun } = chats(busy);
      expect(() => markRunOutcome(service, { chatId: 'c1', verdict: 'fail' }), JSON.stringify(busy)).toThrow(/in corso/);
      expect(markRun).not.toHaveBeenCalled();
    }
    const { service, markRun } = chats({}, [{ chatId: 'c1', type: 'command' }]);
    expect(() => markRunOutcome(service, { chatId: 'c1', verdict: 'fail' })).toThrow(/in corso/);
    expect(markRun).not.toHaveBeenCalled();
  });
});

describe('run:touch handler', () => {
  it('passes only the chat id and the sign, working or not', () => {
    const touchRun = vi.fn(() => true);
    const service = { touchRun } as unknown as ChatService;
    expect(touchRunOf(service, { chatId: 'c1', sign: -1, at: 5, by: 'agent' })).toBe(true);
    expect(touchRun).toHaveBeenCalledWith('c1', -1);
  });
  it('rejects malformed payloads and records nothing without the service', () => {
    const touchRun = vi.fn(() => true);
    const service = { touchRun } as unknown as ChatService;
    for (const bad of [undefined, null, 'c1', {}, { chatId: '', sign: 1 }, { chatId: 'x'.repeat(121), sign: 1 }, { chatId: 1, sign: 1 }, { chatId: 'c1', sign: 0 }, { chatId: 'c1', sign: 2 }, { chatId: 'c1', sign: '1' }, { chatId: 'c1' }])
      expect(() => touchRunOf(service, bad), JSON.stringify(bad)).toThrow();
    expect(touchRun).not.toHaveBeenCalled();
    expect(touchRunOf({} as ChatService, { chatId: 'c1', sign: 1 })).toBe(false);
  });
});
