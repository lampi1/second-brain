// Chess against the agents (ADR 0304, src/shared/chess.ts): the six bots weakest first with the Orchestrator unlimited,
// the UCI lines of a move, the engine's answer, a finished game's shape, the history's records, the rows of wins and the clock.
import { describe, expect, it } from 'vitest';
import { CHESS_BOTS, CHESS_BOT_IDS, MAX_PLIES, bestMove, chessHistory, cleanGame, cleanMoves, clock, goLines, isChessBot, isRecord, isStreakRecord, STREAK_MIN, type ChessGame } from '../../src/shared/chess';
import { ROLE_IDS } from '../../src/shared/roles';

describe('the bots', () => {
  it('are the six roles, weakest first, the Orchestrator last and without a limit', () => {
    expect([...CHESS_BOT_IDS].sort()).toEqual([...ROLE_IDS].sort());
    const elos = CHESS_BOT_IDS.map(id => CHESS_BOTS[id].elo);
    expect(elos).toEqual([...elos].sort((a, b) => a - b));
    expect(new Set(elos).size).toBe(elos.length);
    const top = CHESS_BOTS[CHESS_BOT_IDS[CHESS_BOT_IDS.length - 1]!];
    expect(top.id).toBe('orchestrator');
    expect(top).toMatchObject({ open: true, uciElo: null, skill: 20, depth: 0, slip: 0 });
    expect(top.elo).toBeGreaterThanOrEqual(2200);
    for (const id of CHESS_BOT_IDS) {
      const b = CHESS_BOTS[id];
      expect(b.id).toBe(id);
      if (b.uciElo !== null) { expect(b.uciElo).toBeGreaterThanOrEqual(1320); expect(b.uciElo).toBeLessThanOrEqual(3190); expect(b.elo).toBe(b.uciElo); }
      expect(b.slip).toBeGreaterThanOrEqual(0); expect(b.slip).toBeLessThan(1);
    }
    expect(isChessBot('scout')).toBe(true);
    expect(isChessBot('router')).toBe(false);
    expect(isChessBot(3)).toBe(false);
  });
});

describe('the engine\'s lines', () => {
  it('limit a rated bot with UCI_Elo and send the whole game', () => {
    expect(goLines(CHESS_BOTS.sentinel, ['e2e4', 'e7e5', 'g1f3'])).toEqual([
      'setoption name UCI_LimitStrength value true', 'setoption name UCI_Elo value 1700',
      'position startpos moves e2e4 e7e5 g1f3', 'go movetime 700',
    ]);
  });
  it('start a new game on the first moves, cap the weakest bot\'s depth, leave the Orchestrator free', () => {
    expect(goLines(CHESS_BOTS.scout, [])).toEqual([
      'ucinewgame', 'setoption name UCI_LimitStrength value false', 'setoption name Skill Level value 0', 'position startpos', 'go movetime 200 depth 1',
    ]);
    expect(goLines(CHESS_BOTS.orchestrator, ['d2d4'])).toEqual([
      'ucinewgame', 'setoption name UCI_LimitStrength value false', 'setoption name Skill Level value 20', 'position startpos moves d2d4', 'go movetime 1200',
    ]);
  });
  it('accept UCI moves only', () => {
    expect(cleanMoves(['e2e4', 'a7a8q'])).toEqual(['e2e4', 'a7a8q']);
    expect(cleanMoves([])).toEqual([]);
    for (const bad of [null, 'e2e4', ['e2e4\nquit'], ['e2e9'], ['e2e4 '], [1], ['a7a8k'], Array.from({ length: MAX_PLIES + 1 }, () => 'e2e4')]) expect(cleanMoves(bad)).toBeNull();
  });
  it('read the answer', () => {
    expect(bestMove('bestmove e7e5 ponder d2d4')).toBe('e7e5');
    expect(bestMove('bestmove a7a8q')).toBe('a7a8q');
    expect(bestMove('bestmove (none)')).toBe('');
    expect(bestMove('info depth 3 score cp 20 pv e7e5')).toBeNull();
    expect(bestMove('readyok')).toBeNull();
  });
});

const game = (o: Partial<ChessGame>): ChessGame => ({ id: 1, at: 1000, bot: 'scout', color: 'w', result: 'win', ending: 'checkmate', moves: 20, ms: 120_000, undos: 0, ...o });

describe('a finished game', () => {
  it('is kept when its shape is a game\'s', () => {
    const g = { bot: 'herald', color: 'b', result: 'loss', ending: 'resign', moves: 12, ms: 90_000, undos: 2 };
    expect(cleanGame({ ...g, extra: 'x' })).toEqual(g);
    expect(cleanGame({ ...g, result: 'draw', ending: 'stalemate' })?.result).toBe('draw');
  });
  it('is refused otherwise', () => {
    const g = { bot: 'herald', color: 'b', result: 'win', ending: 'checkmate', moves: 12, ms: 90_000, undos: 0 };
    for (const bad of [null, 'x', { ...g, bot: 'router' }, { ...g, color: 'x' }, { ...g, result: 'won' }, { ...g, ending: 'timeout' }, { ...g, moves: -1 }, { ...g, moves: 1.5 }, { ...g, ms: 1e12 }, { ...g, undos: '0' },
      { ...g, result: 'draw' }, { ...g, ending: 'stalemate' }, { ...g, ending: 'resign' }]) expect(cleanGame(bad)).toBeNull();
  });
});

