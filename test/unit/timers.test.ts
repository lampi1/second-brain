// Timer diagnostics must reflect native lifecycle, not just a list of configured intervals.
import { afterEach, expect, it, vi } from 'vitest';
import { timerSnapshot, timersFor } from '../../src/main/timers';
const owner = timersFor('test');
const handles: NodeJS.Timeout[] = [];
afterEach(() => { for (const handle of handles.splice(0)) owner.clearTimeout(handle); vi.useRealTimers(); });
it('reports intervals, ticks, cancellation and isolated snapshots', () => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  const callback = vi.fn();
  const timer = owner.setInterval(callback, 5000); handles.push(timer);
  timer.unref();
  const snapshot = timerSnapshot();
  expect(snapshot).toHaveLength(1);
  expect(snapshot[0]).toMatchObject({ owner: 'test', kind: 'interval', delayMs: 5000, nextAt: 6000, runs: 0 });
  snapshot[0]!.runs = 99;
  vi.advanceTimersByTime(10_000);
  expect(callback).toHaveBeenCalledTimes(2);
  expect(timerSnapshot()[0]).toMatchObject({ runs: 2, lastRunAt: 11000, nextAt: 16000 });
  owner.clearInterval(timer);
  expect(timerSnapshot()).toEqual([]);
  vi.advanceTimersByTime(5000);
  expect(callback).toHaveBeenCalledTimes(2);
});
it('removes scheduled pollers when fired or cancelled and keeps duplicate owners distinct', () => {
  vi.useFakeTimers();
  const first = owner.setTimeout(() => {}, 100); handles.push(first);
  const second = owner.setTimeout(() => {}, 200); handles.push(second);
  expect(new Set(timerSnapshot().map(t => t.id)).size).toBe(2);
  vi.advanceTimersByTime(100);
  expect(timerSnapshot()).toHaveLength(1);
  owner.clearTimeout(second);
  expect(timerSnapshot()).toEqual([]);
});
