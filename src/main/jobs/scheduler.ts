// Serial, visibility-gated agent jobs for Battito and maintenance (ADR 0070).
// The owner supplies a durable ledger; claiming before running prevents restart catch-up bursts.
import { timersFor } from '../timers';
const { setTimeout, clearTimeout } = timersFor('jobs/scheduler');
export type JobSchedule = { slots: string[] } | { everyMin: number };
export interface JobContext { at: number; slot: string }
export interface Job {
  id: string; agentId: string; schedule: JobSchedule; visibleOnly: boolean; budgetKey: string;
  run(context: JobContext): Promise<void>;
}
export interface JobStamp { at: number; slot: string }
export interface SchedulerDeps {
  visible(): boolean;
  enabled(job: Job): boolean;
  last(id: string): JobStamp | undefined;
  claim(id: string, stamp: JobStamp): void;
  onError(id: string, error: unknown): void;
  now?: () => number;
  env?: NodeJS.ProcessEnv;
}
export const localDay = (at: number): string => {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Latest missed slot only; a ledger timestamp also protects against a clock moving backwards. */
export function dueSlot(schedule: JobSchedule, at: number, last?: JobStamp): string | null {
  if (last && at <= last.at) return null;
  if ('everyMin' in schedule) {
    return !last || at - last.at >= schedule.everyMin * 60_000 ? `interval:${at}` : null;
  }
  const date = new Date(at), day = localDay(at);
  const minutes = date.getHours() * 60 + date.getMinutes();
  const latest = [...schedule.slots].sort().filter(s => Number(s.slice(0, 2)) * 60 + Number(s.slice(3)) <= minutes).at(-1);
  if (!latest) return null;
  const slot = `${day}/${latest}`;
  return last?.slot === slot || (last && localDay(last.at) === day && last.slot >= slot) ? null : slot;
}

export class JobScheduler {
  private jobs: Job[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private busy = false;
  private stopped = false;
  constructor(private readonly d: SchedulerDeps) {}

  register(job: Job): void {
    if (!job.id || !job.agentId || !job.budgetKey || this.jobs.some(j => j.id === job.id)) throw new Error('Invalid or duplicate job');
    const schedule = job.schedule;
    if ('slots' in schedule) {
      if (!schedule.slots.length || schedule.slots.length > 3 || new Set(schedule.slots).size !== schedule.slots.length || schedule.slots.some(s => !/^([01]\d|2[0-3]):[0-5]\d$/.test(s))) throw new Error('Invalid job slots');
    } else if (!Number.isFinite(schedule.everyMin) || schedule.everyMin < 1) throw new Error('Invalid job interval');
    this.jobs.push({ ...job, schedule: structuredClone(schedule) });
  }

  /** Call after window ready. Production timers never start in the test harness. */
  start(): void {
    if (this.timer || this.stopped || this.testing()) return;
    this.arm(15_000);
  }
  private testing(): boolean { const env = this.d.env ?? process.env; return !!(env.SB_TEST || env.VITEST); }
  private arm(ms: number): void {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.tick().finally(() => { if (!this.stopped) this.arm(5 * 60_000); });
    }, ms);
    this.timer.unref?.();
  }
  async tick(): Promise<void> {
    if (this.stopped || this.busy || this.testing()) return;
    this.busy = true;
    try {
      for (const job of this.jobs) {
        if (this.stopped) break;
        try {
          if (!this.d.enabled(job) || (job.visibleOnly && !this.d.visible())) continue;
          const at = this.d.now?.() ?? Date.now(), slot = dueSlot(job.schedule, at, this.d.last(job.id));
          if (!slot) continue;
          this.d.claim(job.id, { at, slot });
          await job.run({ at, slot });
        } catch (error) { this.d.onError(job.id, error); }
      }
    } finally { this.busy = false; }
  }
  stop(): void { this.stopped = true; clearTimeout(this.timer); this.timer = undefined; }
}
