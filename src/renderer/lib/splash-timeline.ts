// The opening splash's single clock: every visual reads the same elapsed time, including the exit. Used by
// Splash.tsx; a timer also releases the app when a hidden/busy window stops delivering animation frames.
import type { SplashMode } from './splash';

export const SPLASH_TIMING = {
  opening: 600, markEnd: 1600, wordStart: 1450, wordEnd: 2700,
  lineStart: 2400, lineEnd: 3100, exit: 5200, end: 6000,
  reducedHold: 2200, reducedFade: 180, skipFade: 240,
} as const;
export const SPLASH_MS = SPLASH_TIMING.end;
export type SplashPhase = 'opening' | 'run' | 'hot' | 'out';
export interface SplashFrame {
  elapsed: number; phase: SplashPhase; opacity: number; mark: number; word: number; line: number;
}

/** Smooth acceleration and braking, with zero velocity at both ends. */
export function splashEase(time: number, from: number, to: number): number {
  const p = Math.max(0, Math.min(1, (time - from) / (to - from)));
  return p * p * p * (p * (p * 6 - 15) + 10);
}

export function splashFrame(elapsed: number, reduced = false, hold = false): SplashFrame {
  const t = SPLASH_TIMING;
  const exit = reduced ? t.reducedHold : t.exit;
  const end = reduced ? t.reducedHold + t.reducedFade : t.end;
  return {
    elapsed,
    phase: !hold && elapsed >= exit ? 'out' : reduced || elapsed >= t.lineEnd ? 'hot' : elapsed < t.opening ? 'opening' : 'run',
    opacity: hold ? 1 : 1 - splashEase(elapsed, exit, end),
    mark: reduced ? 1 : splashEase(elapsed, t.opening, t.markEnd),
    word: reduced ? 1 : splashEase(elapsed, t.wordStart, t.wordEnd),
    line: reduced ? 1 : splashEase(elapsed, t.lineStart, t.lineEnd),
  };
}

export interface SplashClock {
  now(): number;
  request(callback: () => void): number;
  cancel(id: number): void;
  later(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clear(id: ReturnType<typeof setTimeout>): void;
}

const browserClock: SplashClock = {
  now: () => performance.now(), request: fn => requestAnimationFrame(fn), cancel: id => cancelAnimationFrame(id),
  later: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id),
};

/** Exactly one completion; skip freezes the reveal and fades that frame, dispose cancels without completing. */
export function startSplashTimeline(options: {
  mode: SplashMode; reduced: boolean; draw(frame: SplashFrame): void; done(): void;
}, clock: SplashClock = browserClock): { skip(): void; dispose(): void } {
  const start = clock.now();
  const duration = options.reduced ? SPLASH_TIMING.reducedHold + SPLASH_TIMING.reducedFade : SPLASH_MS;
  let disposed = false, raf: number | null = null, timer: ReturnType<typeof setTimeout> | null = null;
  let skipped: { at: number; frame: SplashFrame } | null = null;
  const cancel = () => {
    if (raf !== null) clock.cancel(raf);
    if (timer !== null) clock.clear(timer);
    raf = null; timer = null;
  };
  const complete = () => {
    if (disposed) return;
    disposed = true; cancel(); options.done();
  };
  const draw = () => {
    if (disposed) return;
    raf = null;
    const elapsed = clock.now() - start;
    const fade = options.reduced ? SPLASH_TIMING.reducedFade : SPLASH_TIMING.skipFade;
    const frame = skipped
      ? { ...skipped.frame, phase: 'out' as const, opacity: skipped.frame.opacity * (1 - splashEase(elapsed, skipped.at, skipped.at + fade)) }
      : splashFrame(elapsed, options.reduced, options.mode === 'hold');
    options.draw(frame);
    if (skipped ? elapsed >= skipped.at + fade : options.mode !== 'hold' && elapsed >= duration) { complete(); return; }
    // The held screenshot needs no idle animation loop. Reduced motion only changes opacity at the exit.
    if (skipped || options.mode !== 'hold' || !options.reduced && elapsed < SPLASH_TIMING.lineEnd) raf = clock.request(draw);
  };
  if (options.mode !== 'hold') timer = clock.later(complete, duration);
  draw();
  return {
    skip() {
      if (disposed || skipped) return;
      const elapsed = clock.now() - start;
      skipped = { at: elapsed, frame: splashFrame(elapsed, options.reduced, options.mode === 'hold') };
      cancel();
      timer = clock.later(complete, options.reduced ? SPLASH_TIMING.reducedFade : SPLASH_TIMING.skipFade);
      draw();
    },
    dispose() { disposed = true; cancel(); },
  };
}
