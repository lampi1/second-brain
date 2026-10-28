// The typing probe's log line: the app page sends, once a minute while the user types, how long keys took to show
// (renderer/lib/inputlag.ts); here it becomes one `perf` log entry, a warning when typing felt slow. Why: "Lag
// nell'app" (owner, 2026-10-12) was measurable only in the bench; now `npm run logs -- --scope perf` shows it from
// real use. The values come from the renderer: only finite numbers in a sane range are kept. Used by index.ts.
// The main-process stall watch (startStallWatch, 2026-10-27, owner: "a volte va a scatti … si freeza senza loader"): the
// main process's JS runs on the browser UI thread, which routes input to the page and presents its frames, so a long
// synchronous step there (a big JSON write, a sync rename retry) freezes the whole window with no spinner. It logs
// each stall with the slow steps noted during it (slowStep), so `npm run logs -- --scope perf` names the cause.
// Each stall also says how much CPU the app's main process got while it was late (cpuMs, all its threads) and how busy
// the PC was (machineCpu %): a stall with little cpuMs was not the app's own work but the app waiting for the CPU
// (2026-10-27: 0.13% of 995 s of stalls was inside labelled steps; the PC sat at 80-100% with the agents' processes).
import os from 'node:os';
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
  if (!r.keys) { log.info('perf', 'renderer activity', { data: r }); return; }
  if (r.p95 > SLOW_P95_MS) {
    log.warn('perf', 'input lag', {
      data: r, cause: `keys took up to ${r.p95} ms (p95) to show while typing`,
      hint: 'see what ran meanwhile: chats streaming, builds/e2e on the PC (machine CPU); bench: node scripts/bench-perf.mjs',
    });
  } else log.info('perf', 'input lag', { data: r });
}

/** a label whose steps add up to this much (ms) during one stall is named in its log line */
export const SLOW_STEP_MS = 20;
/** the main thread late by this much (ms) is a freeze the user sees */
export const STALL_MS = 100;
const TICK_MS = 100;
type Tally = Map<string, { ms: number; n: number }>;
/** every labelled step since the last tick (label → total ms, count); outer = time inside outermost steps only */
let tally: Tally = new Map(), outer = 0, depth = 0;
/** the labels of the stalls counted but not logged since the last log line (once a minute) */
let minute: Tally = new Map();
const add = (t: Tally, label: string, ms: number, n = 1) => { const e = t.get(label); if (e) { e.ms += ms; e.n += n; } else t.set(label, { ms, n }); };

/** A synchronous main-process step that took `ms`: added to its label's total for the stall it may be part of. */
export function slowStep(label: string, ms: number): void {
  if (!(ms > 0)) return;
  add(tally, label, ms);
  if (depth === 0) outer += ms;
  if (tally.size > 200) tally = new Map([...tally].sort((a, b) => b[1].ms - a[1].ms).slice(0, 50));
}
/** Times fn as one main-process step (slowStep): its synchronous part only (an async fn's await is not counted). */
export function timedStep<T>(label: string, fn: () => T): T {
  const t = performance.now();
  depth++;
  try { return fn(); } finally { depth--; slowStep(label, performance.now() - t); }
}

/** The labels of a tally that add up to SLOW_STEP_MS or more, slowest first (at most `max`). */
const topOf = (t: Iterable<[string, { ms: number; n: number }]>, max: number) => [...t].filter(([, v]) => v.ms >= SLOW_STEP_MS)
  .sort((a, b) => b[1].ms - a[1].ms).slice(0, max).map(([label, v]) => ({ label, ms: Math.round(v.ms), ...(v.n > 1 ? { n: v.n } : {}) }));

/** What one tick saw: a stall (late by at least STALL_MS) with its suspects (labels by total time), or null. Pure, for
 *  the tests. labeledMs = the part of the stall spent inside labelled steps (the rest: GC, unlabelled callbacks). */
