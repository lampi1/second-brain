// CPU-aware admission of chats and turns (ADR 0036; the user, 2026-10-13: CPU at 100% with many chats, "la Regia decide
// in base alla CPU, a costo zero, con una coda"). Before an agent (the Regia, another chat's mail, the app's own resume
// after a restart) starts a chat's engine or wakes an idle chat with a new turn, ChatManager asks this queue: with the
// machine under the thresholds (CPU averaged over a few seconds, free RAM) and nobody waiting, it goes at once; else it
// waits here, FIFO within its priority, and is admitted when the load drops (two samples in a row under, one admission per sample, so the
// queue never starts all together). The user's own messages never wait (manager.ts bypasses), nothing running is ever
// paused or killed. Work for the app's own chats (`app`) waits behind every other chat's work (the user, 2026-10-14:
// "hanno sempre la precedenza le chat di lavoro rispetto a quelle dell'app"); only the order changes, and only while
// something waits. Zero tokens and no dependency: the load is os.cpus() deltas and os.freemem(). Who: wiring.ts builds
// it (OsLoadSampler, or a forced one from SB_LOAD_FORCE for tests/demo), ChatManager uses it.
import os from 'node:os';

/** percent, 0-100 */
export interface LoadSample { cpu: number; freeRam: number }

export interface LoadSampler {
  /** the load now: CPU averaged over the last few seconds, free RAM */
  sample(): LoadSample;
  stop?(): void;
}

export interface AdmissionLimits { enabled: boolean; cpu: number; ram: number }

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

/** Chat mail is never held in the queue (a queue lost at quit would lose it): it stays unread, retried later. */
export const MAIL_WAITS = 'Il PC è sotto sforzo: la posta resta da leggere e arriva quando il carico scende.';

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
  sampler: LoadSampler;
  limits: () => AdmissionLimits;
  /** ms between two samples while something waits (default 2 s) */
  tickMs?: number;
  /** samples in a row under the thresholds before an admission (default 2) */
  underNeeded?: number;
  /** false = no timer (tests call tick()) */
  autoTick?: boolean;
  /** the queue or the load it shows changed (the manager refreshes the queued chats) */
  onChange?: () => void;
  now?: () => number;
}

interface Entry { key: string; kind: 'start' | 'turn'; since: number; app: boolean; runs: (() => void)[] }

export class AdmissionQueue {
  private q: Entry[] = [];
  private under = 0;
  private timer: NodeJS.Timeout | null = null;
  private lastLoad: LoadSample;

  constructor(private readonly o: AdmissionOptions) {
    this.lastLoad = o.sampler.sample();
  }

  /** the thresholds say "too busy" for this load */
  over(s: LoadSample, l = this.o.limits()): boolean {
    return l.enabled && (s.cpu > l.cpu || s.freeRam < l.ram);
  }

  /** the load last sampled (refreshed by request() and every tick while something waits) */
  load(): LoadSample { return { ...this.lastLoad }; }

  /** too busy now, or someone already waits: a new engine (the warm one, warm.ts) should not start */
  busy(): boolean {
    if (!this.o.limits().enabled) return false;
    return this.q.length > 0 || this.over(this.refresh());
  }

  /** request() for this key would wait now (someone waits, this key already, or the load is over) */
  wouldWait(key: string): boolean {
    if (!this.o.limits().enabled) return false;
    return this.q.length > 0 || this.q.some(e => e.key === key) || this.over(this.refresh());
  }

  /** run now (returns null) or queue it (returns its place). A key already waiting queues behind its own entry,
   *  in order; with the queue switched off everything runs at once. app = a chat on the app itself: it goes behind
   *  every other chat's work, which goes ahead of all the app's (each in order of arrival). */
  request(key: string, kind: 'start' | 'turn', run: () => void, app = false): QueuedEntry | null {
    const mine = this.q.find(e => e.key === key);
    if (mine) { mine.runs.push(run); return this.entry(key); }
    if (!this.o.limits().enabled || (!this.q.length && !this.over(this.refresh()))) { run(); return null; }
    const e: Entry = { key, kind, since: this.o.now?.() ?? Date.now(), app, runs: [run] };
    const firstApp = app ? -1 : this.q.findIndex(x => x.app);
    if (firstApp < 0) this.q.push(e); else this.q.splice(firstApp, 0, e);
    this.arm();
    this.o.onChange?.();
    return this.entry(key);
  }

  /** the user's "Avvia ora" (or their own message): runs that key's waiting work now; false = nothing waited */
  admitNow(key: string): boolean {
    const i = this.q.findIndex(e => e.key === key);
    if (i < 0) return false;
    const [e] = this.q.splice(i, 1);
    this.run(e!);
    this.changed();
    return true;
  }

  /** forget a key (its chat closed): its waiting work never runs */
  drop(key: string): boolean {
    const i = this.q.findIndex(e => e.key === key);
    if (i < 0) return false;
    this.q.splice(i, 1);
    this.changed();
    return true;
  }

  entry(key: string): QueuedEntry | null {
    const i = this.q.findIndex(e => e.key === key);
    if (i < 0) return null;
    const e = this.q[i]!;
    return { key, kind: e.kind, since: e.since, ...(e.app ? { app: true } : {}), position: i + 1 };
  }

  list(): QueuedEntry[] {
    return this.q.map((e, i) => ({ key: e.key, kind: e.kind, since: e.since, ...(e.app ? { app: true } : {}), position: i + 1 }));
  }

  /** One sample: under the thresholds `underNeeded` times in a row admits the head (one per sample). The switch
   *  turned off empties the queue in order. */
  tick(): void {
    if (!this.q.length) { this.disarm(); return; }
    const l = this.o.limits();
    if (!l.enabled) {
      for (const e of this.q.splice(0)) this.run(e);
      this.changed();
      return;
    }
    const s = this.refresh();
    this.under = this.over(s, l) ? 0 : this.under + 1;
    if (this.under >= (this.o.underNeeded ?? 2)) {
      this.under = 0; // the one just admitted needs a few seconds to show in the load: count again from zero
      this.run(this.q.shift()!);
    }
    this.changed();
  }

  stop(): void { this.disarm(); this.o.sampler.stop?.(); }

  private refresh(): LoadSample { this.lastLoad = this.o.sampler.sample(); return this.lastLoad; }

  private run(e: Entry): void {
    for (const f of e.runs) {
      try { f(); } catch { /* each run reports its own failure (manager.ts) */ }
    }
  }

  private changed(): void {
    if (!this.q.length) { this.disarm(); this.under = 0; }
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
