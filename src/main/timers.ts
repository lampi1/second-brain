// Live inventory of periodic timers and scheduled pollers for app_state and doctor (ADR 0056).
// Owners opt in explicitly; native handles/ref behavior stay unchanged. No global timer monkey-patching.
export interface TimerSnapshot {
  id: number; owner: string; kind: 'interval' | 'scheduled'; delayMs: number;
  startedAt: number; nextAt: number; lastRunAt: number | null; runs: number;
}
const active = new Map<NodeJS.Timeout, TimerSnapshot>();
let sequence = 0;

export function timerSnapshot(): TimerSnapshot[] {
  return [...active.values()].map(row => ({ ...row })).sort((a, b) => a.id - b.id);
}

/** Clear either native timer kind, including interval handles historically cleared with clearTimeout. */
function cancel(handle: NodeJS.Timeout | undefined | null): void {
  if (!handle) return;
  active.delete(handle);
  globalThis.clearTimeout(handle);
}

export function timersFor(owner: string): {
  setInterval: (callback: () => void, ms: number) => NodeJS.Timeout;
  setTimeout: (callback: () => void, ms: number) => NodeJS.Timeout;
  clearInterval: typeof cancel; clearTimeout: typeof cancel;
} {
  const start = (kind: TimerSnapshot['kind'], callback: () => void, ms: number): NodeJS.Timeout => {
    const delayMs = Number.isFinite(ms) && ms >= 1 && ms <= 2_147_483_647 ? Math.trunc(ms) : 1;
    const now = Date.now();
    const row: TimerSnapshot = { id: ++sequence, owner, kind, delayMs, startedAt: now, nextAt: now + delayMs, lastRunAt: null, runs: 0 };
    const run = () => {
      row.lastRunAt = Date.now(); row.runs++; row.nextAt = row.lastRunAt + delayMs;
      if (kind === 'scheduled') active.delete(handle);
      callback();
    };
    const handle = kind === 'interval' ? globalThis.setInterval(run, ms) : globalThis.setTimeout(run, ms);
    active.set(handle, row);
    return handle;
  };
  return { setInterval: (cb, ms) => start('interval', cb, ms), setTimeout: (cb, ms) => start('scheduled', cb, ms), clearInterval: cancel, clearTimeout: cancel };
}
