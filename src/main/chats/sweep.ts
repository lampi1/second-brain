// Zero-token housekeeping of the engines (ADR 0026), on timers in main:
// - every minute: chats idle for `engineIdleMin` release their engine (manager.releaseIdle; resumed on the next message);
// - every 15 minutes: the orphan sweep. Every engine seen running is remembered in <userData>/engines.json (pid, its
//   real creation time, its chat); once it is gone and its chat is no longer open (closed, archived, or the app that
//   ran it died), the tools still descending from it are killed (proctree.ts descendants: tools only, never a user's
//   program or what it started). The Job Object and the reap at exit catch almost everything; this is the net for what
//   escaped them: children born before the engine joined its job, engines of a run that crashed, a failed reap.
//   One log line per sweep with the counts, and the machine's process counts for the names that pile up.
// Kills use TerminateProcess (process.kill), never taskkill. Used by wiring.ts.
import { timersFor } from '../timers';
const { setInterval, clearInterval } = timersFor('chats/sweep');
import fs from 'node:fs';
import path from 'node:path';
import { log } from '../log';
import { descendants, listProcesses, type Proc } from './proctree';

/** run: which app run saw it (an engine of an earlier run has no owner any more, even if its chat reopened) */
export interface EngineRoot { pid: number; created: number; chatId: string; run: string; lastSeen: number; exited: number | null }

/** This app run. */
export const RUN = `${process.pid}-${Date.now()}`;
export interface SweepOwners { live: { chatId: string; pid: number }[]; open: string[] }

/** Roots forgotten this long after their engine ended: nothing of theirs is left by then, and pids get reused. */
export const ROOT_TTL_MS = 24 * 3600_000;
export const SWEEP_EVERY_MS = 15 * 60_000;
export const IDLE_CHECK_MS = 60_000;
/** Names counted in each sweep's log line (the ones that piled up on 2026-10-13). */
const COUNTED = ['claude.exe', 'node.exe', 'electron.exe', 'conhost.exe', 'bash.exe', 'cmd.exe', 'git.exe', 'taskkill.exe', 'powershell.exe', 'agent.exe'];

/** One sweep, pure: updates the roots from the process list and the owners; returns the orphans to kill. */
export function sweepOnce(roots: EngineRoot[], procs: readonly Proc[], owners: SweepOwners, now: number, run = RUN): { roots: EngineRoot[]; orphans: Proc[] } {
  const byPid = new Map(procs.map(p => [p.pid, p]));
  const out = new Map<string, EngineRoot>();
  const key = (r: { pid: number; created: number }): string => `${r.pid}:${r.created}`;
  for (const r of roots) out.set(key(r), { ...r });
  // running engines: (re)recorded with their real creation time
  const liveKeys = new Set<string>();
  for (const l of owners.live) {
    const p = byPid.get(l.pid);
    if (!p) continue;
    const k = key(p);
    liveKeys.add(k);
    out.set(k, { pid: p.pid, created: p.created, chatId: l.chatId, run, lastSeen: now, exited: null });
  }
  // gone: ended at the last time it was seen (conservative: a child born after that is not counted as its)
  for (const [k, r] of out) {
    if (liveKeys.has(k) || r.exited !== null) continue;
    const p = byPid.get(r.pid);
    if (!p || p.created !== r.created || r.run !== run) r.exited = r.lastSeen;
  }
  const open = new Set(owners.open);
  const orphans = new Map<number, Proc>();
  for (const r of out.values()) {
    // a kept engine's dev server stays while its chat is open in this run
    if (r.exited === null || (r.run === run && open.has(r.chatId))) continue;
    for (const p of descendants(procs, { pid: r.pid, created: r.created, exited: r.exited })) orphans.set(p.pid, p);
  }
  const kept = [...out.values()].filter(r => r.exited === null || now - r.exited < ROOT_TTL_MS);
  return { roots: kept, orphans: [...orphans.values()] };
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
    list?: typeof listProcesses;
    kill?: (pid: number) => void;
  }) {
    this.file = path.join(o.userData, 'engines.json');
  }

  start(): void {
    if (this.timers.length) return;
    this.timers.push(setInterval(() => this.idleTick(), IDLE_CHECK_MS));
    // the first sweep soon after the start: it finds what a crashed run left
    this.timers.push(setTimeout(() => void this.sweep(), 2 * 60_000));
    this.timers.push(setInterval(() => void this.sweep(), SWEEP_EVERY_MS));
    for (const t of this.timers) t.unref();
  }

  stop(): void { for (const t of this.timers) clearInterval(t); this.timers = []; }

  idleTick(): number {
    const min = this.o.idleMin();
    return min > 0 ? this.o.releaseIdle(min * 60_000) : 0;
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
      const { roots, orphans } = sweepOnce(this.load(), procs, this.o.owners(), Date.now());
      const kill = this.o.kill ?? ((pid: number) => process.kill(pid));
      let killed = 0;
      for (const p of orphans) { try { kill(p.pid); killed++; } catch { /* gone */ } }
      try { fs.writeFileSync(this.file, JSON.stringify(roots)); } catch (e) { log.warn('chats', 'engines.json not written', { data: String(e) }); }
      log.info('chats', 'orphan sweep', {
        data: { ms: Date.now() - t0, roots: roots.length, live: roots.filter(r => r.exited === null).length, orphans: orphans.length, killed, procs: procs.length, counts: countByName(procs), ...(orphans.length ? { killedProcs: orphans.slice(0, 30).map(p => `${p.pid} ${p.name ?? '?'}`) } : {}) },
      });
      return killed;
    } finally { this.running = false; }
  }
}
