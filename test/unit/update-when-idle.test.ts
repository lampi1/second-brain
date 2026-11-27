// «Aggiorna» waits for the chats at work (update/when-idle.ts, update/source.ts updateNow; ADR 0371 point 8, #492):
// with 3 chats running a turn no pull starts and the message says how many; when they end the update goes by itself;
// after the maximum wait it asks; «Aggiorna ora» goes at once. The timer and the clock are the test's own, and the pull
// script is a spy: no process, no git, no real time.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppSourceService, type PullResult } from '../../src/main/update/source';
import { timedOutText, UPDATE_POLL_MS, UPDATE_WAIT_MAX_MS, UpdateWhenIdle, waitingText } from '../../src/main/update/when-idle';
import type { AppSourceState } from '../../src/shared/contract';

const dirs: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-uwi-')); dirs.push(d); return d; };

/** A hand-driven timer: fire() runs the one armed callback. */
function timers() {
  let armed: { fn: () => void; ms: number } | null = null, t = 0;
  return {
    schedule: (fn: () => void, ms: number) => { armed = { fn, ms }; return () => { armed = null; }; },
    now: () => t,
    pass: (ms: number) => { t += ms; },
    fire: () => { const a = armed; armed = null; a?.fn(); },
    get armed() { return armed; },
  };
}