describe('the history', () => {
  it('counts per bot and keeps the fastest and the shortest clean win', () => {
    const h = chessHistory([
      game({ id: 1, ms: 200_000, moves: 18 }), game({ id: 2, ms: 150_000, moves: 25 }), game({ id: 3, ms: 90_000, moves: 30, undos: 1 }),
      game({ id: 4, result: 'loss' }), game({ id: 5, result: 'draw', ending: 'stalemate' }), game({ id: 6, bot: 'orchestrator', result: 'loss' }),
    ]);
    expect(h.total).toBe(6);
    expect(h.bots.scout).toMatchObject({ wins: 3, losses: 1, draws: 1 });
    expect(h.bots.scout.fastest?.id).toBe(2);
    expect(h.bots.scout.shortest?.id).toBe(1);
    expect(h.bots.orchestrator).toMatchObject({ wins: 0, losses: 1, draws: 0, fastest: null, shortest: null });
    expect(h.bots.herald).toMatchObject({ wins: 0, losses: 0, draws: 0 });
    expect(h.fastest.map(g => g.id)).toEqual([2, 1]);
  });
  it('lists the last games newest first and names a record', () => {
    const h = chessHistory([game({ id: 1, at: 10, ms: 100_000 }), game({ id: 2, at: 30, ms: 80_000 }), game({ id: 3, at: 20, ms: 300_000 })]);
    expect(h.recent.map(g => g.id)).toEqual([2, 3, 1]);
    expect(isRecord(game({ id: 2, ms: 80_000 }), h)).toBe(true);
    expect(isRecord(game({ id: 3, ms: 300_000 }), h)).toBe(false);
    expect(isRecord(game({ id: 2, result: 'loss' }), h)).toBe(false);
  });
  it('counts the wins in a row per bot: the current row and the longest; a loss or a draw ends it, a move taken back does not', () => {
    const h = chessHistory([
      // given out of order: the rows follow the ids
      game({ id: 3, undos: 2 }), game({ id: 1 }), game({ id: 2 }), game({ id: 4, result: 'loss' }), game({ id: 5 }), game({ id: 6 }),
      game({ id: 7, bot: 'herald' }), game({ id: 8, bot: 'herald', result: 'draw', ending: 'stalemate' }),
      game({ id: 9, bot: 'orchestrator', result: 'loss' }), // another bot's game does not end the Scout's row
    ]);
    expect(h.bots.scout).toMatchObject({ streak: 2, bestStreak: 3 });
    expect(h.bots.herald).toMatchObject({ streak: 0, bestStreak: 1 });
    expect(h.bots.orchestrator).toMatchObject({ streak: 0, bestStreak: 0 });
    expect(h.bots.artisan).toMatchObject({ streak: 0, bestStreak: 0 });
    // a record row: the last game is a win that makes the longest row, of two or more
    expect(isStreakRecord(game({ id: 6 }), h)).toBe(false); // 2 in a row, the best is 3
    const best = chessHistory([game({ id: 1 }), game({ id: 2 })]);
    expect(isStreakRecord(game({ id: 2 }), best)).toBe(true);
    expect(isStreakRecord(game({ id: 1 }), chessHistory([game({ id: 1 })]))).toBe(false); // one win is not a row
    expect(isStreakRecord(game({ id: 2, result: 'loss' }), best)).toBe(false);
    // a row that only equals the old record is not a new one; the game that passes it is
    const tie = [game({ id: 1 }), game({ id: 2 }), game({ id: 3, result: 'loss' }), game({ id: 4 }), game({ id: 5 })];
    expect(chessHistory(tie).bots.scout).toMatchObject({ streak: 2, bestStreak: 2, bestStreakId: 2 });
    expect(isStreakRecord(game({ id: 5 }), chessHistory(tie))).toBe(false);
    const past = chessHistory([...tie, game({ id: 6 })]);
    expect(isStreakRecord(game({ id: 6 }), past)).toBe(true);
    expect(past.bots.scout).toMatchObject({ streak: 3, bestStreak: 3, bestStreakId: 6 });
    expect(STREAK_MIN).toBe(2);
  });
  it('is empty without games', () => {
    const h = chessHistory([]);
    expect(h).toMatchObject({ total: 0, fastest: [], recent: [] });
    expect(Object.keys(h.bots).sort()).toEqual([...CHESS_BOT_IDS].sort());
  });
});

describe('the clock', () => {
  it('writes minutes and seconds, hours when there are', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(754_000)).toBe('12:34');
    expect(clock(3_723_000)).toBe('1:02:03');
    expect(clock(-5)).toBe('0:00');
  });
});
