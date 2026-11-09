// agent_wake_later (ADR 0238): a chat schedules its own next turn; it is kept across a restart, goes once when due
// (a closed chat reopens through send), one per chat, 0 cancels, never for a chat the user closed. Fake clock and chats.
import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatSummary } from '../../../src/shared/contract';
import { WakeLater, wakeText } from '../../../src/main/chats/wake-later';
import { APP_CHAT_TOOLS } from '../../../src/main/chats/app-tool-approval';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function world(chats: Partial<ChatSummary>[] = [{ id: 'c1' }]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-wake-')); dirs.push(dir);
  const sent: { chatId: string; text: string }[] = [];
  let now = 1_000_000;
  const make = () => new WakeLater({ file: path.join(dir, 'wake-later.json'), chats: () => chats as ChatSummary[], send: async (chatId, text) => { sent.push({ chatId, text }); }, now: () => now });
  return { make, sent, at: (t: number) => { now = t; }, chats };
}

it('wakes the chat once when due, also after a restart, with what it asked to check', async () => {
  const w = world();
  const tool = w.make().tool();
  expect(await tool.run({ minutes: 30, reason: 'controllare la CI della PR' }, { params: { chatId: 'c1' } } as never)).toMatch(/^Sveglia alle /);
  const after = w.make();                                           // the app restarted
  w.at(1_000_000 + 30 * 60_000 - 1);
  expect(after.tick()).toBe(0);
  w.at(1_000_000 + 30 * 60_000);
  expect(after.tick()).toBe(1);
  expect(w.sent).toEqual([{ chatId: 'c1', text: wakeText('controllare la CI della PR') }]);
  expect(after.tick()).toBe(0);
  expect(w.make().list()).toEqual([]);
});

it('keeps one per chat, cancels with 0, refuses bad input, and drops a chat the user closed or removed', () => {
  const w = world([{ id: 'c1' }, { id: 'c2', closedAt: 5, closedBy: 'user' }, { id: 'c3', closedAt: 5, closedBy: 'auto' }]);
  const s = w.make();
  s.set('c1', 10, 'uno'); s.set('c1', 20, 'due');
  expect(s.list()).toEqual([expect.objectContaining({ chatId: 'c1', reason: 'due' })]);
  expect(s.set('c1', 0, '')).toBeNull();
  expect(s.list()).toEqual([]);
  expect(() => s.set('c1', 2000, 'x')).toThrow(/minutes/);
  expect(() => s.set('c1', 5, '  ')).toThrow(/reason/);
  s.set('c2', 1, 'chiusa da lui'); s.set('c3', 1, 'chiusa da sola'); s.set('gone', 1, 'rimossa');
  w.at(1_000_000 + 60_000);
  expect(s.tick()).toBe(1);
  expect(w.sent.map(x => x.chatId)).toEqual(['c3']);               // an auto-closed chat reopens; the user's stays closed
  expect(s.list()).toEqual([]);
});

it('is one of the app tools a chat calls without a permission panel', () => {
  expect(APP_CHAT_TOOLS).toContain('agent_wake_later');
});
