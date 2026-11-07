// Cold-start admission of agents' chats (ADR 0221, superseding the CPU queue of ADR 0036; idea from cloudroom's
// startups semaphore). Before an agent (the Orchestrator's new chat, a closed chat reopened by an agent, the app's own
// resume after a restart) starts a chat's engine, ChatManager asks this queue: at most `slots` cold starts run at once
// (default max(1, floor(cores/2))), each holding its slot from the spawn until the engine's first answer, its exit or
// slotMaxMs; the CPU/RAM thresholds are only an emergency brake (default CPU over 95 % or free RAM under 10 %). A
// chat whose engine is already up ('turn') never waits; neither do the user's own messages nor messages between open
// chats (manager.ts bypasses, ADR 0064); nothing running is ever paused or killed. What waits goes FIFO within its
// priority, the app's own chats (`app`) behind every other chat's work (the user, 2026-10-14). After the brake a few
// samples in a row under are needed again, so the queue never starts all together. Zero tokens and no dependency: the
// load is os.cpus() deltas and os.freemem(). Who: wiring.ts builds it (OsLoadSampler, or a forced one from
// SB_LOAD_FORCE for tests/demo), ChatManager uses it.
import { timersFor } from '../timers';
const { setInterval, clearInterval, setTimeout, clearTimeout } = timersFor('chats/admission');
import os from 'node:os';

/** percent, 0-100 */
export interface LoadSample { cpu: number; freeRam: number }

export interface LoadSampler {
  /** the load now: CPU averaged over the last few seconds, free RAM */
  sample(): LoadSample;
  stop?(): void;
}

/** enabled = the queue on; cpu/ram = the emergency brake; slots = cold starts at once (default coldStartSlots()) */
export interface AdmissionLimits { enabled: boolean; cpu: number; ram: number; slots?: number }

/** cloudroom's bound (core/src/session/mod.rs: available_parallelism()/2): cold-start CPU contention, never the number
 *  of running chats; 7 on a 14-core PC. */
export function coldStartSlots(cores = os.availableParallelism?.() ?? os.cpus().length): number {
  return Math.max(1, Math.floor(cores / 2));
}

/** CPU busy % from os.cpus() snapshots every tickMs, averaged over the last `window` intervals; free RAM from os. */
export class OsLoadSampler implements LoadSampler {
  private last = snapshot();
  private deltas: { busy: number; total: number }[] = [];
  private timer: NodeJS.Timeout;

  constructor(tickMs = 2000, private readonly window = 3) {
    this.timer = setInterval(() => this.tick(), tickMs);
    this.timer.unref?.();
  }

  private tick(): void {
    const now = snapshot();
    this.deltas.push({ busy: now.busy - this.last.busy, total: now.total - this.last.total });
    if (this.deltas.length > this.window) this.deltas.shift();
    this.last = now;
  }

  sample(): LoadSample {
    // before the first tick: the interval since the sampler started
    const now = this.deltas.length ? null : snapshot();
    const ds = now ? [{ busy: now.busy - this.last.busy, total: now.total - this.last.total }] : this.deltas;
    const busy = ds.reduce((a, d) => a + d.busy, 0), total = ds.reduce((a, d) => a + d.total, 0);
    return { cpu: total > 0 ? Math.round((busy / total) * 100) : 0, freeRam: Math.round((os.freemem() / os.totalmem()) * 100) };
  }

  stop(): void { clearInterval(this.timer); }
}

function snapshot(): { busy: number; total: number } {
  let busy = 0, total = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    const all = t.user + t.nice + t.sys + t.idle + t.irq;
    total += all;
    busy += all - t.idle;
  }
  return { busy, total };
}

/** SB_LOAD_FORCE="cpu,freeRam" (e.g. "95,40"): a fixed load for the e2e suite and the demo; null when unset or bad. */
export function forcedSampler(value: string | undefined): LoadSampler | null {
  const m = /^\s*(\d{1,3})\s*,\s*(\d{1,3})\s*$/.exec(value ?? '');
  if (!m) return null;
  const s = { cpu: Math.min(100, Number(m[1])), freeRam: Math.min(100, Number(m[2])) };
  return { sample: () => ({ ...s }) };
}

