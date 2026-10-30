// The opening splash's decisions (components/Splash.tsx), pure apart from reading the page URL and sessionStorage.
// Whether it shows: main asks it in the page's query only when a person opens the app (main/window.ts splashQuery:
// never in a hidden run, a test or the frozen demo) and it shows once per window (a renderer reloaded after a crash
// does not replay it). Its sentence: one of the splash's own lines, a different one each day (the model-written
// headline went with the Battito, ADR 0201). Unit-tested in test/unit/splash.test.ts.

export type SplashMode = 'on' | 'hold';
export const SPLASH_LINES = 12;
const DAY = 86_400_000;

/** 'on', 'hold' (stays on its last frame until a click or a key: the e2e screenshot) or null; consumes the once-per-window mark. */
export function splashMode(search: string, store: Pick<Storage, 'getItem' | 'setItem'> | null): SplashMode | null {
  const v = new URLSearchParams(search).get('splash');
  if (v !== '1' && v !== 'hold') return null;
  try {
    if (store?.getItem('sb.splash.shown')) return null;
    store?.setItem('sb.splash.shown', '1');
  } catch { /* storage off: show it */ }
  return v === 'hold' ? 'hold' : 'on';
}

/** The splash's own line of the day (an index into splash.line.N): the local calendar day, so it changes at midnight. */
export function dayLine(now: number, tzOffsetMin = new Date(now).getTimezoneOffset()): number {
  const day = Math.floor((now - tzOffsetMin * 60_000) / DAY);
  return ((day % SPLASH_LINES) + SPLASH_LINES) % SPLASH_LINES;
}

