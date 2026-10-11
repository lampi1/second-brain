// The UI clock: Date.now(), or a fixed instant when the demo runs frozen (SB_DEMO_FREEZE=1 sends ui:command
// 'clock'), so relative times ("4 min") are identical in every screenshot. `useNow` re-renders a component on a
// coarse tick (relative labels) without each tile running its own timer. Used by tiles, the lane and the top bar.
import { useSyncExternalStore } from 'react';

let frozen: number | null = null;
let current = Date.now();
const listeners = new Set<() => void>();

export const now = (): number => frozen ?? Date.now();
export const isFrozen = (): boolean => frozen !== null;

function tick(): void {
  const n = now();
  if (n === current) return;
  current = n;
  for (const l of [...listeners]) l();
}

/** Freeze the clock at `ms` (demo screenshots). */
export function freezeClock(ms: number): void {
  if (!Number.isFinite(ms)) return;
  frozen = ms;
  document.documentElement.dataset.clock = 'frozen';
  tick();
}

let timer: ReturnType<typeof setInterval> | null = null;
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  if (!timer) timer = setInterval(tick, 1000);
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && timer) { clearInterval(timer); timer = null; }
  };
}

/** The current time, refreshed every `granularityMs` (rounded down, so components re-render only on change). */
export function useNow(granularityMs = 15_000): number {
  return useSyncExternalStore(subscribe, () => Math.floor(current / granularityMs) * granularityMs + (frozen !== null ? frozen % granularityMs : 0));
}
