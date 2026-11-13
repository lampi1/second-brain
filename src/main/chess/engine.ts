// The chess engine of the Scacchi page (ADR 0304): Stockfish, the unmodified GPLv3 program in vendor/stockfish, run
// as its own process (Electron as plain Node) and spoken to only in UCI text over its pipes; nothing of it is
// loaded into the app. It costs nothing until a game asks for a move: the process starts at the first request, runs
// below normal priority (the window always goes first), keeps no game of its own (each request carries the whole move
// list) and is stopped when the page closes, after IDLE_MS without a request and when the app quits.
// One request at a time: a newer one supersedes the one in flight (a new game while the bot thinks).
// Used by ipc-handlers/chess.ts; built by index.ts. Tests: test/unit/chess-engine.test.ts (a fake process); the e2e
// tests play a written game (scriptedProc).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CHESS_BOTS, bestMove, cleanMoves, goLines, isChessBot, type ChessMoveReply } from '../../shared/chess';
import { errText, log } from '../log';

/** The engine's process as the service sees it. */
export interface EngineProc {
  write(line: string): void;
  onLine(fn: (line: string) => void): void;
  onExit(fn: (cause: string) => void): void;
  kill(): void;
}
export interface ChessEngineDeps {
  /** starts the process; null = the engine is not there */
  start: () => EngineProc | null;
  idleMs?: number;
  /** past the bot's own thinking time, how long a move may take before the engine is given up on */
  graceMs?: number;
}

/** No request for this long: the process ends (a game left open costs nothing). */
export const IDLE_MS = 180_000;
/** A move not answered this long after its thinking time: the engine is killed and the page told. */
export const GRACE_MS = 15_000;

interface Pending { done: (r: ChessMoveReply) => void; timer: ReturnType<typeof setTimeout> }

export class ChessEngine {
  private proc: EngineProc | null = null;
  private ready = false;
  /** the lines of the request waiting for `readyok` */
  private queued: string[] | null = null;
  private pending: Pending | null = null;
  private idle: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly d: ChessEngineDeps) {}

  /** Whether a process is running now (app_state, tests). */
  get running(): boolean { return !!this.proc; }

  /** The move of `bot` after `moves` (UCI, from the start position). */
  move(a: unknown): Promise<ChessMoveReply> {
    const req = a && typeof a === 'object' ? a as { bot?: unknown; moves?: unknown } : {};
    const moves = cleanMoves(req.moves);
    if (!isChessBot(req.bot) || !moves) return Promise.resolve({ move: null, error: 'bad-request' });
    const bot = CHESS_BOTS[req.bot];
    // a search in flight answers for the old position: the process is dropped, the next one starts clean
    if (this.pending) { this.settle({ move: null, error: 'superseded' }); this.end(); }
    if (this.idle) { clearTimeout(this.idle); this.idle = null; }
    const proc = this.proc ?? this.launch();
    if (!proc) return Promise.resolve({ move: null, error: 'missing' });
    return new Promise<ChessMoveReply>(done => {
      const timer = setTimeout(() => {
        log.warn('chess', 'the engine did not answer', { data: { bot: bot.id, plies: moves.length }, hint: 'the engine was stopped; the next move starts it again' });
        this.settle({ move: null, error: 'timeout' }); this.end();
      }, bot.moveMs + (this.d.graceMs ?? GRACE_MS));
      this.pending = { done, timer };
      const lines = goLines(bot, moves);
      if (this.ready) for (const l of lines) proc.write(l); else this.queued = lines;
    });
  }

  private launch(): EngineProc | null {
    let proc: EngineProc | null = null;
    try { proc = this.d.start(); } catch (e) {
      log.error('chess', 'the chess engine did not start', { cause: errText(e), hint: 'Scacchi cannot play; the rest of the app is not affected. npm run build copies vendor/stockfish to out/chess-engine' });
    }
    if (!proc) return null;
    this.proc = proc; this.ready = false; this.queued = null;
    proc.onLine(line => { if (this.proc === proc) this.onLine(line); });
    proc.onExit(cause => {
      if (this.proc !== proc) return;
      this.proc = null; this.ready = false; this.queued = null;
      if (this.pending) {
        log.warn('chess', 'the engine stopped during a move', { cause, hint: 'the next move starts it again' });
        this.settle({ move: null, error: 'failed' });
      }
    });
    proc.write('uci');
    proc.write('isready');
    return proc;
  }

  private onLine(line: string): void {
    if (!this.ready) {
      if (line.trim() !== 'readyok') return;
      this.ready = true;
      const lines = this.queued; this.queued = null;
      if (lines) for (const l of lines) this.proc?.write(l);
      return;
    }
    const move = bestMove(line);
    if (move === null || !this.pending) return;
    this.settle(move ? { move } : { move: null, error: 'failed' });
    this.idle = setTimeout(() => { this.idle = null; this.end(); }, this.d.idleMs ?? IDLE_MS);
  }

  private settle(r: ChessMoveReply): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    clearTimeout(p.timer);
    p.done(r);
  }

  private end(): void {
    const proc = this.proc;
    this.proc = null; this.ready = false; this.queued = null;
    if (proc) { try { proc.write('quit'); } catch { /* its pipe is gone */ } proc.kill(); }
  }

  /** The page closed, or the app quits: nothing keeps running. A move in flight is answered «superseded». */
  stop(): void {
    if (this.idle) { clearTimeout(this.idle); this.idle = null; }
    this.settle({ move: null, error: 'superseded' });
    this.end();
  }
}

