// Persistent column geometry and coordinator selection must agree across UI and native overlays.
import { describe, expect, it } from 'vitest';
import { COLUMN_SHARE, PAGE_MIN, columnSize } from '../../src/renderer/lib/orchestrator-dock';
import { orchestratorIdOf } from '../../src/renderer/lib/orchestrator-route';
import type { ChatSummary } from '../../src/shared/contract';

describe('persistent coordinator column', () => {
  it('takes about half the window by default, on every page, and fills the height below all banners (ADR 0307)', () => {
    for (const W of [1366, 1600, 1920, 2560]) {
      const size = columnSize(null, { W, H: 1000, top: 100, left: 196 });
      expect(size).toEqual({ w: Math.round(W * COLUMN_SHARE), h: 900 });
    }
    expect(COLUMN_SHARE).toBe(.5);
  });
  it('keeps the width the user dragged it to', () => {
    expect(columnSize({ w: 520, h: 0 }, { W: 1920, H: 1000, top: 52, left: 196 }).w).toBe(520);
    expect(columnSize({ w: 100, h: 0 }, { W: 1920, H: 1000, top: 52, left: 196 }).w).toBe(280);
  });
  it('keeps workspace room after resizing or opening a smaller window', () => {
    const size = columnSize({ w: 2000, h: 400 }, { W: 1000, H: 640, top: 80, left: 196 });
    expect(size).toEqual({ w: 444, h: 560 });
    expect(1000 - 196 - size.w).toBeGreaterThanOrEqual(PAGE_MIN);
    // a small window by default too: the page keeps its least room before the column gets its half
    expect(columnSize(null, { W: 900, H: 640, top: 80, left: 196 }).w).toBe(900 - 196 - PAGE_MIN);
  });
  it('the column shows the Orchestrator only: open and marked by main', () => {
    const chats = Object.fromEntries([
      { id: 'closed', isOrchestrator: true, closedAt: 1 },
      { id: 'app', isOrchestrator: false },
      { id: 'orch', isOrchestrator: true },
    ].map(chat => [chat.id, chat as ChatSummary]));
    expect(orchestratorIdOf({ order: ['closed', 'app', 'orch'], chats })).toBe('orch');
    expect(orchestratorIdOf({ order: ['closed', 'app'], chats })).toBeNull();
    expect(orchestratorIdOf({ order: ['closed'], chats })).toBeNull();
  });
});
