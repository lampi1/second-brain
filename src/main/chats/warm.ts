// A Claude engine started ahead of time for the next "Nuova chat". Why: measured 2026-10-13 (bench-claude-start.mjs),
// a new Claude chat waits 10-25 s before the first token, almost all of it the CLI's own start-up (settings, CLAUDE.md
// / AGENTS.md, MCP servers and claude.ai connectors), the same with `claude -p` in a terminal; on an engine already up
// the first token comes after ~1 s of engine work plus the model's own latency. So one engine waits, idle, in the
// folder of the last new chat; the next new Claude chat in that folder adopts it (its id, session id and MCP endpoint
// were chosen for it at spawn) and only sends its model / effort / permission mode / title as control requests.
// No model call happens before the user's message: a waiting engine spends no tokens. Who: ChatManager (create,
// shutdown); BufferedSink holds what the engine reports before a chat owns it, then replays it in order.
import path from 'node:path';
import { log } from '../log';
import type { HarnessSession, SessionSink } from './session';

/** Collects a session's reports until a chat attaches, then forwards them (replayed in arrival order). */
export class BufferedSink implements SessionSink {
  private target: SessionSink | null = null;
  private queue: ((s: SessionSink) => void)[] = [];
  /** the engine ended while nobody owned it */
  onOrphanExit: (() => void) | null = null;

  get attached(): boolean { return !!this.target; }

  attach(target: SessionSink): void {
    this.target = target;
    for (const f of this.queue.splice(0)) f(target);
  }

  private to(f: (s: SessionSink) => void): void {
    if (this.target) f(this.target); else this.queue.push(f);
  }

  item: SessionSink['item'] = (item, replace) => this.to(s => s.item(item, replace));
  pending: SessionSink['pending'] = req => this.to(s => s.pending(req));
  resolved: SessionSink['resolved'] = id => this.to(s => s.resolved(id));
  changed: SessionSink['changed'] = patch => this.to(s => s.changed(patch));
  rateLimit: NonNullable<SessionSink['rateLimit']> = msg => this.to(s => s.rateLimit?.(msg));
  models: NonNullable<SessionSink['models']> = list => this.to(s => s.models?.(list));
  commands: NonNullable<SessionSink['commands']> = list => this.to(s => s.commands?.(list));
  children: NonNullable<SessionSink['children']> = observation => this.to(s => s.children?.(observation));
  childrenCoverage: NonNullable<SessionSink['childrenCoverage']> = (coverage, reason) => this.to(s => s.childrenCoverage?.(coverage, reason));
  exit: SessionSink['exit'] = info => {
    if (!this.target) { this.queue = []; this.onOrphanExit?.(); return; }
    this.target.exit(info);
  };
}

export interface WarmEngine {
  /** the chat id the engine was started for (its MCP endpoint names it) */
  chatId: string;
  sessionId: string;
  cwd: string;
  session: HarnessSession;
  sink: BufferedSink;
  at: number;
}

export interface WarmPoolOptions {
  /** starts an engine in cwd (null: could not) */
  spawn(cwd: string): WarmEngine | null;
  /** false = never start one (quitting, turned off) */
  enabled(): boolean;
  /** an engine older than this is replaced, so settings and CLAUDE.md edits reach the next chat (default 30 min) */
  maxAgeMs?: number;
}

/** Same folder? Windows paths compare case-insensitively, trailing separators ignored. */
export function sameDir(a: string, b: string): boolean {
  const n = (p: string): string => {
    const r = path.resolve(p).replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  return n(a) === n(b);
}

/** One waiting engine at most (memory: one idle claude.exe and its MCP servers). */
export class WarmPool {
  private slot: WarmEngine | null = null;
  private timer: NodeJS.Timeout | null = null;
  private recycle: NodeJS.Timeout | null = null;

  constructor(private readonly o: WarmPoolOptions) {}

  /** The waiting engine, if any (shutdown kills it with the chats). */
  get current(): WarmEngine | null { return this.slot; }

  /** A waiting engine in cwd, after delayMs (a new chat's own start-up runs first, undisturbed). */
  schedule(cwd: string, delayMs = 5000): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.fill(cwd); }, delayMs);
    this.timer.unref?.();
  }

  /** Starts one in cwd now, unless one alive already waits there. */
  fill(cwd: string): void {
    if (!this.o.enabled()) return;
    const w = this.slot;
    if (w && w.session.alive && sameDir(w.cwd, cwd)) return;
    this.discard('another folder');
    let next: WarmEngine | null = null;
    try { next = this.o.spawn(cwd); } catch (e) { log.warn('chats', 'warm engine not started', { data: { cwd, error: String(e) } }); }
    // a start that failed at once (folder gone, no engine) already reported its exit: never kept, never recycled
    if (!next || !next.session.alive) return;
    const mine = next;
    this.slot = mine;
    // a warm engine that dies (no login, a bad folder) is not replaced until the next new chat: never a restart loop
    mine.sink.onOrphanExit = () => { if (this.slot === mine) { this.slot = null; this.clearRecycle(); log.info('chats', 'warm engine exited before use', { chat: mine.chatId }); } };
    this.clearRecycle();
    this.recycle = setTimeout(() => {
      if (this.slot !== mine) return;
      this.discard('too old');
      this.fill(mine.cwd);
    }, this.o.maxAgeMs ?? 30 * 60_000);
    this.recycle.unref?.();
    log.info('chats', 'warm engine started', { chat: mine.chatId, data: { cwd, pid: mine.session.pid } });
  }

  /** The waiting engine if it is alive and in cwd; it leaves the pool (the caller owns it). */
  take(cwd: string): WarmEngine | null {
    const w = this.slot;
    if (!w || !w.session.alive || !sameDir(w.cwd, cwd) || w.sink.attached) return null;
    this.slot = null;
    this.clearRecycle();
    return w;
  }

  /** Closes the waiting engine (no chat owns it: its MCP servers and hooks go with it). */
  discard(why: string): void {
    const w = this.slot;
    this.slot = null;
    this.clearRecycle();
    if (!w) return;
    log.info('chats', 'warm engine closed', { chat: w.chatId, data: { why } });
    w.sink.onOrphanExit = null;
    void w.session.close(1000);
  }

  /** Quit: nothing new starts; the caller kills `current` with the chats. */
  stop(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.clearRecycle();
  }

  private clearRecycle(): void {
    if (this.recycle) { clearTimeout(this.recycle); this.recycle = null; }
  }
}