/** A stand-in engine that plays a written game (the e2e tests, SB_CHESS_SCRIPT under SB_TEST): asked for the move
 *  after n plies it answers the n-th of `script`, «(none)» past its end. It speaks UCI like the real one, in process. */
export function scriptedProc(script: readonly string[]): EngineProc {
  const lines: ((line: string) => void)[] = [];
  let plies = 0;
  const say = (line: string) => queueMicrotask(() => { for (const fn of lines) fn(line); });
  return {
    write: line => {
      if (line === 'isready') say('readyok');
      else if (line.startsWith('position ')) plies = / moves /.test(line) ? line.split(' moves ')[1]!.trim().split(/\s+/).length : 0;
      else if (line.startsWith('go')) say(`bestmove ${script[plies] ?? '(none)'}`);
    },
    onLine: fn => { lines.push(fn); },
    onExit: () => { /* it never ends by itself */ },
    kill: () => { lines.length = 0; },
  };
}

/** The engine's two files as the build leaves them in out/chess-engine (scripts/build.mjs, from vendor/stockfish). */
export const ENGINE_JS = 'stockfish-19-lite-single.js';
export const ENGINE_WASM = 'stockfish-19-lite-single.wasm';

/** Starts Stockfish as its own process: Electron's binary as plain Node running the engine's script, UCI on its
 *  pipes. Null when the script is not there. */
export function spawnStockfish(script: string): EngineProc | null {
  const missing = [script, path.join(path.dirname(script), ENGINE_WASM)].find(f => !fs.existsSync(f));
  if (missing) {
    log.error('chess', 'the chess engine is missing', { cause: `no file ${missing}`, hint: 'npm run build copies vendor/stockfish to out/chess-engine; Scacchi cannot play until then' });
    return null;
  }
  const child = spawn(process.execPath, [script], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  // listened to from the first moment: a start that fails (no more file handles) must never be an unhandled 'error'
  let failed: string | null = null;
  const exits: ((cause: string) => void)[] = [];
  const tell = (cause: string) => { if (failed === null) { failed = cause; for (const fn of exits) fn(cause); } };
  child.once('error', e => tell(errText(e)));
  child.once('exit', (code, signal) => tell(signal ? `signal ${signal}` : `exit code ${code}`));
  if (!child.stdout || !child.stdin) {
    log.error('chess', 'the chess engine did not start', { cause: failed ?? 'no pipes to the process', hint: 'Scacchi asks again at the next move' });
    try { child.kill(); } catch { /* never started */ }
    return null;
  }
  // thinking never takes the CPU from the window (the engine uses one core at most)
  if (child.pid) { try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* it runs at normal priority */ } }
  let rest = '';
  const lines: ((line: string) => void)[] = [];
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    const parts = (rest + chunk).split(/\r?\n/);
    rest = parts.pop() ?? '';
    for (const l of parts) for (const fn of lines) fn(l);
  });
  child.stdin.on('error', () => { /* the process ended first: its exit says so */ });
  return {
    write: line => { if (child.stdin.writable) child.stdin.write(`${line}\n`); },
    onLine: fn => { lines.push(fn); },
    // told at once when it ended before anyone asked
    onExit: fn => { if (failed !== null) fn(failed); else exits.push(fn); },
    kill: () => { try { child.kill(); } catch { /* already gone */ } },
  };
}
