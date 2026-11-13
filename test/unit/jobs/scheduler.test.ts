// Scheduler contracts: local slots, durable claims, visibility and serial execution without real engines.
import { describe, expect, it, vi } from 'vitest';
import { dueSlot, JobScheduler, type Job, type JobStamp } from '../../../src/main/jobs/scheduler';

const at = (hour: number, minute = 0, day = 18) => new Date(2026, 9, day, hour, minute).getTime();
const slots = { slots: ['08:30', '13:00', '18:30'] };
function fixture(env: NodeJS.ProcessEnv = {}) {
  const ledger = new Map<string, JobStamp>();
  const deps = { env, visible: vi.fn(() => true), enabled: vi.fn(() => true), now: () => at(14),
    last: (id: string) => ledger.get(id), claim: (id: string, stamp: JobStamp) => { ledger.set(id, stamp); }, onError: vi.fn() };
  const scheduler = new JobScheduler(deps);
  const job: Job = { id: 'pulse', agentId: 'default-pulse', budgetKey: 'pulse', visibleOnly: true, schedule: slots, run: vi.fn(async () => {}) };
  scheduler.register(job);
  return { deps, scheduler, job, ledger };
}
describe('agent job scheduler', () => {
  it('runs only the latest missed slot of today, once across restarts', async () => {
    const f = fixture();
    await f.scheduler.tick();
    expect(f.job.run).toHaveBeenCalledExactlyOnceWith({ at: at(14), slot: '2026-10-18/13:00' });
    const restarted = new JobScheduler(f.deps);
    restarted.register(f.job);
    await restarted.tick();
    expect(f.job.run).toHaveBeenCalledTimes(1);
    expect(dueSlot(slots, at(7), { at: at(19, 0, 17), slot: '2026-10-17/18:30' })).toBeNull();
    expect(dueSlot(slots, at(19), f.ledger.get('pulse'))).toBe('2026-10-18/18:30');
  });
  it('does not run while hidden or off, or under either test flag', async () => {
    const f = fixture();
    f.deps.visible.mockReturnValue(false);
    await f.scheduler.tick();
    f.deps.visible.mockReturnValue(true);
    f.deps.enabled.mockReturnValue(false);
    await f.scheduler.tick();
    expect(f.job.run).not.toHaveBeenCalled();
    for (const env of [{ SB_TEST: '1' }, { VITEST: 'true' }]) {
      const test = fixture(env);
      await test.scheduler.tick();
      expect(test.job.run).not.toHaveBeenCalled();
    }
  });
  it('claims before a run and serializes jobs and concurrent ticks', async () => {
    const f = fixture();
    let finish!: () => void;
    f.job.run = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const scheduler = new JobScheduler(f.deps);
    scheduler.register(f.job);
    const second = vi.fn(async () => {});
    scheduler.register({ ...f.job, id: 'headline', run: second });
    const running = scheduler.tick();
    await scheduler.tick();
    expect(f.ledger.has('pulse')).toBe(true);
    expect(second).not.toHaveBeenCalled();
    finish();
    await running;
    expect(second).toHaveBeenCalledTimes(1);
  });
  it('keeps failed slots claimed and records errors', async () => {
    const f = fixture();
    const scheduler = new JobScheduler(f.deps);
    scheduler.register({ ...f.job, run: async () => { throw new Error('failure'); } });
    await scheduler.tick();
    await scheduler.tick();
    expect(f.deps.onError).toHaveBeenCalledTimes(1);
  });
  it('enforces elapsed intervals without catch-up or backward-clock repeats', () => {
    const last = { at: at(10), slot: 'interval' };
    expect(dueSlot({ everyMin: 60 }, at(10, 59), last)).toBeNull();
    expect(dueSlot({ everyMin: 60 }, at(9), last)).toBeNull();
    expect(dueSlot({ everyMin: 60 }, at(19), last)).toBe(`interval:${at(19)}`);
  });
  it('starts 15 seconds after ready and ticks every five minutes; stop cancels timers', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      f.scheduler.start();
      await vi.advanceTimersByTimeAsync(14_999);
      expect(f.job.run).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(f.job.run).toHaveBeenCalledTimes(1);
      f.scheduler.stop();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
