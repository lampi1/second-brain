// Zero-token housekeeping of the engines (ADR 0026), on timers in main:
// - every minute: chats idle for `engineIdleMin` release their engine (manager.releaseIdle; resumed on the next message);
// - every 15 minutes: the orphan sweep. Every engine seen running is remembered in <userData>/engines.json (pid, its
//   real creation time, its chat); once it is gone and its chat is no longer open (closed, archived, or the app that
//   ran it died), the tools still descending from it are killed (proctree.ts descendants: tools only, never a user's
//   program or what it started). The Job Object and the reap at exit catch almost everything; this is the net for what
//   escaped them: children born before the engine joined its job, engines of a run that crashed, a failed reap.
//   One log line per sweep with the counts, and the machine's process counts for the names that pile up.
// - at each engine spawn (jobGuard.onAdd) and every minute, without a process list: engines.json gets the new engine
//   and this run's lastSeen/exit times (touchRoots), so an app killed minutes after starting an engine still leaves
//   its pid behind; the first sweep, 45 s after the start, then kills an engine of an earlier run that is still alive
//   (its app gone) with its tools, and the tools left by ended ones. Never a process the app did not start, never
//   while that earlier run's own process still lives (2026-11-23: orphan claude.exe, bash, dev Electron after quits).
// Kills use TerminateProcess (process.kill), never taskkill; each one is logged with its reason. Used by wiring.ts.
import { timersFor } from '../timers';
const { setInterval, clearInterval } = timersFor('chats/sweep');
import fs from 'node:fs';
import path from 'node:path';
import { log } from '../log';
import { descendants, listProcesses, type Proc } from './proctree';

/** run: which app run saw it (an engine of an earlier run has no owner any more, even if its chat reopened) */
export interface EngineRoot { pid: number; created: number; chatId: string; run: string; lastSeen: number; exited: number | null;
  /** created is our clock right after spawn, not yet the OS creation time read by a sweep (touchRoots) */
  approx?: true }

/** This app run. */
export const RUN = `${process.pid}-${Date.now()}`;
export interface SweepOwners { live: { chatId: string; pid: number }[]; open: string[] }

/** Roots forgotten this long after their engine ended: nothing of theirs is left by then, and pids get reused. */
export const ROOT_TTL_MS = 24 * 3600_000;
export const SWEEP_EVERY_MS = 15 * 60_000;
export const FIRST_SWEEP_MS = 45_000;
export const IDLE_CHECK_MS = 60_000;
/** Names counted in each sweep's log line (the ones that piled up on 2026-10-13). */
const COUNTED = ['claude.exe', 'node.exe', 'electron.exe', 'conhost.exe', 'bash.exe', 'cmd.exe', 'git.exe', 'taskkill.exe', 'powershell.exe', 'agent.exe'];

/** How far a root noted at spawn (`approx`: our clock right after spawn) may be from the OS creation time. */
export const SPAWN_SLACK_MS = 5000;
/** An engine noted at spawn is in the manager's live list within this time, or it ended. */
const BOOT_MS = 60_000;
/** How far an app run's start (RUN's time, taken when this module loads) may be from its process's creation time. */
const RUN_SLACK_MS = 120_000;

/** The process `p` is the root's engine: same pid, same creation time (within the slack for a root noted at spawn). */
function sameEngine(r: EngineRoot, p: Proc | undefined): p is Proc {
  return !!p && p.pid === r.pid && (r.approx ? Math.abs(p.created - r.created) <= SPAWN_SLACK_MS : p.created === r.created);
}

/** The app run `run` (`<pid>-<startMs>`) still has its process: its engines are its own, never this run's to kill
 *  (a quit that takes long under load, a second copy with the same userData). Unreadable run = gone. */
export function runAlive(run: string, byPid: ReadonlyMap<number, Proc>): boolean {
  const m = /^(\d+)-(\d+)$/.exec(run);
  if (!m) return false;
  const p = byPid.get(Number(m[1]));
  return !!p && Math.abs(p.created - Number(m[2])) <= RUN_SLACK_MS;
}

/** A process the sweep kills and why (its log line says it). */
export interface Kill extends Proc { reason: 'left by an ended engine' | 'engine of an earlier app run' | 'left by an engine of an earlier app run' }

/** One sweep, pure: updates the roots from the process list and the owners; returns what to kill, children before
 *  their engine. Only recorded roots and the tools descending from them are ever killed: a pid the app never started
 *  is untouched. An engine of an earlier app run that is still alive (the app was killed, crashed, or its quit could
 *  not end it) is killed with its tools, once that run's process is gone. */
