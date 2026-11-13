// A whole game of the Scacchi page (ADR 0304, src/renderer/lib/chess-play.ts) with everything outside it faked: the
// engine's answers, the store, the clock, the random numbers and the pause. The user's move asks the bot, the bot's
// move comes after its pause, a mate is stored and may be a record, a move is taken back in pairs and makes the win
// no record, a resignation is a loss (or just the lobby before the first move), an engine that fails shows «Riprova»,
// leaving the page stops the engine and coming back asks again, an answer for an older game is dropped, a premove is
// played the moment the bot has moved (or dropped when it is not legal then).
import { describe, expect, it } from 'vitest';
import { chessHistory, type ChessGame, type ChessGameInput, type ChessMoveReply } from '../../src/shared/chess';
import { MIN_THINK_MS, createChessPlay, type ChessDeps } from '../../src/renderer/lib/chess-play';

interface Ask { bot: string; moves: string[]; answer: (r: ChessMoveReply) => void }
function setup(o: { rnd?: () => number } = {}) {
  const asks: Ask[] = [], waits: { ms: number; done: () => void }[] = [], saved: ChessGameInput[] = [], games: ChessGame[] = [];
  let stops = 0, t = 1000;
  const deps: ChessDeps = {
    move: a => new Promise(answer => { asks.push({ ...a, answer }); }),
    stop: async () => { stops++; },
    save: async g => { saved.push(g); const game = { ...g, id: games.length + 1, at: t }; games.push(game); return { game, history: chessHistory(games) }; },
    history: async () => chessHistory(games),
    now: () => t,
    rnd: o.rnd ?? (() => 0.99),
    lang: () => 'it',
    wait: ms => new Promise(done => { waits.push({ ms, done }); }),
  };
  const play = createChessPlay(deps);
  const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  /** The engine answers `uci` and the bot's pause ends. */
  const bot = async (uci: string) => {
    asks.at(-1)!.answer({ move: uci });
    await tick();
    waits.at(-1)!.done();
    await tick();
  };
  return { play, asks, waits, saved, games, tick, bot, get: play.store.get, stops: () => stops, at: (ms: number) => { t = ms; } };
}

