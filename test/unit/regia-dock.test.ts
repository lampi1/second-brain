// The Regia widget docked bottom-right (ADR 0028): its default and clamped size, the room it takes from the workspace
// (src/renderer/lib/regia-dock.ts), the unread count, and how its state survives a restart (store/ui.ts loadPrefs).
import { describe, expect, it } from 'vitest';
import type { ChatItem } from '@shared/contract';
import { BAR_H, clampSize, DEFAULT_V, defaultSize, EDGE, MIN_H, MIN_W, MIN_WORK, reserveOf, seenAtCollapse, sizeIn, unreadOf } from '../../src/renderer/lib/regia-dock';
import { loadPrefs } from '../../src/renderer/store/ui';

describe('the widget size', () => {
  it('by default wide and low: 42% of the width (480-820 px), 42% of the height under the top bar (300-560 px)', () => {
    expect(defaultSize(1920, 1040, 52)).toEqual({ w: 806, h: 415 });
    expect(defaultSize(1366, 728, 52)).toEqual({ w: 574, h: 300 });
    expect(defaultSize(900, 500, 52)).toEqual({ w: 480, h: 300 });
    expect(defaultSize(2560, 1440, 52)).toEqual({ w: 820, h: 560 });
    // the chats keep their room at 1366 even with the sidebar open
    expect(sizeIn(null, 1366, 728, 52, 196).w).toBe(574);
  });

  it('a saved size stays usable: minimum size, under the top bar, the chats keep MIN_WORK px next to the sidebar', () => {
    expect(clampSize({ w: 500, h: 600 }, 1920, 1040, 52, 56)).toEqual({ w: 500, h: 600 });
    expect(clampSize({ w: 10, h: 10 }, 1920, 1040, 52, 56)).toEqual({ w: MIN_W, h: MIN_H });
    expect(clampSize({ w: 5000, h: 5000 }, 1366, 728, 52, 56)).toEqual({ w: 1366 - 56 - MIN_WORK - 3 * EDGE, h: 728 - 52 - 2 * EDGE });
    expect(sizeIn(null, 1920, 1040, 52, 56)).toEqual(defaultSize(1920, 1040, 52));
    expect(sizeIn({ w: 9999, h: 300 }, 1366, 728, 52, 196).w).toBe(1366 - 196 - MIN_WORK - 3 * EDGE); // expanded sidebar
  });

  it('takes a right column when expanded, a bottom strip when collapsed', () => {
    expect(reserveOf(true, { w: 440, h: 600 })).toEqual({ right: 440 + EDGE, bottom: 0 });
    expect(reserveOf(false, { w: 440, h: 600 })).toEqual({ right: 0, bottom: BAR_H + EDGE });
  });
});

describe('unread replies', () => {
  const items: ChatItem[] = [
    { kind: 'assistant', id: 'a1', at: 100, text: 'vecchia' },
    { kind: 'user', id: 'u1', at: 200, text: 'tu' },
    { kind: 'assistant', id: 'a2', at: 300, text: 'nuova' },
    { kind: 'tool', id: 't1', at: 310, name: 'Bash', summary: '', input: {}, status: 'ok' },
    { kind: 'assistant', id: 'a3', at: 400, text: 'in corso', streaming: true },
  ];
  it('count finished assistant messages after the last look', () => {
    expect(unreadOf(items, 150)).toBe(1);
    expect(unreadOf(items, 0)).toBe(2);
    expect(unreadOf(items, 1000)).toBe(0);
    expect(unreadOf(undefined, 0)).toBe(0);
  });
  it('a reply still streaming when the panel collapses counts once it ends', () => {
    const seen = seenAtCollapse([items, undefined], 450); // collapsed at 450, a3 started at 400 and still streams
    expect(seen).toBe(399);
    const done = items.map(it => (it.id === 'a3' ? { ...it, streaming: false } : it));
    expect(unreadOf(done, seen)).toBe(1);
    expect(seenAtCollapse([items.filter(it => it.id !== 'a3')], 450)).toBe(450); // nothing streaming: up to now
  });
});

describe('the widget state across restarts', () => {
  it('remembers expanded, size, tab and seen-at; a first start is collapsed, default size, seen now', () => {
    const first = loadPrefs(null, 5000);
    expect(first).toMatchObject({ regiaOpen: false, regiaSize: null, regiaTab: null, regiaSeenAt: 5000 });
    const saved = loadPrefs(JSON.stringify({ regiaOpen: true, regiaSize: { w: 500, h: 420 }, regiaSizeV: DEFAULT_V, regiaTab: 'r2', regiaSeenAt: 1234 }), 5000);
    expect(saved).toMatchObject({ regiaOpen: true, regiaSize: { w: 500, h: 420 }, regiaTab: 'r2', regiaSeenAt: 1234 });
  });

  it('a size saved under the old default (narrow and tall) goes back to the new default once', () => {
    const old = loadPrefs(JSON.stringify({ regiaOpen: true, regiaSize: { w: 440, h: 650 } }), 0);
    expect(old).toMatchObject({ regiaOpen: true, regiaSize: null, regiaSizeV: DEFAULT_V });
    // saved again with the version: kept from now on
    expect(loadPrefs(JSON.stringify({ ...old, regiaSize: { w: 600, h: 380 } }), 0).regiaSize).toEqual({ w: 600, h: 380 });
  });

  it('drops what is broken or from before the widget (the floating panel place)', () => {
    const p = loadPrefs(JSON.stringify({ regiaOpen: 'yes', regiaSize: { w: 'x', h: 3 }, regiaSeenAt: 'ieri', regiaRect: { x: 1, y: 2, w: 3, h: 4 } }), 77);
    expect(p).toMatchObject({ regiaOpen: false, regiaSize: null, regiaSeenAt: 77 });
    expect('regiaRect' in p).toBe(false);
    expect(loadPrefs(JSON.stringify({ regiaSize: { w: -5, h: 300 } }), 0).regiaSize).toBeNull();
  });
});