export function sweepOnce(roots: EngineRoot[], procs: readonly Proc[], owners: SweepOwners, now: number, run = RUN,
  /** when the process list was taken: a root of this run seen after it (noted while the list ran) is not judged */ listedAt = now): { roots: EngineRoot[]; orphans: Kill[] } {
  const byPid = new Map(procs.map(p => [p.pid, p]));
  const out = new Map<string, EngineRoot>();
  const key = (r: { pid: number; created: number }): string => `${r.pid}:${r.created}`;
  for (const r of roots) out.set(key(r), { ...r });
  // running engines: (re)recorded with their real creation time (a root noted at spawn becomes exact)
  const liveKeys = new Set<string>();
  for (const l of owners.live) {
    const p = byPid.get(l.pid);
    if (!p) continue;
    for (const [k, r] of out) if (r.approx && r.run === run && sameEngine(r, p)) out.delete(k);
    const k = key(p);
    liveKeys.add(k);
    out.set(k, { pid: p.pid, created: p.created, chatId: l.chatId, run, lastSeen: now, exited: null });
  }
  const kills = new Map<number, Kill>();
  const add = (list: readonly Proc[], reason: Kill['reason']): void => { for (const p of list) if (!kills.has(p.pid)) kills.set(p.pid, { ...p, reason }); };
  const alive = new Map<string, boolean>();
  const runOn = (r: EngineRoot): boolean => { if (!alive.has(r.run)) alive.set(r.run, runAlive(r.run, byPid)); return alive.get(r.run)!; };
  for (const [k, r] of out) {
    if (liveKeys.has(k) || r.exited !== null || (r.run === run && r.lastSeen > listedAt)) continue;
    const p = byPid.get(r.pid);
    if (r.run !== run && !runOn(r) && sameEngine(r, p)) {
      // its app is gone and it still runs: its tools (deepest first), then the engine itself
      add(descendants(procs, { pid: p.pid, created: p.created, exited: Infinity }, { live: true }).reverse(), 'left by an engine of an earlier app run');
      add([p], 'engine of an earlier app run');
      r.exited = now;
      continue;
    }
    // gone: ended at the last time it was seen (conservative: a child born after that is not counted as its)
    if (!sameEngine(r, p) || (r.run !== run && !runOn(r))) r.exited = r.lastSeen;
  }
  const open = new Set(owners.open);
  for (const r of out.values()) {
    // a kept engine's dev server stays while its chat is open in this run; a run still alive keeps its own
    if (r.exited === null || (r.run === run && open.has(r.chatId)) || (r.run !== run && runOn(r))) continue;
    add(descendants(procs, { pid: r.pid, created: r.created, exited: r.exited }), r.run === run ? 'left by an ended engine' : 'left by an engine of an earlier app run');
  }
  const kept = [...out.values()].filter(r => r.exited === null || now - r.exited < ROOT_TTL_MS);
  const list = [...kills.values()];
  const engine = (k: Kill): boolean => k.reason === 'engine of an earlier app run';
  return { roots: kept, orphans: [...list.filter(k => !engine(k)), ...list.filter(engine)] };
}

/** The cheap bookkeeping between sweeps (no process list): an engine just spawned is noted with our clock (`approx`),
 *  every live engine of this run gets its lastSeen, and one of this run no longer live ended when it was last seen.
 *  So a run that dies minutes after starting an engine still leaves its pid for the next start's sweep. */
export function touchRoots(roots: readonly EngineRoot[], live: readonly { chatId: string; pid: number }[], now: number, run = RUN, spawned?: { pid: number; chatId: string }): EngineRoot[] {
  const out = roots.map(r => ({ ...r }));
  if (spawned) out.push({ pid: spawned.pid, created: now, approx: true, chatId: spawned.chatId, run, lastSeen: now, exited: null });
  const livePids = new Set(live.map(l => l.pid));
  for (const r of out) {
    if (r.run !== run || r.exited !== null) continue;
    if (livePids.has(r.pid) || r.pid === spawned?.pid) r.lastSeen = now;
    // noted at spawn and not in the live list yet (still booting): not an end
    else if (!(r.approx && now - r.created < BOOT_MS)) r.exited = r.lastSeen;
  }
  return out.filter(r => r.exited === null || now - r.exited < ROOT_TTL_MS);
}

