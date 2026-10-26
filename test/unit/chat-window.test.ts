// Transcript windows bound IPC/live payload without truncating messages or changing durable history.
import { expect, it } from 'vitest';
import type { ChatItem } from '../../src/shared/contract';
import { chatWindow } from '../../src/shared/chat-window';
const item = (id: string, text = id): ChatItem => ({ kind: 'assistant', id, at: 1, text });
it('keeps a contiguous tail by count and bytes, leaving input untouched', () => {
  const items = Array.from({ length: 700 }, (_, i) => item(String(i)));
  expect(chatWindow(items)).toHaveLength(600);
  expect(chatWindow(items, 2)).toEqual(items.slice(-2));
  expect(chatWindow(items, 600, 1)).toEqual(items.slice(-1));
  expect(items).toHaveLength(700);
});
it('preserves a single oversized report exactly and bounds later messages', () => {
  const huge = item('huge', 'x'.repeat(1_100_000));
  expect(chatWindow([item('before'), huge])).toEqual([huge]);
  expect(chatWindow([huge, item('after')])).toEqual([item('after')]);
});
it('counts nested outputs and images, and rejects unbounded caller limits', () => {
  const tool: ChatItem = { kind: 'tool', id: 't', at: 1, name: 'Read', summary: 'read', status: 'ok', input: { nested: ['x'.repeat(600_000)] } };
  expect(chatWindow([item('before'), tool])).toEqual([tool]);
  for (const n of [0, -1, NaN, Infinity, 601, 1.5]) expect(() => chatWindow([], n)).toThrow('Invalid transcript window');
  expect(() => chatWindow([], 600, 2 ** 30)).toThrow('Invalid transcript window');
});
