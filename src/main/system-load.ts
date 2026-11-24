// The PC's load for the top bar (ADR 0347): CPU busy % since the previous read (os.cpus() deltas, every core) and the free
// RAM in bytes and %. The renderer asks every few seconds over 'app:load' (TopBar.tsx → SystemLoad.tsx); each read
// compares with the one before, so the figure is the average over the poll interval. Pure parts take the snapshots and
// the memory as arguments, for the tests.
import os from 'node:os';
import type { SystemLoad } from '../shared/contract';

export interface CpuSnap { busy: number; total: number }

export function cpuSnap(cpus: readonly Pick<os.CpuInfo, 'times'>[] = os.cpus()): CpuSnap {
  let busy = 0, total = 0;
  for (const c of cpus) {
    const t = c.times, all = t.user + t.nice + t.sys + t.idle + t.irq;
    total += all; busy += all - t.idle;
  }
  return { busy, total };
}

/** Busy % between two snapshots, 0-100; null when no time passed (the first read). */
export function busyPct(from: CpuSnap, to: CpuSnap): number | null {
  const total = to.total - from.total;
  if (total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round(((to.busy - from.busy) / total) * 100)));
}

export function loadOf(cpu: number | null, free: number, total: number): SystemLoad {
  return { cpu, freeRamBytes: free, totalRamBytes: total, freeRamPct: total > 0 ? Math.round((free / total) * 100) : 0 };
}

/** One reader: each call returns the CPU since the previous call (the first call: since the reader was made). */
export function systemLoadReader(snap: () => CpuSnap = () => cpuSnap(), mem: () => { free: number; total: number } = () => ({ free: os.freemem(), total: os.totalmem() })): () => SystemLoad {
  let last = snap();
  return () => {
    const now = snap(), cpu = busyPct(last, now);
    if (cpu !== null) last = now;
    const m = mem();
    return loadOf(cpu, m.free, m.total);
  };
}