export function countByName(procs: readonly Proc[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const n of COUNTED) c[n] = 0;
  for (const p of procs) { const n = (p.name ?? '').toLowerCase(); if (n in c) c[n]! += 1; }
  return c;
}

export class EngineSweeper {
  private timers: NodeJS.Timeout[] = [];
  private running = false;
  private readonly file: string;

  constructor(private readonly o: {
    userData: string;
    owners: () => SweepOwners;
    releaseIdle: (idleMs: number) => number;
    idleMin: () => number;
    /** jobGuard.loosenLeased */
    spareLeased?: () => Promise<void>;
    list?: typeof listProcesses;
    kill?: (pid: number) => void;
  }) {
    this.file = path.join(o.userData, 'engines.json');
  }

  start(): void {
    if (this.timers.length) return;
    this.timers.push(setInterval(() => this.idleTick(), IDLE_CHECK_MS));
    // the first sweep soon after the start (the window is up by then): it finds what a killed or crashed run left
    this.timers.push(setTimeout(() => void this.sweep(), FIRST_SWEEP_MS));
    this.timers.push(setInterval(() => void this.sweep(), SWEEP_EVERY_MS));
    for (const t of this.timers) t.unref();
  }

  stop(): void { for (const t of this.timers) clearInterval(t); this.timers = []; }

  idleTick(): number {
    this.touch();
    void this.o.spareLeased?.();
    const min = this.o.idleMin();
    return min > 0 ? this.o.releaseIdle(min * 60_000) : 0;
  }

  /** An engine just spawned (jobGuard.onAdd): engines.json has it at once, before any sweep. */
  noteSpawn(pid: number, chatId: string): void { this.touch({ pid, chatId }); }

  /** touchRoots on the file, without a process list; a root noted while a sweep lists is kept (sweepOnce listedAt). */
  private touch(spawned?: { pid: number; chatId: string }): void {
    let live: SweepOwners['live'];
    try { live = this.o.owners().live; } catch { return; }
    const before = this.load();
    const roots = touchRoots(before, live, Date.now(), RUN, spawned);
    if (!spawned && JSON.stringify(roots) === JSON.stringify(before)) return;
    try { fs.writeFileSync(this.file, JSON.stringify(roots)); } catch (e) { log.warn('chats', 'engines.json not written', { data: String(e) }); }
  }

  private load(): EngineRoot[] {
    try {
      const v = JSON.parse(fs.readFileSync(this.file, 'utf8')) as unknown;
      return Array.isArray(v) ? (v as EngineRoot[]).filter(r => Number.isInteger(r?.pid) && Number.isFinite(r?.created) && typeof r?.chatId === 'string' && typeof r?.run === 'string') : [];
    } catch { return []; }
  }

  /** One sweep now; resolves with the orphans killed (null: the process list could not be read, or one is running). */
  async sweep(): Promise<number | null> {
    if (this.running) return null;
    this.running = true;
    const t0 = Date.now();
    try {
      const procs = await (this.o.list ?? listProcesses)();
      if (!procs) { log.warn('chats', 'orphan sweep skipped: process list unavailable', { cause: 'Get-CimInstance Win32_Process failed or timed out', hint: 'the next sweep tries again; npm run doctor' }); return null; }
      // the file is read after the list: an engine noted while WMI ran is kept, and judged by the next sweep
      const { roots, orphans } = sweepOnce(this.load(), procs, this.o.owners(), Date.now(), RUN, t0);
      const kill = this.o.kill ?? ((pid: number) => process.kill(pid));
      let killed = 0;
      for (const p of orphans) {
        try { kill(p.pid); killed++; log.info('chats', 'orphan killed', { data: { pid: p.pid, name: p.name ?? '?', reason: p.reason } }); } catch { /* gone */ }
      }
      try { fs.writeFileSync(this.file, JSON.stringify(roots)); } catch (e) { log.warn('chats', 'engines.json not written', { data: String(e) }); }
      log.info('chats', 'orphan sweep', {
        data: { ms: Date.now() - t0, roots: roots.length, live: roots.filter(r => r.exited === null).length, orphans: orphans.length, killed, procs: procs.length, counts: countByName(procs), ...(orphans.length ? { killedProcs: orphans.slice(0, 30).map(p => `${p.pid} ${p.name ?? '?'} (${p.reason})`) } : {}) },
      });
      return killed;
    } finally { this.running = false; }
  }
}