describe('a game against a bot', () => {
  it('starts from the lobby\'s choice, white to move, with the opening line', () => {
    const g = setup();
    g.play.pick('artisan');
    g.play.setSide('w');
    g.play.start();
    expect(g.get()).toMatchObject({ view: 'game', bot: 'artisan', color: 'w', ucis: [], thinking: false, startedAt: null, outcome: null });
    expect(g.get().line?.text).toBeTruthy();
    expect(g.asks).toHaveLength(0);
  });
  it('the user\'s move asks the bot with the whole game; its move comes after its pause', async () => {
    const g = setup();
    g.play.pick('sentinel');
    g.play.start();
    expect(g.play.play('e2e5')).toBe(false); // not legal
    expect(g.play.play('e2e4')).toBe(true);
    expect(g.get()).toMatchObject({ ucis: ['e2e4'], thinking: true, startedAt: 1000 });
    expect(g.asks).toEqual([expect.objectContaining({ bot: 'sentinel', moves: ['e2e4'] })]);
    expect(g.play.play('d2d4')).toBe(false); // not the user's turn
    g.asks[0]!.answer({ move: 'e7e5' });
    await g.tick();
    expect(g.get().ucis).toEqual(['e2e4']); // still thinking on screen
    expect(g.waits[0]!.ms).toBe(MIN_THINK_MS);
    g.waits[0]!.done();
    await g.tick();
    expect(g.get()).toMatchObject({ ucis: ['e2e4', 'e7e5'], thinking: false, problem: null });
  });
  it('with black the bot opens, and the clock starts at its move', async () => {
    const g = setup();
    g.play.setSide('b');
    g.play.start();
    expect(g.get()).toMatchObject({ color: 'b', thinking: true, startedAt: null });
    expect(g.asks[0]!.moves).toEqual([]);
    g.at(5000);
    await g.bot('f2f3');
    expect(g.get()).toMatchObject({ ucis: ['f2f3'], thinking: false, startedAt: 5000 });
  });
  it('a random side comes from the dice', () => {
    const w = setup({ rnd: () => 0.2 }), b = setup({ rnd: () => 0.8 });
    w.play.setSide('random'); w.play.start();
    b.play.setSide('random'); b.play.start();
    expect(w.get().color).toBe('w');
    expect(b.get().color).toBe('b');
  });
  it('a mate is stored with the user\'s moves and time, and the first clean win is a record', async () => {
    const g = setup();
    g.play.pick('orchestrator');
    g.play.setSide('b');
    g.play.start();
    await g.bot('f2f3');
    g.play.play('e7e5');
    await g.bot('g2g4');
    g.at(31_000);
    expect(g.play.play('d8h4')).toBe(true);
    expect(g.get().outcome).toMatchObject({ result: 'win', ending: 'checkmate', moves: 2, ms: 30_000 });
    expect(g.asks).toHaveLength(2); // the bot is not asked after the mate
    await g.tick();
    expect(g.saved).toEqual([{ bot: 'orchestrator', color: 'b', result: 'win', ending: 'checkmate', moves: 2, ms: 30_000, undos: 0 }]);
    expect(g.get().outcome).toMatchObject({ record: true, streak: 1, streakRecord: false }); // one win is not a row
    expect(g.get().history?.bots.orchestrator.wins).toBe(1);
    expect(g.play.play('a7a6')).toBe(false); // the game is over
    // a slower win after it is no record
    g.play.start();
    g.at(40_000);
    await g.bot('f2f3');
    g.play.play('e7e5');
    await g.bot('g2g4');
    g.at(140_000);
    g.play.play('d8h4');
    await g.tick();
    // not the fastest, but two wins in a row: the longest row against this bot
    expect(g.get().outcome).toMatchObject({ result: 'win', ms: 100_000, record: false, streak: 2, streakRecord: true });
    expect(g.get().history?.bots.orchestrator).toMatchObject({ streak: 2, bestStreak: 2 });
  });
  it('the bot\'s mate is a loss', async () => {
    const g = setup();
    g.play.start();
    g.play.play('f2f3');
    await g.bot('e7e5');
    g.play.play('g2g4');
    await g.bot('d8h4');
    expect(g.get().outcome).toMatchObject({ result: 'loss', ending: 'checkmate', moves: 2 });
    await g.tick();
    expect(g.saved[0]).toMatchObject({ result: 'loss', color: 'w' });
    expect(g.get().outcome).toMatchObject({ streak: 0, streakRecord: false });
  });
  it('a move taken back removes the pair and makes the win no record', async () => {
    const g = setup();
    g.play.setSide('b');
    g.play.start();
    await g.bot('f2f3');
    g.play.undo(); // the bot's opening move stays
    expect(g.get()).toMatchObject({ ucis: ['f2f3'], undos: 0 });
    g.play.play('a7a6');
    await g.bot('g2g4');
    g.play.undo();
    expect(g.get()).toMatchObject({ ucis: ['f2f3'], undos: 1 });
    g.play.play('e7e5');
    await g.bot('g2g4');
    g.play.play('d8h4');
    await g.tick();
    expect(g.saved[0]).toMatchObject({ result: 'win', undos: 1 });
    expect(g.get().outcome?.record).toBe(false);
  });
  it('resigning is a loss once a move was played, just the lobby before', async () => {
    const g = setup();
    g.play.start();
    g.play.resign();
    expect(g.get().view).toBe('lobby');
    expect(g.saved).toHaveLength(0);
    g.play.start();
    g.play.play('e2e4');
    g.play.resign(); // while the bot thinks
    expect(g.get()).toMatchObject({ thinking: false, outcome: { result: 'loss', ending: 'resign', moves: 1 } });
    await g.tick();
    expect(g.saved).toEqual([expect.objectContaining({ result: 'loss', ending: 'resign' })]);
    // the engine's late answer changes nothing
    g.asks[0]!.answer({ move: 'e7e5' });
    await g.tick();
    expect(g.get().ucis).toEqual(['e2e4']);
    expect(g.waits).toHaveLength(0);
  });
  it('an engine that fails shows the problem and «Riprova» asks again', async () => {
    const g = setup();
    g.play.start();
    g.play.play('e2e4');
    g.asks[0]!.answer({ move: null, error: 'timeout' });
    await g.tick();
    expect(g.get()).toMatchObject({ thinking: false, problem: 'timeout', ucis: ['e2e4'] });
    g.play.retry();
    expect(g.get()).toMatchObject({ thinking: true, problem: null });
    await g.bot('e7e5');
    expect(g.get().ucis).toEqual(['e2e4', 'e7e5']);
    // a move that is not legal here is a failure, not a move
    g.play.play('g1f3');
    g.asks.at(-1)!.answer({ move: 'e7e5' });
    await g.tick();
    expect(g.get()).toMatchObject({ problem: 'failed', thinking: false });
  });
  it('leaving the page stops the engine and keeps the game; coming back asks the bot again', async () => {
    const g = setup();
    g.play.start();
    g.play.play('e2e4');
    const stops = g.stops();
    g.play.close();
    expect(g.stops()).toBe(stops + 1);
    g.asks[0]!.answer({ move: null, error: 'superseded' });
    await g.tick();
    expect(g.get()).toMatchObject({ view: 'game', ucis: ['e2e4'], thinking: false, problem: null });
    g.play.open();
    expect(g.asks).toHaveLength(2);
    await g.bot('c7c5');
    expect(g.get().ucis).toEqual(['e2e4', 'c7c5']);
  });
  it('an answer for an older game is dropped', async () => {
    const g = setup();
    g.play.start();
    g.play.play('e2e4');
    g.play.lobby();
    g.play.start();
    g.asks[0]!.answer({ move: 'e7e5' });
    await g.tick();
    expect(g.get()).toMatchObject({ ucis: [], thinking: false });
    expect(g.waits).toHaveLength(0);
  });
  it('a premove, made while the bot thinks, is played the moment the bot has moved', async () => {
    const g = setup();
    g.play.start();
    expect(g.play.premove('e2', 'e4')).toBe(false); // the user's own turn: just play
    g.play.play('e2e4');
    expect(g.play.premove('d2', 'd4')).toBe(true);
    expect(g.get().premove).toEqual({ from: 'd2', to: 'd4' });
    expect(g.get().ucis).toEqual(['e2e4']);
    await g.bot('e7e5');
    // played at once, and the bot is asked again
    expect(g.get()).toMatchObject({ ucis: ['e2e4', 'e7e5', 'd2d4'], premove: null, thinking: true });
    expect(g.asks.at(-1)!.moves).toEqual(['e2e4', 'e7e5', 'd2d4']);
  });
  it('a premove that is not legal after the bot\'s move is dropped; a new one replaces the old; it can be cancelled', async () => {
    const g = setup();
    g.play.start();
    g.play.play('e2e4');
    g.play.premove('e4', 'e5');
    g.play.premove('e4', 'e6'); // replaces
    expect(g.get().premove).toEqual({ from: 'e4', to: 'e6' });
    await g.bot('e7e5');
    expect(g.get()).toMatchObject({ ucis: ['e2e4', 'e7e5'], premove: null, thinking: false });
    g.play.play('g1f3');
    g.play.premove('f3', 'e5');
    g.play.cancelPremove();
    await g.bot('b8c6');
    expect(g.get()).toMatchObject({ ucis: ['e2e4', 'e7e5', 'g1f3', 'b8c6'], premove: null, thinking: false });
    expect(g.play.premove('f3', 'f3')).toBe(false);
  });
  it('a premove recaptures on a square the bot just took, and a pawn premoved to the last rank becomes a queen', async () => {
    const g = setup();
    g.play.start();
    g.play.play('e2e4');
    await g.bot('d7d5');
    g.play.play('b1c3');
    g.play.premove('c3', 'e4'); // the user's own pawn stands there now: the bot takes it first
    await g.bot('d5e4');
    expect(g.get().ucis).toEqual(['e2e4', 'd7d5', 'b1c3', 'd5e4', 'c3e4']);
    // 1.e4 a6 2.e5 d5 3.exd6 h6 4.dxc7 h5, then the premove c7xb8 with no piece named
    const p = setup();
    p.play.start();
    for (const [mine, theirs] of [['e2e4', 'a7a6'], ['e4e5', 'd7d5'], ['e5d6', 'h7h6']] as const) { p.play.play(mine); await p.bot(theirs); }
    p.play.play('d6c7');
    p.play.premove('c7', 'b8');
    await p.bot('h6h5');
    expect(p.get().ucis.at(-1)).toBe('c7b8q');
  });
  it('a premove that mates ends the game; one left at the end of the game is dropped', async () => {
    const g = setup();
    g.play.setSide('b');
    g.play.start();
    expect(g.play.premove('e7', 'e5')).toBe(true); // before the bot's opening move
    await g.bot('f2f3');
    expect(g.get().ucis).toEqual(['f2f3', 'e7e5']);
    g.play.premove('d8', 'h4');
    await g.bot('g2g4');
    expect(g.get().outcome).toMatchObject({ result: 'win', ending: 'checkmate' });
    expect(g.play.premove('a7', 'a6')).toBe(false);
    // the bot mates while a premove waits: it is dropped
    const l = setup();
    l.play.start();
    l.play.play('f2f3');
    await l.bot('e7e5');
    l.play.play('g2g4');
    l.play.premove('a2', 'a3');
    await l.bot('d8h4');
    expect(l.get()).toMatchObject({ premove: null, outcome: { result: 'loss' } });
  });
  it('the bot says something about what happens, and answers a pat', async () => {
    const g = setup();
    g.play.start();
    const n = g.get().line!.n;
    g.play.play('e2e4');
    await g.bot('d7d5');
    g.play.play('e4d5'); // a capture: the bot lost a pawn
    expect(g.get().line!.n).toBeGreaterThan(n);
    const before = g.get().line!;
    g.play.touch(1);
    expect(g.get().line!.n).toBe(before.n + 1);
    g.play.pick('scout'); // not in the lobby: nothing changes
    expect(g.get().bot).toBe('scout');
  });
});
