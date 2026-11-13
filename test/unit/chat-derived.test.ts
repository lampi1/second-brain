// Unit tests of renderer/lib/chat-derived.ts: each derived value equals the pure function it wraps, is computed once
// per chats object (the same reference for every subscriber until the chats change), and the cheap equalities that
// replace JSON.stringify say "same" exactly when what is shown is the same.
import { describe, expect, it } from 'vitest';
import type { BrowserTab, ChatSummary } from '../../src/shared/contract';
import { chatTree } from '../../src/renderer/lib/chat-tree';
import { titlesKey } from '../../src/renderer/lib/chatrefs';
import { originOf } from '../../src/renderer/lib/chat-origin';
import { orchestratorTally } from '../../src/renderer/lib/orchestrator-tally';
import { queuedCount, runningCount } from '../../src/renderer/store/state';
import {
  chatList, firstQueuedOf, openKidsOf, originFor, queuedOf, routineIdList, runningOf, sameOrigin, sameTally, sameTree, sidebarTree, stripTiles,
  stripTree, tabOwners, tallyOf, titlesKeyOf,
} from '../../src/renderer/lib/chat-derived';

const NOW = new Date(2026, 9, 29, 15, 0).getTime();
const chat = (id: string, p: Partial<ChatSummary> = {}): ChatSummary => ({
  id, harness: 'claude', origin: 'app', title: `Area · ${id}`, cwd: '/w/a', sessionId: null, model: null, effort: null, permissionMode: null, state: 'idle',
  costUsd: 1, pending: 0, isOrchestrator: false, lastText: '', updatedAt: 1, browserTabIds: [], ...p,
});
const chats: Record<string, ChatSummary> = {
  o: chat('o', { isOrchestrator: true, title: 'Orchestrator' }),
  r: chat('r', { run: { startedBy: 'orchestrator', startedAt: NOW - 1000 } as ChatSummary['run'], state: 'running' }),
  k1: chat('k1', { parentId: 'r', delegation: { role: 'scout', goal: 'g', doneWhen: [], at: 2 } as unknown as ChatSummary['delegation'] }),
  k2: chat('k2', { parentId: 'r', delegation: { role: 'scout', goal: 'g', doneWhen: [], at: 1 } as unknown as ChatSummary['delegation'], queued: { position: 1 } as ChatSummary['queued'] }),
  gone: chat('gone', { closedAt: 5, state: 'closed' }),
  w: chat('w', { routineArchived: true } as Partial<ChatSummary>),
  q: chat('q', { quick: true } as Partial<ChatSummary>),
};
const order = Object.keys(chats);
const tabs = [{ id: 't1', ownerChatId: 'r', url: 'https://x', title: 'x' }, { id: 't2', url: 'https://y', title: 'y' }] as BrowserTab[];

describe('derived once per chats object, same as the pure functions', () => {
  it('trees, tiles and owners', () => {
    const tree = stripTree(order, chats);
    expect(tree).toEqual(chatTree(order.filter(id => id !== 'w'), chats));
    expect(stripTree(order, chats)).toBe(tree);
    expect(stripTree(order, { ...chats })).not.toBe(tree);
    expect(stripTiles(order, chats, tabs).map(t => t.id)).toContain('t1');
    expect(stripTiles(order, chats, tabs)).toBe(stripTiles(order, chats, tabs));
    expect(sidebarTree(order, chats)).toEqual(chatTree(['r', 'k1', 'k2', 'gone'], chats)); // no Orchestrator, Flash or routine worker
    expect(routineIdList(chats)).toEqual(['w']);
    expect(tabOwners(tabs)).toEqual({ t1: 'r' });
    expect(chatList(chats)).toBe(chatList(chats));
  });

  it('origin, titles key, tally, queue and running counts', () => {
    expect(originFor(chats, 'r')).toEqual(originOf(chats.r, Object.values(chats)));
    expect(originFor(chats, 'r')).toBe(originFor(chats, 'r'));
    expect(titlesKeyOf(chats)).toBe(titlesKey(chats));
    expect(tallyOf(chats, NOW)).toEqual(orchestratorTally(Object.values(chats), NOW));
    expect(tallyOf(chats, NOW + 60_000)).toBe(tallyOf(chats, NOW)); // the same day: the same result
    expect(tallyOf(chats, NOW + 86_400_000).started).toBe(0); // a new day counts again
    expect(firstQueuedOf(chats)).toBe('k2');
    expect(runningOf(chats)).toBe(runningCount({ chats }));
    expect(queuedOf(chats)).toBe(queuedCount({ chats }));
    expect(openKidsOf(chats, 'r').map(c => c.id)).toEqual(['k2', 'k1']);
  });
});

describe('cheap equalities', () => {
  it('sameTree: equal nodes are the same tree, any change in a node is not', () => {
    const a = chatTree(order, chats), b = chatTree(order, { ...chats });
    expect(a).not.toBe(b);
    expect(sameTree(a, b)).toBe(true);
    const c = chatTree(order, { ...chats, k1: { ...chats.k1!, closedAt: 9 } });
    expect(sameTree(a, c)).toBe(false);
  });
  it('sameOrigin and sameTally', () => {
    expect(sameOrigin(null, null)).toBe(true);
    expect(sameOrigin({ kind: 'app', at: 1, review: 1 }, { kind: 'app', at: 1, review: 1 })).toBe(true);
    expect(sameOrigin({ kind: 'app', at: 1, review: 1 }, { kind: 'app', at: 1, review: 2 })).toBe(false);
    expect(sameOrigin({ kind: 'resumed', at: 1 }, null)).toBe(false);
    const t = orchestratorTally(Object.values(chats), NOW);
    expect(sameTally(t, { ...t, counts: { ...t.counts } })).toBe(true);
    expect(sameTally(t, { ...t, startedUsd: t.startedUsd + 1 })).toBe(false);
  });
});