export function stallOf(lateMs: number, noted: readonly { label: string; ms: number; n?: number }[], labeledMs?: number, cpu?: { cpuMs: number; machineCpu?: number | null }): Stall | null {
  if (lateMs < STALL_MS) return null;
  const t: Tally = new Map();
  for (const s of noted) add(t, s.label, s.ms, s.n ?? 1);
  return {
    ms: Math.round(lateMs), steps: topOf(t, 5), ...(labeledMs !== undefined ? { labeledMs: Math.round(labeledMs) } : {}),
    ...(cpu ? { cpuMs: Math.round(cpu.cpuMs), ...(typeof cpu.machineCpu === 'number' ? { machineCpu: cpu.machineCpu } : {}) } : {}),
  };
}
interface Stall { ms: number; steps: { label: string; ms: number; n?: number }[]; labeledMs?: number; cpuMs?: number; machineCpu?: number }

/** Below this share of the stall spent on the CPU (cpuMs / ms), the main process was waiting, not working: the PC's
 *  CPU went to other processes (or a lock or the disk held it). */
export const STARVED_SHARE = 0.25;
/** Why the window froze, for the log line's `cause`. Pure, for the tests. */
export function stallCause(s: Stall): string {
  if (s.steps.length) return `the window froze ${s.ms} ms while ${named(s.steps)}`;
  if (s.cpuMs !== undefined && s.cpuMs < s.ms * STARVED_SHARE) {
    return `the window froze ${s.ms} ms with the app on the CPU for only ${s.cpuMs} ms: CPU scheduling, a lock or synchronous I/O may be responsible${s.machineCpu !== undefined ? ` (machine CPU ${s.machineCpu}%)` : ''}`;
  }
  return `the window froze ${s.ms} ms (no labelled step ran: GC, a native call, an unlabelled callback or the PC itself)`;
}

/** Busy share of all the PC's cores since `from` (os.cpus() times), 0-100; null when nothing elapsed. */
const cpuTimes = () => { let busy = 0, total = 0; for (const c of os.cpus()) { const t = c.times, all = t.user + t.nice + t.sys + t.idle + t.irq; total += all; busy += all - t.idle; } return { busy, total }; };
function machineBusy(from: { busy: number; total: number }, to: { busy: number; total: number }): number | null {
  const total = to.total - from.total;
  return total > 0 ? Math.round(((to.busy - from.busy) / total) * 100) : null;
}

const named = (steps: { label: string; ms: number; n?: number }[]) => steps.map(s => `${s.label} ${s.ms} ms${s.n ? ` (${s.n}×)` : ''}`).join(', ');

/** Watches the main thread: a tick late by STALL_MS or more logs a `perf` warning (at most one a minute, the rest
 *  counted, with the labels that ran in them: topSinceLast). */
export function startStallWatch(now: () => number = () => performance.now(), usage: () => NodeJS.CpuUsage = () => process.cpuUsage(), machine: () => { busy: number; total: number } = cpuTimes): () => void {
  let last = now(), lastLog = -Infinity, missed = 0, worst = 0, ticks = 0;
  let lastCpu = usage(), lastMachine = machine();
  const timer = setInterval(() => {
    const t = now(), late = t - last - TICK_MS;
    last = t;
    const cpuNow = usage(), cpuMs = (cpuNow.user - lastCpu.user + cpuNow.system - lastCpu.system) / 1000;
    lastCpu = cpuNow;
    // the PC's load: read at a stall, else once a second (os.cpus() is not free)
    let machineCpu: number | null = null;
    if (late >= STALL_MS || ++ticks % 10 === 0) { const m = machine(); if (late >= STALL_MS) machineCpu = machineBusy(lastMachine, m); lastMachine = m; }
    const stall = stallOf(late, [...tally].map(([label, v]) => ({ label, ms: v.ms, n: v.n })), outer, { cpuMs, machineCpu });
    const seen = tally;
    tally = new Map(); outer = 0;
    if (!stall) return;
    if (t - lastLog < 60_000) {
      missed++; worst = Math.max(worst, stall.ms);
      for (const [label, v] of seen) add(minute, label, v.ms, v.n);
      return;
    }
    const top = topOf(minute, 8);
    log.warn('perf', 'main process blocked', { data: { ...stall, ...(missed ? { sinceLast: missed, worstSinceLast: worst, ...(top.length ? { topSinceLast: top } : {}) } : {}) },
      cause: stallCause(stall),
      hint: 'a synchronous step on the main process blocks input and frames; see the steps named here (topSinceLast: the stalls of the last minute)' });
    lastLog = t; missed = 0; worst = 0; minute = new Map();
  }, TICK_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
