// Typing probe of the app page: for each key typed in a text box, the time from the keydown to the first frame after
// its input event (the letter on screen, the same measure as scripts/bench-perf.mjs), plus the long tasks of the
// window. Once a minute, only if the user typed, the summary goes to main ('app:inputLag' → the `perf` log, a warning
// above 100 ms p95). Why: "Lag nell'app" (owner, 2026-10-12) had no number from real use. Started by main.tsx.
import type { InputLagReport } from '@shared/contract';
import { sb } from '../sb';

const WINDOW_MS = 60_000;
const PAIR_MS = 1000; // a key's own input event comes in the same task: 1 s covers a frozen page, not a later click

/** p50 / p95 / max of the samples (ms, rounded); zeros when empty. */
export function summarize(samples: readonly number[], longTaskMs: number, windowSec: number): InputLagReport {
  const s = [...samples].sort((a, b) => a - b);
  const q = (p: number) => (s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0) : 0);
  return { keys: s.length, p50: q(0.5), p95: q(0.95), max: Math.round(s.at(-1) ?? 0), longTaskMs: Math.round(longTaskMs), windowSec };
}

let started = false;
export function startInputLag(): void {
  if (started) return;
  started = true;
  let samples: number[] = [];
  let long = 0;
  let since = performance.now();
  try {
    new PerformanceObserver(l => { for (const e of l.getEntries()) long += e.duration; }).observe({ type: 'longtask', buffered: false });
  } catch { /* no long task timing: keys only */ }
  // the last keydown in a text box; only an input event of that same box within PAIR_MS closes it (a key that wrote
  // nothing, like Enter or Tab, then a click on a checkbox seconds later, must not read as a 4 s key), and the next
  // keydown replaces it, so a key never pairs with a later key's input
  let key: { ts: number; el: EventTarget } | null = null;
  document.addEventListener('keydown', e => {
    const t = e.target;
    key = t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement ? { ts: e.timeStamp, el: t } : null;
  }, true);
  document.addEventListener('input', e => {
    const k = key;
    key = null;
    if (!k || e.target !== k.el || performance.now() - k.ts > PAIR_MS) return;
    requestAnimationFrame(() => setTimeout(() => samples.push(performance.now() - k.ts), 0));
  }, true);
  setInterval(() => {
    const now = performance.now();
    if (samples.length) void sb.invoke('app:inputLag', summarize(samples, long, Math.round((now - since) / 1000))).catch(() => {});
    samples = [];
    long = 0;
    since = now;
  }, WINDOW_MS);
}
