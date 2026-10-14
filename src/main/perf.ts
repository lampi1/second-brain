// The typing probe's log line: the app page sends, once a minute while the user types, how long keys took to show
// (renderer/lib/inputlag.ts); here it becomes one `perf` log entry, a warning when typing felt slow. Why: "Lag
// nell'app" (owner, 2026-10-12) was measurable only in the bench; now `npm run logs -- --scope perf` shows it from
// real use. The values come from the renderer: only finite numbers in a sane range are kept. Used by index.ts.
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
