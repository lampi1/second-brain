// Live costs (src/renderer/lib/live-costs.ts): the cost history read at cost.mjs's time, today's total that moves with
// the app's Claude chats after it, and the day's chats by cost (app chats, sessions outside the app, Cursor's ledger
// and its «prezzo sconosciuto»).
import { describe, expect, it } from 'vitest';
import type { ChatSummary, Usage } from '../../src/shared/contract';
import { CostHistory, costRows, liveTotal } from '../../src/renderer/lib/live-costs';

const chat = (id: string, p: Partial<ChatSummary> = {}): ChatSummary => ({
  id, harness: 'claude', origin: 'app', title: id, cwd: 'C:/x', sessionId: null, model: null, effort: null, permissionMode: null, state: 'idle',
  costUsd: 0, pending: 0, isRegia: false, lastText: '', updatedAt: 1000, browserTabIds: [], ...p,
});
const usage = (p: Partial<Usage> = {}): Usage => ({ todayUsd: 10, fiveHourPct: null, fiveHourResetsAt: null, weekPct: null, costKnown: true, costAt: 1000, ...p });

describe('live costs', () => {
  it('the history gives the cost at a time: the last sample before it, else the oldest known', () => {
    const h = new CostHistory();
    h.note('a', 1, 500); h.note('a', 1, 600); h.note('a', 2, 1500);
    expect(h.at('a', 1000)).toBe(1);
    expect(h.at('a', 2000)).toBe(2);
    expect(h.at('a', 100)).toBe(1);
    expect(h.at('x', 1000)).toBeUndefined();
  });

  it('old samples go, the newest one before them stays', () => {
    const h = new CostHistory();
    h.note('a', 1, 0); h.note('a', 2, 60e3); h.note('a', 3, 20 * 60e3);
    expect(h.at('a', 30e3)).toBe(2); // 0 dropped, 60 s kept as the cost before the recent ones
  });

  it('today\'s total = cost.mjs + what the app\'s Claude chats spent after it read, Cursor apart', () => {
    const h = new CostHistory();
    h.note('a', 2, 900); h.note('a', 3.5, 1200);
    h.note('k', 5, 900); h.note('k', 9, 1200); // another engine: not in cost.mjs's Claude figure
    const chats = [chat('a', { costUsd: 3.5 }), chat('b', { costUsd: 0.25 }), chat('k', { harness: 'kimi', costUsd: 9 })];
    h.note('b', 0, 1100); h.note('b', 0.25, 1300); // started after cost.mjs read
    expect(liveTotal(usage({ cursorTodayUsd: 1, cursorExact: true }), chats, h)).toEqual({ usd: 10 + 1.5 + 0.25 + 1, partial: false, estimated: false });
    expect(liveTotal(usage({ costKnown: false }), chats, h)).toBeNull();
    const t = liveTotal(usage(), [chat('a', { costUsd: 3.5, costLiveUsd: 0.5 })], h);
    expect(t).toMatchObject({ partial: true, estimated: true });
  });

  it('a chat that spends less than it had (restarted) adds nothing', () => {
    const h = new CostHistory();
    h.note('a', 4, 900); h.note('a', 1, 1200);
    expect(liveTotal(usage(), [chat('a', { costUsd: 1 })], h)?.usd).toBe(10);
  });

  it('the day\'s chats by cost: app chats with cost.mjs\'s today + since, sessions outside the app, Cursor\'s ledger', () => {
    const h = new CostHistory();
    h.note('a', 1, 900); h.note('a', 2, 1200);
    const u = usage({ claudeChats: [{ sessionId: 's-a', title: 'A today', usd: 4 }, { sessionId: 's-x', title: 'Fuori', usd: 3 }, { sessionId: 's-0', title: 'zero', usd: 0 }], cursorUnpriced: { chats: ['c-2'], models: ['auto'] }, cursorChatsToday: { 'c-1': 3.5 } });
    const chats = [
      chat('a', { sessionId: 's-a', costUsd: 2, title: 'App A', state: 'running', costLiveUsd: 0.3 }),
      chat('c', { harness: 'cursor', sessionId: 'c-1', costKnown: false, costLedgerUsd: 40 }), // 40 = all its days; today 3.5
      chat('c2', { harness: 'cursor', sessionId: 'c-2', costKnown: false }),
      chat('idle', { costUsd: 0 }),
      chat('old', { sessionId: 's-old', costUsd: 0, closedAt: 5, state: 'closed' }),
    ];
    const rows = costRows(u, chats, h);
    expect(rows.map(r => [r.title, r.usd])).toEqual([['App A', 5], ['c', 3.5], ['Fuori', 3], ['c2', 0]]);
    expect(rows[0]).toMatchObject({ chatId: 'a', approx: true, running: true, closed: false });
    expect(rows[1]).toMatchObject({ approx: true });
    expect(rows[2]).toMatchObject({ key: 's:s-x', closed: true, harness: 'claude' });
    expect(rows[2]!.chatId).toBeUndefined();
    expect(rows[3]).toMatchObject({ unpriced: true });
  });

  it('before any cost.mjs run: the app chats\' own count', () => {
    const rows = costRows(null, [chat('a', { costUsd: 1.5 }), chat('k', { harness: 'kimi', costUsd: 2 })], new CostHistory());
    expect(rows.map(r => r.usd)).toEqual([2, 1.5]);
  });
});
