// The opening splash's pacing and lifecycle: one frame clock, a readable hold, bounded completion even without
// frames, and cancellable skip/unmount. Tests use a manual frame queue rather than timing the real machine.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SPLASH_MS, SPLASH_TIMING as T, splashFrame, startSplashTimeline, type SplashClock, type SplashFrame } from '../../src/renderer/lib/splash-timeline';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => vi.useRealTimers());

function setup(mode: 'on' | 'hold' = 'on', reduced = false) {
  const frames = new Map<number, () => void>();
  let id = 0;
  const draw = vi.fn<(frame: SplashFrame) => void>(), done = vi.fn();
  const clock: SplashClock = {
    now: Date.now, request: callback => { frames.set(++id, callback); return id; }, cancel: key => { frames.delete(key); },
    later: (callback, delay) => setTimeout(callback, delay), clear: timer => clearTimeout(timer),
  };
  const timeline = startSplashTimeline({ mode, reduced, draw, done }, clock);
  const step = (time: number, paint = true) => {
    vi.advanceTimersByTime(time - Date.now());
    if (paint) { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(); }
  };
  return { timeline, frames, draw, done, step, last: () => draw.mock.calls.at(-1)![0] };
}

describe('the splash pace', () => {
  it('opens on a quiet beat, reveals progressively, then leaves over two seconds to read', () => {
    expect(splashFrame(500)).toMatchObject({ phase: 'opening', mark: 0, word: 0, line: 0, opacity: 1 });
    expect(splashFrame(1100).mark).toBeGreaterThan(0);
    expect(splashFrame(1100).mark).toBeLessThan(1);
    expect(splashFrame(T.lineEnd)).toMatchObject({ phase: 'hot', mark: 1, word: 1, line: 1, opacity: 1 });
    expect(T.exit - T.lineEnd).toBeGreaterThanOrEqual(2000);
    expect(splashFrame(5600)).toMatchObject({ phase: 'out', opacity: 0.5 });
    expect(splashFrame(SPLASH_MS).opacity).toBe(0);
  });
  it('reduced motion has a still readable card and a brief opacity fade', () => {
    const s = setup('on', true);
    expect(s.last()).toMatchObject({ phase: 'hot', mark: 1, word: 1, line: 1 });
    s.step(T.reducedHold + T.reducedFade / 2);
    expect(s.last()).toMatchObject({ phase: 'out', opacity: 0.5 });
    s.step(T.reducedHold + T.reducedFade);
    expect(s.done).toHaveBeenCalledOnce();
  });
});

describe('the splash lifecycle', () => {
  it('finishes once at the deadline even if the window never paints another frame', () => {
    const s = setup();
    s.step(SPLASH_MS - 1, false);
    expect(s.done).not.toHaveBeenCalled();
    s.step(SPLASH_MS, false);
    expect(s.done).toHaveBeenCalledOnce();
    expect(s.frames.size).toBe(0);
    s.timeline.skip(); s.step(20_000);
    expect(s.done).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('skip freezes the current reveal, fades promptly and cannot schedule duplicate exits', () => {
    const s = setup();
    s.step(1800);
    const before = s.last();
    s.timeline.skip(); s.timeline.skip();
    s.step(1800 + T.skipFade / 2);
    expect(s.last()).toMatchObject({ phase: 'out', mark: before.mark, word: before.word, line: before.line, opacity: 0.5 });
    s.step(1800 + T.skipFade);
    expect(s.done).toHaveBeenCalledOnce();
    expect(s.frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('unmount cancels the normal or skipped completion and every frame', () => {
    for (const skip of [false, true]) {
      const s = setup();
      if (skip) s.timeline.skip();
      s.timeline.dispose(); s.timeline.dispose();
      vi.runAllTimers();
      expect(s.frames.size).toBe(0);
      expect(s.done).not.toHaveBeenCalled();
    }
  });
  it('hold settles with no background animation, and still responds to skip', () => {
    const s = setup('hold');
    s.step(T.lineEnd);
    expect(s.frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    s.step(30_000);
    expect(s.done).not.toHaveBeenCalled();
    s.timeline.skip(); s.step(30_000 + T.skipFade);
    expect(s.done).toHaveBeenCalledOnce();
  });
});
