// Claude engines started ahead of time for the next new chat or role chat. Why: measured 2026-10-13 (bench-claude-start.mjs),
// a new Claude chat waits 10-25 s before the first token, almost all of it the CLI's own start-up (settings, CLAUDE.md
// / AGENTS.md, MCP servers and claude.ai connectors), the same with `claude -p` in a terminal; on an engine already up
// the first token comes after ~1 s of engine work plus the model's own latency. So a plain engine and one launched like
// the last role chat (its tools, skills plugin, context window) wait, idle, in the folder of the last new chat; the next
// new Claude chat in that folder launched the same way adopts one (its id, session id and MCP endpoint were chosen for
// it at spawn) and only sends its model / effort / permission mode / title as control requests.
// No model call happens before the user's message: a waiting engine spends no tokens. Who: ChatManager (create,
// shutdown); BufferedSink holds what the engine reports before a chat owns it, then replays it in order.
import { timersFor } from '../timers';
const { setTimeout, clearTimeout } = timersFor('chats/warm');
import path from 'node:path';
import { log } from '../log';
import type { HarnessSession, SessionSink } from './session';
import type { AgentPolicy } from '../agents/tool-policy';

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

/** How a waiting engine is launched: nothing for a plain chat; a role's tool policy, ceiling, skills plugin and context
 *  window for a role chat (these are fixed when the process starts, so a role takes only an engine launched like it). */
export interface WarmLaunch {
  /** '' = a plain chat; else a digest of the fields below (ChatManager launchSig) */
  sig: string;
  toolPolicy?: AgentPolicy['tools'];
  ceiling?: AgentPolicy['ceiling'];
  agentAssets?: { pluginDir: string; skillRoot: string };
  compactWindowTokens?: number;
  /** what the chat endpoint answers for the engine before a chat owns it (its tool list is read once, at start): the
   *  role's catalog id and the roles it may launch (null = unknown) */
  view?: { role: string | null; launches: string[] | null };
}
export const PLAIN_LAUNCH: WarmLaunch = { sig: '' };

export interface WarmEngine {
  /** the chat id the engine was started for (its MCP endpoint names it) */
  chatId: string;
  sessionId: string;
  cwd: string;
  session: HarnessSession;
  sink: BufferedSink;
  at: number;
  /** how it was launched (absent = plain) */
  launch?: WarmLaunch;
}

export interface WarmPoolOptions {
  /** starts an engine in cwd, launched as `launch` (null: could not) */
  spawn(cwd: string, launch: WarmLaunch): WarmEngine | null;
  /** false = never start one (quitting, turned off) */
  enabled(): boolean;
  /** an engine older than this is replaced, so settings and CLAUDE.md edits reach the next chat (default 30 min) */
  maxAgeMs?: number;
  /** engines waiting at once, all in one folder (default 2: a plain one and the last role's) */
  maxSlots?: number;
}

/** Same folder? Windows paths compare case-insensitively, trailing separators ignored. */
export function sameDir(a: string, b: string): boolean {
  const n = (p: string): string => {
    const r = path.resolve(p).replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  return n(a) === n(b);
}

interface Slot { engine: WarmEngine; recycle: NodeJS.Timeout | null; usedAt: number }

/** A few waiting engines in the folder of the last new chat, one per launch (memory: each is an idle claude.exe and its
 *  MCP servers). Before 2026-10-20 the pool held one plain engine, which no role chat could take (every role has a tool
 *  policy since ADR 0085), so every delegated job paid the 10-25 s cold start. */
export class WarmPool {
  private slots: Slot[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly o: WarmPoolOptions) {}

  /** The most recently started waiting engine, if any. */
  get current(): WarmEngine | null { return this.slots.at(-1)?.engine ?? null; }
  /** Every waiting engine (shutdown kills them with the chats; the orphan sweep counts them as live). */
  get engines(): WarmEngine[] { return this.slots.map(x => x.engine); }
  /** Is chatId a waiting engine's chat (its chat does not exist yet)? */
  has(chatId: string): boolean { return this.slots.some(x => x.engine.chatId === chatId); }

  /** A waiting engine in cwd launched as `launch`, after delayMs (a new chat's own start-up runs first, undisturbed). */
  schedule(cwd: string, delayMs = 5000, launch: WarmLaunch = PLAIN_LAUNCH): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.fill(cwd, launch); }, delayMs);
    this.timer.unref?.();
  }

  /** Starts one in cwd now, unless one alive launched the same way already waits there. A new folder closes the others. */
  fill(cwd: string, launch: WarmLaunch = PLAIN_LAUNCH): void {
    if (!this.o.enabled()) return;
    const same = this.slots.find(x => sameDir(x.engine.cwd, cwd) && (x.engine.launch?.sig ?? '') === launch.sig);
    if (same && same.engine.session.alive) { same.usedAt = Date.now(); return; }
    if (same) this.drop(same, 'dead');
    for (const x of this.slots.filter(x => !sameDir(x.engine.cwd, cwd))) this.drop(x, 'another folder');
    while (this.slots.length >= Math.max(1, this.o.maxSlots ?? 2)) this.drop([...this.slots].sort((a, b) => a.usedAt - b.usedAt)[0]!, 'pool full');
    let next: WarmEngine | null = null;
    try { next = this.o.spawn(cwd, launch); } catch (e) { log.warn('chats', 'warm engine not started', { data: { cwd, error: String(e) } }); }
    // a start that failed at once (folder gone, no engine) already reported its exit: never kept, never recycled
    if (!next || !next.session.alive) return;
    const mine: Slot = { engine: { ...next, launch }, recycle: null, usedAt: Date.now() };
    this.slots.push(mine);
    // a warm engine that dies (no login, a bad folder) is not replaced until the next new chat: never a restart loop
    mine.engine.sink.onOrphanExit = () => { if (this.slots.includes(mine)) { this.forget(mine); log.info('chats', 'warm engine exited before use', { chat: mine.engine.chatId }); } };
    mine.recycle = setTimeout(() => {
      if (!this.slots.includes(mine)) return;
      this.drop(mine, 'too old');
      this.fill(mine.engine.cwd, launch);
    }, this.o.maxAgeMs ?? 30 * 60_000);
    mine.recycle.unref?.();
    log.info('chats', 'warm engine started', { chat: mine.engine.chatId, data: { cwd, pid: mine.engine.session.pid, launch: launch.sig || 'plain' } });
  }

  /** The waiting engine alive in cwd and launched as `sig`; it leaves the pool (the caller owns it). */
  take(cwd: string, sig = ''): WarmEngine | null {
    const x = this.slots.find(x => sameDir(x.engine.cwd, cwd) && (x.engine.launch?.sig ?? '') === sig);
    if (!x || !x.engine.session.alive || x.engine.sink.attached) return null;
    this.forget(x);
    return x.engine;
  }

  /** Closes every waiting engine (no chat owns them: their MCP servers and hooks go with them). */
  discard(why: string): void {
    for (const x of [...this.slots]) this.drop(x, why);
  }

  /** Quit: nothing new starts; the caller kills `engines` with the chats. */
  stop(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    for (const x of this.slots) if (x.recycle) { clearTimeout(x.recycle); x.recycle = null; }
  }

  private forget(x: Slot): void {
    if (x.recycle) clearTimeout(x.recycle);
    this.slots = this.slots.filter(y => y !== x);
  }

  private drop(x: Slot, why: string): void {
    this.forget(x);
    log.info('chats', 'warm engine closed', { chat: x.engine.chatId, data: { why } });
    x.engine.sink.onOrphanExit = null;
    void x.engine.session.close();
  }
}
