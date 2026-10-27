// Unit tests of the renderer store's streaming steps (src/renderer/store/store.ts startStore, "Lag nell'app"
// 2026-10-12, one frame since 2026-10-27): new versions of a streamed item are held and applied together every STREAM_MS; a new item or any other
// event first applies what is held, so the order on screen never changes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatItem, ChatSummary } from '@shared/contract';

const handlers = new Map<string, (p: unknown) => void>();
vi.mock('../../src/renderer/sb', () => ({
  sb: {
    invoke: (ch: string) => Promise.resolve(ch === 'chat:list' ? [chat('a')] : ch === 'chat:items' ? [] : ch.endsWith(':list') || ch === 'chat:pending' || ch === 'chat:autoCloseGet' ? [] : null),
    on: (ch: string, fn: (p: unknown) => void) => { handlers.set(ch, fn); return () => {}; },
  },
}));

const chat = (id: string, p: Partial<ChatSummary> = {}): ChatSummary => ({
  id, harness: 'claude', origin: 'app', title: id, cwd: 'C:\\x', sessionId: null, model: null, effort: null, permissionMode: null, state: 'running',
  costUsd: 0, pending: 0, isOrchestrator: false, lastText: '', updatedAt: 1, browserTabIds: [], ...p,
});
const text = (id: string, t: string, streaming = true): ChatItem => ({ kind: 'assistant', id, at: 1, text: t, streaming });
const emit = (ch: string, p: unknown) => handlers.get(ch)!(p);

const { app, startStore, STREAM_MS } = await import('../../src/renderer/store/store');

beforeEach(async () => {
  startStore();
  await vi.waitFor(() => expect(app.get().ready).toBe(true));
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); });

const textOf = (chatId: string, id: string) => (app.get().items[chatId]?.find(i => i.id === id) as { text?: string } | undefined)?.text;

describe('streamed text in steps', () => {
  it('holds new versions of an item and applies the newest one after STREAM_MS', () => {
    emit('chat:item', { chatId: 'a', item: text('m1', 'Ciao'), replace: false });
    expect(textOf('a', 'm1')).toBe('Ciao'); // a new item shows at once
    emit('chat:item', { chatId: 'a', item: text('m1', 'Ciao a'), replace: true });
    emit('chat:item', { chatId: 'a', item: text('m1', 'Ciao a tutti'), replace: true });
    expect(textOf('a', 'm1')).toBe('Ciao');
    vi.advanceTimersByTime(STREAM_MS);
    expect(textOf('a', 'm1')).toBe('Ciao a tutti');
  });

  it('a state change first applies the held words (never "finito" above words still to come)', () => {
    emit('chat:item', { chatId: 'a', item: text('m2', 'Fine'), replace: false });
    emit('chat:item', { chatId: 'a', item: text('m2', 'Fine del lavoro', false), replace: true });
    emit('chat:updated', chat('a', { state: 'idle' }));
    expect(textOf('a', 'm2')).toBe('Fine del lavoro');
    expect(app.get().chats.a?.state).toBe('idle');
  });

  it('a new item first applies the held version of the previous one', () => {
    emit('chat:item', { chatId: 'a', item: text('m3', 'Uno'), replace: false });
    emit('chat:item', { chatId: 'a', item: text('m3', 'Uno due', false), replace: true });
    emit('chat:item', { chatId: 'a', item: { kind: 'tool', id: 't1', at: 2, name: 'Bash', summary: 'npm test', status: 'running' }, replace: false });
    const ids = app.get().items.a?.map(i => i.id);
    expect(ids?.indexOf('m3')).toBeLessThan(ids?.indexOf('t1') ?? -1);
    expect(textOf('a', 'm3')).toBe('Uno due');
  });
});
