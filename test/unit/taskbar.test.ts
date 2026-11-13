// The taskbar presence (src/main/taskbar.ts, ADR 0102): the badge bitmap (a red disc with the count, "9+" past nine,
// none for zero), what it counts, and that it never acts outside Windows, under SB_HIDDEN, nor ever flashes or focuses.
import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ nativeImage: { createFromBitmap: (b: Buffer, o: { width: number; height: number }) => ({ b, o }) } }));
import type { ChatSummary } from '../../src/shared/contract';
import { badgePixels, SIZE, startTaskbar, taskbarState } from '../../src/main/taskbar';

const chat = (state: string, p: Partial<ChatSummary> = {}) => ({ id: state, state, ...p }) as unknown as ChatSummary;
const at = (px: Buffer, x: number, y: number) => [...px.subarray((y * SIZE + x) * 4, (y * SIZE + x) * 4 + 4)];

describe('badgePixels', () => {
  it('none for nothing waiting', () => { expect(badgePixels(0)).toBeNull(); expect(badgePixels(-1)).toBeNull(); });
  it('a red disc, transparent corners, white ink in the middle', () => {
    const px = badgePixels(1)!;
    expect(px.length).toBe(SIZE * SIZE * 4);
    expect(at(px, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(at(px, 2, 8)).toEqual([0x4d, 0x48, 0xe5, 255]);
    const white = Array.from({ length: SIZE * SIZE }, (_, i) => at(px, i % SIZE, Math.floor(i / SIZE))).filter(p => p[0] === 255 && p[1] === 255 && p[2] === 255).length;
    expect(white).toBeGreaterThan(10);
  });
  it('past nine it says 9+ (and differs from 9)', () => {
    expect(badgePixels(12)!.equals(badgePixels(10)!)).toBe(true);
    expect(badgePixels(12)!.equals(badgePixels(9)!)).toBe(false);
  });
});

describe('taskbarState / startTaskbar', () => {
  it('works while a chat runs or starts; a closed one does not count', () => {
    expect(taskbarState([chat('idle'), chat('running', { closedAt: 1 })], 2)).toEqual({ count: 2, working: false });
    expect(taskbarState([chat('starting')], 0)).toEqual({ count: 0, working: true });
  });
  it('sets the overlay and the indeterminate bar on Windows, only when it changes; never flashes nor focuses', () => {
    const w = { isDestroyed: () => false, setOverlayIcon: vi.fn(), setProgressBar: vi.fn(), flashFrame: vi.fn(), focus: vi.fn() };
    let waiting = 3;
    const stop = startTaskbar({ window: () => w as never, chats: () => [chat('running')], waiting: () => waiting, platform: 'win32', env: {}, everyMs: 60_000 });
    expect(w.setOverlayIcon).toHaveBeenCalledTimes(1);
    expect(w.setOverlayIcon.mock.calls[0]![1]).toBe('3 cose ti aspettano');
    expect(w.setProgressBar).toHaveBeenCalledWith(2, { mode: 'indeterminate' });
    expect(w.flashFrame).not.toHaveBeenCalled();
    expect(w.focus).not.toHaveBeenCalled();
    stop(); waiting = 0;
  });
  it('a no-op outside Windows and under SB_HIDDEN', () => {
    const w = { isDestroyed: () => false, setOverlayIcon: vi.fn(), setProgressBar: vi.fn() };
    startTaskbar({ window: () => w as never, chats: () => [], waiting: () => 1, platform: 'linux', env: {} })();
    startTaskbar({ window: () => w as never, chats: () => [], waiting: () => 1, platform: 'win32', env: { SB_HIDDEN: '1' } })();
    expect(w.setOverlayIcon).not.toHaveBeenCalled();
  });
});