export interface QueuedEntry {
  key: string;
  /** start = a new chat's engine; turn = a message that wakes an idle chat */
  kind: 'start' | 'turn';
  since: number;
  /** a chat on the app itself: waits behind every other chat's work */
  app?: boolean;
  /** 1 = the next one admitted */
  position: number;
}

export interface AdmissionOptions {
  /** Dynamic work-thread urgency: 0 production, 1 support, 2 normal. Never preempts running commands. */
  priority?: (key: string) => number;
  sampler: LoadSampler;
  limits: () => AdmissionLimits;
  /** ms between two samples while something waits (default 2 s) */
  tickMs?: number;
  /** samples in a row under the brake before admissions resume after it (default 2) */
  underNeeded?: number;
  /** a cold start that never reported back frees its slot after this (default 120 s): a slot never leaks */
  slotMaxMs?: number;
  /** false = no timer (tests call tick()) */
  autoTick?: boolean;
  /** the queue or the load it shows changed (the manager refreshes the queued chats) */
  onChange?: () => void;
  now?: () => number;
}

/** The work admitted: a cold start gets `done`, called once its engine answered (or failed); a turn's is a no-op. */
export type AdmittedRun = (done: () => void) => void;

interface Entry { key: string; kind: 'start' | 'turn'; since: number; app: boolean; runs: AdmittedRun[] }

export class AdmissionQueue {
  private q: Entry[] = [];
  private under = 0;
  /** the emergency brake fired: admissions wait for `underNeeded` samples in a row under it */
  private braked = false;
  private timer: NodeJS.Timeout | null = null;
  private lastLoad: LoadSample;
  /** cold starts in flight, by key: each frees its slot once (done, or slotMaxMs) */
  private readonly starting = new Map<string, NodeJS.Timeout>();

  constructor(private readonly o: AdmissionOptions) {
    this.lastLoad = o.sampler.sample();
  }

  /** the emergency brake says "too busy" for this load */
  over(s: LoadSample, l = this.o.limits()): boolean {
    return l.enabled && (s.cpu > l.cpu || s.freeRam < l.ram);
  }

  /** the load last sampled (refreshed by request() and every tick while something waits) */
  load(): LoadSample { return { ...this.lastLoad }; }

  /** cold starts in flight and the cap */
  slots(): { starting: number; slots: number } {
    return { starting: this.starting.size, slots: this.cap() };
  }

  /** over the emergency brake now: no engine is started ahead (the warm one, warm.ts). A full queue alone is no
   *  reason: a warm engine is what the next waiting chat would adopt (proposal 2 of the cloudroom plan). */
  braking(): boolean {
    if (!this.o.limits().enabled) return false;
    return this.over(this.refresh());
  }

  /** run now (returns null) or queue it (returns its place). A key already waiting queues behind its own entry, in
   *  order. A 'turn' (its engine is up) never waits; a 'start' waits for a free slot, under the brake, behind nobody.
   *  With the queue switched off everything runs at once. app = a chat on the app itself: it goes behind every other
   *  chat's work, which goes ahead of all the app's (each in order of arrival). */
  request(key: string, kind: 'start' | 'turn', run: AdmittedRun, app = false): QueuedEntry | null {
    const mine = this.q.find(e => e.key === key);
    if (mine) { mine.runs.push(run); return this.entry(key); }
    if (!this.o.limits().enabled || kind === 'turn') { run(noop); return null; }
    // over the brake now: what comes next waits for `underNeeded` samples under it, like after a tick
    if (this.over(this.refresh())) { this.braked = true; this.under = 0; }
    if (!this.q.length && this.free() && !this.braked) { this.admit({ key, kind, since: 0, app, runs: [run] }); return null; }
    const e: Entry = { key, kind, since: this.o.now?.() ?? Date.now(), app, runs: [run] };
    const firstApp = app ? -1 : this.q.findIndex(x => x.app);
    if (firstApp < 0) this.q.push(e); else this.q.splice(firstApp, 0, e);
    this.arm();
    this.o.onChange?.();
    return this.entry(key);
  }