describe('#492 point 8: «Aggiorna» waits for the chats at work (ADR 0371)', () => {
  it('the wait: on while chats work, gone when they end, a question after the maximum', () => {
    const c = timers();
    let busy = 3;
    const events: string[] = [];
    const w = new UpdateWhenIdle({ busy: () => busy, schedule: c.schedule, now: c.now });
    const on = { go: () => events.push('go'), waiting: (n: number, out: boolean) => events.push(`${n}${out ? ' timed out' : ''}`) };
    expect(w.begin(false, on)).toBe('wait');
    expect(c.armed?.ms).toBe(UPDATE_POLL_MS);
    c.pass(UPDATE_POLL_MS); busy = 1; c.fire();
    busy = 0; c.pass(UPDATE_POLL_MS); c.fire();
    expect(events).toEqual(['3', '1', 'go']);
    expect(w.waiting).toBe(false);
    // the maximum: still 2 at work after 20 minutes, the user is asked, and it still goes by itself when they end (#492
    // review: no «Controlla» needed after the question)
    events.length = 0; busy = 2;
    w.begin(false, on);
    c.pass(UPDATE_WAIT_MAX_MS); c.fire();
    expect(events).toEqual(['2', '2 timed out']);
    expect(w.timedOut).toBe(true);
    expect(c.armed).not.toBeNull();
    busy = 0; c.pass(UPDATE_POLL_MS); c.fire();
    expect(events).toEqual(['2', '2 timed out', 'go']);
    // forced, or nobody at work: at once
    expect(w.begin(true, on)).toBe('go');
    busy = 0;
    expect(w.begin(false, on)).toBe('go');
    expect(waitingText(3)).toContain('le 3 chat al lavoro');
    expect(timedOutText(3)).toMatch(/3 chat lavorano ancora: «Aggiorna ora» le interrompe.*aggiorno da solo appena finiscono/);
  });

  it('(review) a hold (the Orchestrator\'s code update running) is waited for, even forced and with nobody at work', () => {
    const c = timers();
    let held = true;
    const events: string[] = [];
    const w = new UpdateWhenIdle({ busy: () => 0, hold: () => held, schedule: c.schedule, now: c.now });
    const on = { go: () => events.push('go'), waiting: (n: number) => events.push(String(n)) };
    expect(w.begin(false, on)).toBe('wait');
    c.fire();
    held = false; c.fire();
    expect(events).toEqual(['0', '0', 'go']);
    expect(waitingText(0)).toMatch(/aggiornamento del codice in corso/);
  });

  it('the service: 3 chats at work → no pull, «waiting» with how many; they end → the update runs; «Aggiorna ora» → at once', async () => {
    const repo = tmp(), userData = tmp();
    fs.mkdirSync(path.join(repo, 'scripts'));
    fs.writeFileSync(path.join(repo, 'scripts', 'pull.mjs'), '');
    const c = timers();
    let busy = 3;
    const states: AppSourceState[] = [];
    const pulls: string[][] = [];
    vi.spyOn(AppSourceService.prototype as unknown as { runPull(repo: string, extra: string[]): Promise<PullResult> }, 'runPull')
      .mockImplementation(async (_repo: string, extra: string[]) => { pulls.push(extra); return { ok: true, message: '', upToDate: true }; });
    const s = new AppSourceService({ userData, releasesBase: tmp(), running: 'dev', stable: false, appRepo: () => null, devRepo: repo,
      emit: st => states.push(st), restart: () => {}, relaunch: () => {}, node: 'node', busyChats: () => busy, schedule: c.schedule, now: c.now });

    const st = await s.updateNow();
    expect(pulls).toEqual([]);
    expect(st.source).toMatchObject({ state: 'waiting', message: waitingText(3) });
    // a second click while it waits changes nothing; a check does not overwrite the wait
    await s.updateNow();
    expect(await s.sourceCheck()).toMatchObject({ source: { state: 'waiting' } });
    expect(pulls).toEqual([]);

    busy = 0; c.fire();
    // the update runs on promises only (the pull is a spy): a few microtask turns, no clock
    for (let i = 0; i < 50 && s.state().source.state !== 'done'; i++) await Promise.resolve();
    expect(s.state().source.state).toBe('done');
    expect(pulls.length).toBeGreaterThan(0);

    // «Aggiorna ora» with chats at work: no wait
    pulls.length = 0; busy = 2;
    await s.updateNow({ now: true });
    expect(pulls.length).toBeGreaterThan(0);
    expect(s.state().source.state).toBe('done');
  });

  it('(review) the Orchestrator\'s pull during the wait: no error; the update waits for it, then relaunches on the code it pulled', async () => {
    const repo = tmp(), userData = tmp();
    fs.mkdirSync(path.join(repo, 'scripts'));
    fs.writeFileSync(path.join(repo, 'scripts', 'pull.mjs'), '');
    const c = timers();
    let busy = 2, release: (r: PullResult) => void = () => {};
    const pulls: string[][] = [];
    vi.spyOn(AppSourceService.prototype as unknown as { runPull(repo: string, extra: string[]): Promise<PullResult> }, 'runPull')
      .mockImplementation((_repo: string, extra: string[]) => {
        pulls.push(extra);
        // the Orchestrator's own pull (the first with no flags) ends when the test says; «Aggiorna»'s check and pull find
        // nothing new: it was pulled
        const first = !extra.length && pulls.filter(x => !x.length).length === 1;
        return first ? new Promise<PullResult>(res => { release = res; }) : Promise.resolve({ ok: true, message: '', upToDate: true });
      });
    vi.spyOn(AppSourceService.prototype as unknown as { refresh(): Promise<AppSourceState> }, 'refresh').mockImplementation(async function (this: AppSourceService) { return this.state(); });
    const relaunched: number[] = [];
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const s = new AppSourceService({ userData, releasesBase: tmp(), running: 'dev', stable: false, appRepo: () => null, devRepo: repo,
        emit: () => {}, restart: () => {}, relaunch: () => { relaunched.push(1); }, node: 'node', busyChats: () => busy, schedule: c.schedule, now: c.now });
      await s.updateNow();
      expect(s.state().source.state).toBe('waiting');
      const orchestratorPull = s.pull();   // app_update_code while «Aggiorna» waits
      // the chats end while the code update runs: «Aggiorna» waits for it, no error
      busy = 0; c.fire();
      expect(s.state().source).toMatchObject({ state: 'waiting', message: waitingText(0) });
      // a click meanwhile is no error either
      await expect(s.updateNow()).resolves.toMatchObject({ source: { state: 'waiting' } });
      release({ ok: true, message: '', upToDate: false, from: 'a', to: 'b' });
      await orchestratorPull;
      c.fire();
      for (let i = 0; i < 50 && s.state().source.state !== 'restarting'; i++) await Promise.resolve();
      expect(s.state().source.state).toBe('restarting');
      vi.runAllTimers();
      expect(relaunched).toEqual([1]);
      expect(pulls).toEqual([[], ['--check'], []]);
    } finally { vi.useRealTimers(); }
  });
});
