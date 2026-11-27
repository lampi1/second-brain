// The GitHub check that runs by itself (src/main/update/source.ts scheduleChecks, ADR 0366): the top bar's version chip
// gets its count a minute after the start and every half hour, without the Settings card being opened; the stop ends it.
// Fake timers only: no real wait, no process, no git.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduleChecks } from '../../src/main/update/source';

afterEach(() => { vi.useRealTimers(); });

describe('scheduleChecks', () => {
  it('runs once after the first delay, then at every interval', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    scheduleChecks(run, 60_000, 1_800_000);
    vi.advanceTimersByTime(59_999);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_800_000 * 2);
    expect(run).toHaveBeenCalledTimes(3);
  });
  it('the stop ends it, before and after the first run', () => {
    vi.useFakeTimers();
    const early = vi.fn(), late = vi.fn();
    scheduleChecks(early, 1000, 5000)();
    const stop = scheduleChecks(late, 1000, 5000);
    vi.advanceTimersByTime(1000);
    stop();
    vi.advanceTimersByTime(20_000);
    expect(early).not.toHaveBeenCalled();
    expect(late).toHaveBeenCalledTimes(1);
  });
});
