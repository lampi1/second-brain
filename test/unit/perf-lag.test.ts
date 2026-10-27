// Unit tests of the "Lag nell'app" fixes (2026-10-12): the typing probe's summary (renderer/lib/inputlag.ts) and its
// log line (main/perf.ts: clamped numbers, a warning above 100 ms p95), and the alive-marks heartbeat
// (renderer/lib/beat.ts: steps only while a mark is on the page, attributes in turn).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanReport, logInputLag, SLOW_P95_MS, SLOW_STEP_MS, STALL_MS, slowStep, stallOf, startStallWatch } from '../../src/main/perf';
import { log } from '../../src/main/log';

const invoke = vi.fn(() => Promise.resolve());
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: (...a: unknown[]) => invoke(...(a as [])), on: () => () => {} } }));
const { summarize } = await import('../../src/renderer/lib/inputlag');

describe('typing probe', () => {
  it('summarizes p50 / p95 / max of the keys', () => {
    const r = summarize(Array.from({ length: 100 }, (_, i) => i + 1), 12.4, 60);
    expect(r).toEqual({ keys: 100, p50: 51, p95: 96, max: 100, longTaskMs: 12, windowSec: 60 });
    expect(summarize([], 0, 60)).toMatchObject({ keys: 0, p50: 0, p95: 0, max: 0 });
  });

  it('keeps only sane numbers from the page', () => {
    expect(cleanReport({ keys: 3, p50: -5, p95: Infinity, max: 'x', longTaskMs: 1e12, windowSec: 60, extra: 'secret' }))
      .toEqual({ keys: 3, p50: 0, p95: 0, max: 0, longTaskMs: 3_600_000, windowSec: 60 });
    expect(cleanReport(null).keys).toBe(0);
  });

  it('logs a warning with cause and hint when typing is slow, info otherwise, nothing without keys', () => {
    const n = log.recent.length;
    logInputLag({ keys: 0, p50: 500, p95: 900, max: 900, longTaskMs: 0, windowSec: 60 });
    expect(log.recent.length).toBe(n);
    logInputLag({ keys: 40, p50: 10, p95: 20, max: 30, longTaskMs: 0, windowSec: 60 });
    expect(log.recent.at(-1)).toMatchObject({ lvl: 'info', scope: 'perf', msg: 'input lag', data: { keys: 40, p95: 20 } });
    logInputLag({ keys: 40, p50: 60, p95: SLOW_P95_MS + 1, max: 300, longTaskMs: 900, windowSec: 60 });
    const w = log.recent.at(-1)!;
    expect(w).toMatchObject({ lvl: 'warn', scope: 'perf' });
    expect(w.cause).toMatch(/101 ms/);
    expect(w.hint).toBeTruthy();
  });
});

describe('typing probe pairing', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("pairs a key only with its own box's input within a second (a later click is no sample)", async () => {
    vi.useFakeTimers();
    class Box {}
    vi.stubGlobal('HTMLTextAreaElement', Box);
    vi.stubGlobal('HTMLInputElement', class {});
    vi.stubGlobal('requestAnimationFrame', (f: () => void) => setTimeout(f, 0));
    const on = new Map<string, (e: unknown) => void>();
    vi.stubGlobal('document', { addEventListener: (t: string, f: (e: unknown) => void) => { on.set(t, f); } });
    const { startInputLag } = await import('../../src/renderer/lib/inputlag');
    startInputLag();
    const box = new Box(), check = {};
    const key = (target: unknown) => on.get('keydown')!({ target, timeStamp: performance.now() });
    const input = (target: unknown) => on.get('input')!({ target });
    key(box); vi.advanceTimersByTime(20); input(box); vi.advanceTimersByTime(5);  // a letter: one sample
    key(box); vi.advanceTimersByTime(4000); input(check); vi.advanceTimersByTime(5); // Tab, then a checkbox click
    key(box); vi.advanceTimersByTime(1500); input(box); vi.advanceTimersByTime(5);   // too late to be this key
    invoke.mockClear();
    vi.advanceTimersByTime(60_000);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]).toMatchObject(['app:inputLag', { keys: 1 }]);
  });
});

describe('alive-marks heartbeat', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  const fakeDom = (alive: () => boolean) => {
    const attrs = new Map<string, string>();
    const doc = {
      hidden: false,
      documentElement: { getAttribute: (k: string) => attrs.get(k) ?? null, setAttribute: (k: string, v: string) => { attrs.set(k, v); }, removeAttribute: (k: string) => { attrs.delete(k); } },
      querySelector: () => (alive() ? {} : null),
      addEventListener: () => {},
    };
    vi.stubGlobal('document', doc);
    return attrs;
  };

  it('does nothing while no alive mark is on the page', async () => {
    const attrs = fakeDom(() => false);
    const { step } = await import('../../src/renderer/lib/beat');
    step(); step();
    expect(attrs.size).toBe(0);
  });

  it('steps dots, spinner and blink in turn while a mark is there', async () => {
    const attrs = fakeDom(() => true);
    const { step } = await import('../../src/renderer/lib/beat');
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) { step(); seen.push(`${attrs.get('data-b3')}${attrs.get('data-b4')}${attrs.get('data-blink')}`); }
    expect(seen).toEqual(['111', '220', '031', '100']);
  });
});

describe('main-process stall watch (2026-10-27: "va a scatti")', () => {
  it('a tick late by STALL_MS is a stall, named by its slowest steps', () => {
    expect(stallOf(STALL_MS - 1, [])).toBeNull();
    expect(stallOf(320, [{ label: 'chats.json write', ms: 60 }, { label: 'agent-runs.json write', ms: 240 }])).toEqual({ ms: 320, steps: [{ label: 'agent-runs.json write', ms: 240 }, { label: 'chats.json write', ms: 60 }] });
  });
  it('logs one perf warning with the slow step it saw, then at most one a minute', () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    let t = 0;
    const stop = startStallWatch(() => t);
    t += 100; vi.advanceTimersByTime(100);
    expect(warn).not.toHaveBeenCalled();
    slowStep('fast', SLOW_STEP_MS - 1); slowStep('agent-runs.json write', 250);
    t += 400; vi.advanceTimersByTime(100);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![2]?.cause)).toContain('agent-runs.json write 250 ms');
    expect(String(warn.mock.calls[0]![2]?.cause)).not.toContain('fast');
    t += 500; vi.advanceTimersByTime(100);
    expect(warn).toHaveBeenCalledTimes(1);
    stop(); warn.mockRestore(); vi.useRealTimers();
  });
});
