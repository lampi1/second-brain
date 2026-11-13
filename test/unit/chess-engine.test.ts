// The chess engine's service (ADR 0304, src/main/chess/engine.ts) against a fake process: started at the first move,
// the request sent after `readyok`, one answer per request, a newer request supersedes, the timeout and the idle stop
// (fake timers), a process that dies or is missing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChessEngine, GRACE_MS, IDLE_MS, type EngineProc } from '../../src/main/chess/engine';
import { CHESS_BOTS } from '../../src/shared/chess';

class FakeProc implements EngineProc {
  written: string[] = [];
  killed = false;
  private line: (l: string) => void = () => {};
  private exit: (c: string) => void = () => {};
  write(l: string) { this.written.push(l); }
  onLine(fn: (l: string) => void) { this.line = fn; }
  onExit(fn: (c: string) => void) { this.exit = fn; }
  kill() { this.killed = true; }
  say(l: string) { this.line(l); }
  die() { this.exit('exit code 1'); }
}
const setup = () => {
  const procs: FakeProc[] = [];
  const engine = new ChessEngine({ start: () => { const p = new FakeProc(); procs.push(p); return p; } });
  return { engine, procs };
};

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('the chess engine', () => {
  it('starts at the first move, waits for readyok, answers the move', async () => {
    const { engine, procs } = setup();
    expect(engine.running).toBe(false);
    const reply = engine.move({ bot: 'sentinel', moves: ['e2e4'] });
    expect(procs.length).toBe(1);
    const p = procs[0]!;
    expect(p.written).toEqual(['uci', 'isready']);
    p.say('id name Stockfish'); p.say('uciok');
    expect(p.written.length).toBe(2);
    p.say('readyok');
    expect(p.written.slice(2)).toEqual(['ucinewgame', 'setoption name UCI_LimitStrength value true', 'setoption name UCI_Elo value 1700', 'position startpos moves e2e4', 'go movetime 700']);
    p.say('info depth 1 score cp 10 pv e7e5');
    p.say('bestmove e7e5 ponder g1f3');
    expect(await reply).toEqual({ move: 'e7e5' });
    expect(engine.running).toBe(true);
  });
  it('reuses the running process and writes at once', async () => {
    const { engine, procs } = setup();
    const first = engine.move({ bot: 'scout', moves: [] });
    procs[0]!.say('readyok'); procs[0]!.say('bestmove e2e4');
    await first;
    const second = engine.move({ bot: 'scout', moves: ['e2e4', 'e7e5'] });
    expect(procs.length).toBe(1);
    expect(procs[0]!.written.slice(-2)).toEqual(['position startpos moves e2e4 e7e5', 'go movetime 200 depth 1']);
    procs[0]!.say('bestmove g1f3');
    expect(await second).toEqual({ move: 'g1f3' });
  });
  it('refuses what is not a request, without starting anything', async () => {
    const { engine, procs } = setup();
    for (const bad of [null, {}, { bot: 'nobody', moves: [] }, { bot: 'scout', moves: ['quit'] }, { bot: 'scout', moves: 'e2e4' }]) expect(await engine.move(bad)).toEqual({ move: null, error: 'bad-request' });
    expect(procs.length).toBe(0);
  });
  it('a newer request supersedes the one in flight on a fresh process', async () => {
    const { engine, procs } = setup();
    const old = engine.move({ bot: 'scout', moves: [] });
    procs[0]!.say('readyok');
    const next = engine.move({ bot: 'herald', moves: ['d2d4'] });
    expect(await old).toEqual({ move: null, error: 'superseded' });
    expect(procs[0]!.killed).toBe(true);
    expect(procs.length).toBe(2);
    procs[0]!.say('bestmove e2e4'); // the old process's late answer is not the new request's
    procs[1]!.say('readyok'); procs[1]!.say('bestmove d7d5');
    expect(await next).toEqual({ move: 'd7d5' });
  });
  it('gives up on a silent engine and starts again at the next move', async () => {
    const { engine, procs } = setup();
    const reply = engine.move({ bot: 'artisan', moves: [] });
    procs[0]!.say('readyok');
    vi.advanceTimersByTime(CHESS_BOTS.artisan.moveMs + GRACE_MS);
    expect(await reply).toEqual({ move: null, error: 'timeout' });
    expect(procs[0]!.killed).toBe(true);
    expect(engine.running).toBe(false);
    void engine.move({ bot: 'artisan', moves: [] });
    expect(procs.length).toBe(2);
  });
  it('says so when the process dies during a move or the game has no move', async () => {
    const { engine, procs } = setup();
    const reply = engine.move({ bot: 'artisan', moves: [] });
    procs[0]!.die();
    expect(await reply).toEqual({ move: null, error: 'failed' });
    expect(engine.running).toBe(false);
    const none = engine.move({ bot: 'artisan', moves: ['e2e4'] });
    procs[1]!.say('readyok'); procs[1]!.say('bestmove (none)');
    expect(await none).toEqual({ move: null, error: 'failed' });
  });
  it('stops after the idle time and when the page closes', async () => {
    const { engine, procs } = setup();
    const reply = engine.move({ bot: 'scout', moves: [] });
    procs[0]!.say('readyok'); procs[0]!.say('bestmove e2e4');
    await reply;
    vi.advanceTimersByTime(IDLE_MS - 1);
    expect(engine.running).toBe(true);
    vi.advanceTimersByTime(1);
    expect(engine.running).toBe(false);
    expect(procs[0]!.written.at(-1)).toBe('quit');
    expect(procs[0]!.killed).toBe(true);
    const flying = engine.move({ bot: 'scout', moves: [] });
    engine.stop();
    expect(await flying).toEqual({ move: null, error: 'superseded' });
    expect(procs[1]!.killed).toBe(true);
    expect(engine.running).toBe(false);
  });
  it('answers «missing» when the engine is not there or does not start', async () => {
    expect(await new ChessEngine({ start: () => null }).move({ bot: 'scout', moves: [] })).toEqual({ move: null, error: 'missing' });
    expect(await new ChessEngine({ start: () => { throw new Error('spawn ENOENT'); } }).move({ bot: 'scout', moves: [] })).toEqual({ move: null, error: 'missing' });
  });
});
