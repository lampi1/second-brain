// Unit tests of the "Lag nell'app" fixes (2026-10-12): the typing probe's summary (renderer/lib/inputlag.ts) and its
// log line (main/perf.ts: clamped numbers, a warning above 100 ms p95), and the alive-marks heartbeat
// (renderer/lib/beat.ts: steps only while a mark is on the page, on the marks themselves, all together).
// Also the app health line (startHealthLog, 2026-10-29): what grows over a day, logged every 10 minutes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanReport, HEALTH_EVERY_MS, logInputLag, SLOW_P95_MS, SLOW_STEP_MS, STALL_MS, slowStep, stallCause, stallOf, startHealthLog, startStallWatch, timedStep } from '../../src/main/perf';
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

  it('logs slow typing and also reports idle renderer activity', () => {
    const n = log.recent.length;
    logInputLag({ keys: 0, p50: 500, p95: 900, max: 900, longTaskMs: 0, windowSec: 60 });
    expect(log.recent.length).toBe(n + 1);
    expect(log.recent.at(-1)).toMatchObject({ msg: 'renderer activity', data: { keys: 0 } });
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

  const el = () => { const attrs = new Map<string, string>(); return { attrs, getAttribute: (k: string) => attrs.get(k) ?? null, setAttribute: (k: string, v: string) => { attrs.set(k, v); }, removeAttribute: (k: string) => { attrs.delete(k); } }; };
  /** marks: class list → the elements that carry it (live: the test may add some later) */
  const fakeDom = (marks: Record<string, ReturnType<typeof el>[]>) => {
    const root = el();
    const doc = { hidden: false, documentElement: root, getElementsByClassName: (c: string) => (marks[c] ??= []), addEventListener: () => {} };
    vi.stubGlobal('document', doc);
    return root;
  };

  it('does nothing while no alive mark is on the page', async () => {
    const root = fakeDom({});
    const { step } = await import('../../src/renderer/lib/beat');
    step(); step();
    expect(root.attrs.size).toBe(0);
  });

  it('blinks every mark together, on the marks themselves, never on the root', async () => {
    const dot = el(), caret = el(), live = el();
    const marks = { 'pill-dot': [dot], 'md streaming': [caret], 'bx-live-dot run': [live] };
    const root = fakeDom(marks);
    const { step } = await import('../../src/renderer/lib/beat');
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) { step(); seen.push(`${dot.attrs.get('data-blink')}${caret.attrs.get('data-blink')}${live.attrs.get('data-blink')}`); }
    expect(seen).toEqual(['111', '000', '111', '000']);
    expect(root.attrs.size).toBe(0); // nothing on <html>: no whole-document restyle
    const late = el(); marks['pill-dot'].push(late); // a mark that appears takes the beat at the next step
    step();
    expect(late.attrs.get('data-blink')).toBe(dot.attrs.get('data-blink'));
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
  it('names many small steps of one label by their sum, counts nested steps once, and lists the minute\'s labels', () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    let t = 0;
    const stop = startStallWatch(() => t);
    // 30 stdout chunks of 2 ms each: none is slow alone, together they are the stall's suspect
    for (let i = 0; i < 30; i++) slowStep('engine claude output', 2);
    // a timed step with a labelled step inside: the outer time counts once in labeledMs
    timedStep('timer wiring/auto-close', () => slowStep('chats.json write', 5));
    t += 400; vi.advanceTimersByTime(100);
    const first = warn.mock.calls[0]![2]?.data as { steps: { label: string; ms: number; n?: number }[]; labeledMs: number };
    expect(first.steps[0]).toEqual({ label: 'engine claude output', ms: 60, n: 30 });
    expect(first.labeledMs).toBeLessThan(70); // 60 + the timed step's own few ms, the nested 5 not added again
    // the next stalls in the same minute are counted with their labels, then shown on the next log line
    slowStep('ipc flows:list', 300);
    t += 500; vi.advanceTimersByTime(100);
    t += 61_000; vi.advanceTimersByTime(100);
    expect(warn).toHaveBeenCalledTimes(2);
    const second = warn.mock.calls[1]![2]?.data as { sinceLast: number; topSinceLast: { label: string }[] };
    expect(second.sinceLast).toBe(1);
    expect(second.topSinceLast[0]!.label).toBe('ipc flows:list');
    stop(); warn.mockRestore(); vi.useRealTimers();
  });
  it('a stall with little CPU for the app says it waited for a busy PC, with the PC\'s load', () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    let t = 0, cpu = 0, busy = 0, total = 0;
    const stop = startStallWatch(() => t, () => ({ user: cpu, system: 0 }), () => ({ busy, total }));
    // 2 s late, the main process got 40 ms of CPU, the PC was 95% busy
    t += 2100; cpu += 40_000; busy += 9500; total += 10_000; vi.advanceTimersByTime(100);
    const call = warn.mock.calls[0]![2]!;
    expect(call.data).toMatchObject({ ms: 2000, cpuMs: 40, machineCpu: 95 });
    expect(String(call.cause)).toContain('CPU scheduling, a lock or synchronous I/O');
    stop(); warn.mockRestore(); vi.useRealTimers();
  });
  it('a stall the app spent on the CPU is not blamed on the PC', () => {
    expect(stallCause({ ms: 1000, steps: [], cpuMs: 900 })).toContain('no labelled step ran');
    expect(stallCause({ ms: 1000, steps: [{ label: 'x', ms: 800 }], cpuMs: 10 })).toContain('while x 800 ms');
  });
});


describe('app health line', () => {
  it('logs the heap and what it is given every 10 minutes, and survives a reader that throws', () => {
    vi.useFakeTimers();
    const info = vi.spyOn(log, 'info').mockImplementation(() => {});
    let fail = false;
    const stop = startHealthLog(() => { if (fail) throw new Error('gone'); return { chatsOpen: 3, connectorProcs: 2 }; });
    vi.advanceTimersByTime(HEALTH_EVERY_MS - 1);
    expect(info).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(info).toHaveBeenCalledWith('perf', 'app health', expect.objectContaining({ data: expect.objectContaining({ chatsOpen: 3, connectorProcs: 2, heapMb: expect.any(Number), rssMb: expect.any(Number) }) }));
    fail = true;
    expect(() => vi.advanceTimersByTime(HEALTH_EVERY_MS)).not.toThrow();
    expect(info).toHaveBeenCalledTimes(1);
    stop(); info.mockRestore(); vi.useRealTimers();
  });
});
