// The typing probe's log line: the app page sends, once a minute while the user types, how long keys took to show
// (renderer/lib/inputlag.ts); here it becomes one `perf` log entry, a warning when typing felt slow. Why: "Lag
// nell'app" (owner, 2026-10-12) was measurable only in the bench; now `npm run logs -- --scope perf` shows it from
// real use. The values come from the renderer: only finite numbers in a sane range are kept. Used by index.ts.
// The main-process stall watch (startStallWatch, 2026-10-27, owner: "a volte va a scatti … si freeza senza loader"): the
// main process's JS runs on the browser UI thread, which routes input to the page and presents its frames, so a long
// synchronous step there (a big JSON write, a sync rename retry) freezes the whole window with no spinner. It logs
// each stall with the slow steps noted during it (slowStep), so `npm run logs -- --scope perf` names the cause.
import type { InputLagReport } from '../shared/contract';
import { log } from './log';

/** p95 above this (ms) is a lag the user feels while typing. */
export const SLOW_P95_MS = 100;

const num = (v: unknown, max: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, Math.round(v))) : 0);

/** The report as logged: numbers only, clamped (a broken or hostile page cannot write anything else). */
export function cleanReport(a: unknown): InputLagReport {
  const r = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
  return { keys: num(r.keys, 100_000), p50: num(r.p50, 60_000), p95: num(r.p95, 60_000), max: num(r.max, 60_000), longTaskMs: num(r.longTaskMs, 3_600_000), windowSec: num(r.windowSec, 3600) };
}

export function logInputLag(a: unknown): void {
  const r = cleanReport(a);
  if (!r.keys) return;
  if (r.p95 > SLOW_P95_MS) {
    log.warn('perf', 'input lag', {
      data: r, cause: `keys took up to ${r.p95} ms (p95) to show while typing`,
      hint: 'see what ran meanwhile: chats streaming, builds/e2e on the PC (machine CPU); bench: node scripts/bench-perf.mjs',
    });
  } else log.info('perf', 'input lag', { data: r });
}

/** a main-process step this long (ms) is noted as a suspect for the next stall */
export const SLOW_STEP_MS = 50;
/** the main thread late by this much (ms) is a freeze the user sees */
export const STALL_MS = 200;
const TICK_MS = 100;
let steps: { label: string; ms: number }[] = [];

/** A synchronous main-process step that took `ms`: kept (the slowest few) for the stall it may have caused. */
export function slowStep(label: string, ms: number): void {
  if (ms < SLOW_STEP_MS) return;
  steps.push({ label, ms: Math.round(ms) });
  if (steps.length > 20) steps = steps.sort((a, b) => b.ms - a.ms).slice(0, 10);
}
/** Times fn as one main-process step (slowStep). */
export function timedStep<T>(label: string, fn: () => T): T {
  const t = performance.now();
  try { return fn(); } finally { slowStep(label, performance.now() - t); }
}

/** What one tick saw: a stall (late by at least STALL_MS) with its suspects, or null. Pure, for the tests. */
export function stallOf(lateMs: number, noted: readonly { label: string; ms: number }[]): { ms: number; steps: { label: string; ms: number }[] } | null {
  if (lateMs < STALL_MS) return null;
  return { ms: Math.round(lateMs), steps: [...noted].sort((a, b) => b.ms - a.ms).slice(0, 5) };
}

/** Watches the main thread: a tick late by STALL_MS or more logs a `perf` warning (at most one a minute, the rest counted). */
export function startStallWatch(now: () => number = () => performance.now()): () => void {
  let last = now(), lastLog = -Infinity, missed = 0, worst = 0;
  const timer = setInterval(() => {
    const t = now(), late = t - last - TICK_MS;
    last = t;
    const stall = stallOf(late, steps);
    steps = [];
    if (!stall) return;
    if (t - lastLog < 60_000) { missed++; worst = Math.max(worst, stall.ms); return; }
    log.warn('perf', 'main process blocked', { data: { ...stall, ...(missed ? { sinceLast: missed, worstSinceLast: worst } : {}) },
      cause: stall.steps.length ? `the window froze ${stall.ms} ms while ${stall.steps.map(s => `${s.label} ${s.ms} ms`).join(', ')}` : `the window froze ${stall.ms} ms (no slow step noted: GC, a native call or the PC itself)`,
      hint: 'a synchronous step on the main process blocks input and frames; see the steps named here' });
    lastLog = t; missed = 0; worst = 0;
  }, TICK_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