  /** the user's "Avvia ora" (or their own message): runs that key's waiting work now, past the cap; false = nothing waited */
  admitNow(key: string): boolean {
    const i = this.q.findIndex(e => e.key === key);
    if (i < 0) return false;
    const [e] = this.q.splice(i, 1);
    this.admit(e!);
    this.changed();
    return true;
  }

  /** forget a key (its chat closed): its waiting work never runs, a start in flight frees its slot */
  drop(key: string): boolean {
    this.release(key);
    const i = this.q.findIndex(e => e.key === key);
    if (i < 0) return false;
    this.q.splice(i, 1);
    this.changed();
    return true;
  }

  private prioritize(): void {
    const priority = (e: Entry) => this.o.priority?.(e.key) ?? 2;
    this.q.sort((a, b) => priority(a) - priority(b) || Number(a.app) - Number(b.app) || a.since - b.since);
  }

  entry(key: string): QueuedEntry | null {
    this.prioritize();
    const i = this.q.findIndex(e => e.key === key);
    if (i < 0) return null;
    const e = this.q[i]!;
    return { key, kind: e.kind, since: e.since, ...(e.app ? { app: true } : {}), position: i + 1 };
  }

  list(): QueuedEntry[] {
    this.prioritize();
    return this.q.map((e, i) => ({ key: e.key, kind: e.kind, since: e.since, ...(e.app ? { app: true } : {}), position: i + 1 }));
  }

  /** One sample: over the brake stops admissions until `underNeeded` samples in a row under it; otherwise the head
   *  goes while a slot is free. The switch turned off empties the queue in order. */
  tick(): void {
    this.prioritize();
    if (!this.q.length) { this.disarm(); return; }
    const l = this.o.limits();
    if (!l.enabled) {
      for (const e of this.q.splice(0)) this.admit(e);
      this.changed();
      return;
    }
    const s = this.refresh();
    if (this.over(s, l)) { this.braked = true; this.under = 0; }
    else if (this.braked && ++this.under >= (this.o.underNeeded ?? 2)) { this.braked = false; this.under = 0; }
    this.pump();
    this.changed();
  }

  stop(): void {
    this.disarm();
    for (const t of this.starting.values()) clearTimeout(t);
    this.starting.clear();
    this.o.sampler.stop?.();
  }

  private cap(): number { return Math.max(1, this.o.limits().slots ?? coldStartSlots()); }
  private free(): boolean { return this.starting.size < this.cap(); }

  /** heads while a slot is free and the brake is off (a 'turn' entry takes no slot) */
  private pump(): void {
    while (this.q.length && !this.braked && this.free()) this.admit(this.q.shift()!);
  }

  private refresh(): LoadSample { this.lastLoad = this.o.sampler.sample(); return this.lastLoad; }

  private admit(e: Entry): void {
    // a key admitted again while its earlier start still holds a slot keeps that one slot
    const cold = e.kind === 'start' && !this.starting.has(e.key);
    if (cold) {
      const t = setTimeout(() => this.release(e.key), this.o.slotMaxMs ?? 120000);
      t.unref?.();
      this.starting.set(e.key, t);
    }
    // every start gets a real release (by key, idempotent): a noop would leave the slot to the 120 s cap
    const done = e.kind === 'start' ? once(() => this.release(e.key)) : noop;
    for (const f of e.runs) {
      try { f(done); } catch { /* each run reports its own failure (manager.ts) */ }
    }
  }

  /** a cold start is over (its engine answered, failed or exited): the next waiting one may go */
  private release(key: string): void {
    const t = this.starting.get(key);
    if (!t) return;
    clearTimeout(t);
    this.starting.delete(key);
    if (!this.q.length) return;
    if (this.over(this.refresh())) { this.braked = true; this.under = 0; }
    this.pump();
    this.changed();
  }

  private changed(): void {
    if (!this.q.length) { this.disarm(); this.under = 0; this.braked = false; }
    this.o.onChange?.();
  }

  private arm(): void {
    if (this.timer || this.o.autoTick === false) return;
    this.timer = setInterval(() => this.tick(), this.o.tickMs ?? 2000);
    this.timer.unref?.();
  }

  private disarm(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}

const noop = (): void => {};
function once(f: () => void): () => void {
  let called = false;
  return () => { if (!called) { called = true; f(); } };
}
