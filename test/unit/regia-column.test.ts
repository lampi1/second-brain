// Persistent column geometry and coordinator selection must agree across UI and native overlays.
import { describe, expect, it } from 'vitest';
import { columnSize } from '../../src/renderer/lib/regia-dock';
import { orchestratorIdOf } from '../../src/renderer/lib/regia-route';
import type { ChatSummary } from '../../src/shared/contract';

describe('persistent coordinator column', () => {
  it('narrows on detail pages and fills the height below all banners', () => {
    const viewport = { W: 1600, H: 1000, top: 100, left: 196 };
    const home = columnSize(null, viewport, true), page = columnSize(null, viewport, false);
    expect(home.h).toBe(900);
    expect(page.h).toBe(home.h);
    expect(page.w).toBeLessThan(home.w);
  });
  it('keeps workspace room after resizing or opening a smaller window', () => {
    const size = columnSize({ w: 2000, h: 400 }, { W: 1000, H: 640, top: 80, left: 196 }, true);
    expect(size).toEqual({ w: 444, h: 560 });
    expect(1000 - 196 - size.w).toBeGreaterThanOrEqual(360);
  });
  it('the column shows the Orchestrator only: open, a Regia and marked by main', () => {
    const chats = Object.fromEntries([
      { id: 'closed', isRegia: true, orchestrator: true, closedAt: 1 },
      { id: 'app', appRegia: true },
      { id: 'work', isRegia: true },
      { id: 'orch', isRegia: true, orchestrator: true },
    ].map(chat => [chat.id, chat as ChatSummary]));
    expect(orchestratorIdOf({ order: ['closed', 'app', 'work', 'orch'], chats })).toBe('orch');
    expect(orchestratorIdOf({ order: ['closed', 'app', 'work'], chats })).toBeNull(); // a legacy Regia is not it
    expect(orchestratorIdOf({ order: ['closed'], chats })).toBeNull();
    expect(orchestratorIdOf({ order: ['x'], chats: { x: { id: 'x', isRegia: false, orchestrator: true } as ChatSummary } })).toBeNull();
  });
});
