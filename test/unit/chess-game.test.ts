// The rules side of the Scacchi page (ADR 0304, src/renderer/lib/chess-game.ts): a game replayed from its UCI moves
// keeps one id per piece through a capture, an en passant, a castling and a promotion; the legal targets, the
// promotion check, the endings (mate, stalemate, material, repetition), the material, the user's move count, the
// bot's move (the engine's, or a random legal one when it slips) and what the bot may comment.
import { describe, expect, it } from 'vitest';
import { CHESS_BOTS } from '../../src/shared/chess';
import { SWING, botMove, eventOf, isLegal, material, needsPromotion, position, resultFor, targets, uciOf, userMoves } from '../../src/renderer/lib/chess-game';

const game = (s: string) => position(s.split(' ').filter(Boolean));
const at = (s: string, sq: string) => game(s).pieces.find(p => p.square === sq);
/** 1.e4 a6 2.e5 d5 3.exd6 h6 4.dxc7 h5: white's pawn is on c7, about to promote on b8 or d8. */
const TO_C7 = 'e2e4 a7a6 e4e5 d7d5 e5d6 h7h6 d6c7 h6h5';

describe('position', () => {
  it('starts with 32 pieces, white to move, twenty legal moves', () => {
    const p = position([]);
    expect(p.pieces).toHaveLength(32);
    expect(new Set(p.pieces.map(x => x.id)).size).toBe(32);
    expect(p).toMatchObject({ turn: 'w', last: null, check: null, over: null });
    expect(p.legal).toHaveLength(20);
    expect(targets(p, 'e2').sort()).toEqual(['e3', 'e4']);
    expect(targets(p, 'e1')).toEqual([]);
  });
  it('keeps a piece\'s id as it moves and writes the moves as SAN', () => {
    const p = game('e2e4 e7e5 g1f3');
    expect(at('e2e4 e7e5 g1f3', 'f3')).toMatchObject({ id: 'wng', type: 'n', color: 'w' });
    expect(at('e2e4 e7e5 g1f3', 'e4')?.id).toBe('wpe');
    expect(p.sans).toEqual(['e4', 'e5', 'Nf3']);
    expect(p.turn).toBe('b');
    expect(p.last).toMatchObject({ from: 'g1', to: 'f3' });
  });
  it('en passant removes the pawn beside, not the one on the target square', () => {
    const s = 'e2e4 a7a6 e4e5 d7d5 e5d6';
    const p = game(s);
    expect(p.last?.isEnPassant()).toBe(true);
    expect(at(s, 'd6')?.id).toBe('wpe');
    expect(at(s, 'd5')).toBeUndefined();
    expect(p.pieces).toHaveLength(31);
    expect(p.taken.w).toEqual(['p']);
    expect(p.sans[4]).toBe('exd6');
  });
  it('castling moves the rook too, on both wings', () => {
    const k = 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 e1g1';
    expect(at(k, 'g1')?.id).toBe('wke');
    expect(at(k, 'f1')?.id).toBe('wrh');
    expect(game(k).sans[6]).toBe('O-O');
    const q = 'd2d4 d7d5 b1c3 b8c6 c1f4 c8f5 d1d2 d8d7 e1c1 e8c8';
    expect(at(q, 'c1')?.id).toBe('wke');
    expect(at(q, 'd1')?.id).toBe('wra');
    expect(at(q, 'c8')?.id).toBe('bke');
    expect(at(q, 'd8')?.id).toBe('bra');
  });
  it('a promotion needs its piece, and the pawn keeps its id as what it became', () => {
    const p = game(TO_C7);
    expect(needsPromotion(p, 'c7', 'b8')).toBe(true);
    expect(needsPromotion(p, 'g1', 'f3')).toBe(false);
    expect(uciOf(p, 'c7', 'b8')).toBeNull(); // no piece chosen yet
    expect(uciOf(p, 'c7', 'b8', 'n')).toBe('c7b8n');
    expect(uciOf(p, 'g1', 'f3')).toBe('g1f3');
    expect(uciOf(p, 'g1', 'g3')).toBeNull();
    expect(isLegal(p, 'c7b8q')).toBe(true);
    expect(isLegal(p, 'c7b8')).toBe(false);
    const s = `${TO_C7} c7b8q`;
    expect(at(s, 'b8')).toMatchObject({ id: 'wpe', type: 'q', color: 'w' });
    expect(game(s).sans.at(-1)).toBe('cxb8=Q');
    expect(game(s).taken.w).toEqual(['p', 'p', 'n']);
    // a queen for a pawn, and three captures: 8 + 1 + 1 + 3
    expect(material(game(s), 'w')).toBe(13);
    expect(material(game(s), 'b')).toBe(-13);
  });
  it('throws on a move that is not legal where it is played', () => {
    expect(() => position(['e2e5'])).toThrow();
  });
});

describe('the endings', () => {
  it('checkmate: the side that moved wins, the mated king is marked', () => {
    const p = game('f2f3 e7e5 g2g4 d8h4');
    expect(p.over).toEqual({ ending: 'checkmate', winner: 'b' });
    expect(p.check).toBe('e1');
    expect(p.legal).toHaveLength(0);
    expect(resultFor(p.over!.winner, 'b')).toBe('win');
    expect(resultFor(p.over!.winner, 'w')).toBe('loss');
    expect(resultFor(null, 'w')).toBe('draw');
  });
  it('threefold repetition is a draw', () => {
    const p = game('g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1 f6g8');
    expect(p.over).toEqual({ ending: 'repetition', winner: null });
  });
  it('stalemate is a draw (the shortest known game that ends in one)', () => {
    const p = game('e2e3 a7a5 d1h5 a8a6 h5a5 h7h5 h2h4 a6h6 a5c7 f7f6 c7d7 e8f7 d7b7 d8d3 b7b8 d3h7 b8c8 f7g6 c8e6');
    expect(p.over).toEqual({ ending: 'stalemate', winner: null });
    expect(p.check).toBeNull();
  });
  it('counts the user\'s own moves', () => {
    expect(userMoves(0, 'w')).toBe(0);
    expect(userMoves(3, 'w')).toBe(2);
    expect(userMoves(3, 'b')).toBe(1);
    expect(userMoves(4, 'b')).toBe(2);
  });
});

describe('the bot\'s move', () => {
  const start = position([]);
  it('is the engine\'s when the bot never slips, and null when that is not legal', () => {
    expect(botMove(CHESS_BOTS.orchestrator, 'e2e4', start, () => 0)).toBe('e2e4');
    expect(botMove(CHESS_BOTS.orchestrator, 'e2e5', start, () => 0)).toBeNull();
    expect(botMove(CHESS_BOTS.scout, 'e2e4', game('f2f3 e7e5 g2g4 d8h4'), () => 0)).toBeNull(); // nothing to play
  });
  it('is a random legal one when a weak bot slips', () => {
    const slipped = botMove(CHESS_BOTS.scout, 'e2e4', start, () => 0); // 0 < slip, then the first legal move
    expect(slipped).not.toBeNull();
    expect(isLegal(start, slipped!)).toBe(true);
    expect(botMove(CHESS_BOTS.scout, 'e2e4', start, () => 0.999)).toBe('e2e4');
    const last = botMove(CHESS_BOTS.scout, 'e2e4', start, (() => { let n = 0; return () => (n++ ? 0.999999 : 0); })());
    expect(isLegal(start, last!)).toBe(true);
  });
});

describe('what the bot may comment', () => {
  const never = () => 0.99, always = () => 0;
  it('says nothing before the first move and on a quiet one', () => {
    expect(eventOf(position([]), 'b', always)).toBeNull();
    expect(eventOf(game('e2e4'), 'b', always)).toBeNull();
  });
  it('names a capture from its side, with the piece', () => {
    const s = 'e2e4 d7d5 e4d5';
    expect(eventOf(game(s), 'b', never)).toEqual({ moment: 'lost', piece: 'p' });
    expect(eventOf(game(s), 'w', never)).toEqual({ moment: 'take', piece: 'p' });
  });
  it('knows an en passant, a check, a castling, a promotion and a taken queen', () => {
    expect(eventOf(game('e2e4 a7a6 e4e5 d7d5 e5d6'), 'b', never)).toEqual({ moment: 'enPassant', piece: 'p' });
    expect(eventOf(game('e2e4 f7f6 d1h5'), 'w', never)).toEqual({ moment: 'check' });
    expect(eventOf(game('e2e4 f7f6 d1h5'), 'b', never)).toEqual({ moment: 'checked' });
    const castle = 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 e1g1';
    expect(eventOf(game(castle), 'w', never)).toEqual({ moment: 'castle' });
    expect(eventOf(game(castle), 'b', never)).toBeNull(); // the user's castling is not the bot's business
    expect(eventOf(game(`${TO_C7} c7b8q`), 'w', never)).toEqual({ moment: 'promo', piece: 'q' });
    expect(eventOf(game(`${TO_C7} c7b8n`), 'b', never)).toEqual({ moment: 'userPromo', piece: 'n' });
    const queen = 'e2e4 d7d5 e4d5 d8d5 b1c3 d5a5 c3b5 a5b5 f1b5';
    expect(eventOf(game(queen), 'w', never)).toEqual({ moment: 'takeQueen', piece: 'q' });
    expect(eventOf(game(queen), 'b', never)).toEqual({ moment: 'lostQueen', piece: 'q' });
  });
  it('says how it ended', () => {
    const mate = game('f2f3 e7e5 g2g4 d8h4');
    expect(eventOf(mate, 'b', never)).toEqual({ moment: 'win' });
    expect(eventOf(mate, 'w', never)).toEqual({ moment: 'lose' });
    expect(eventOf(game('g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1 f6g8'), 'w', never)).toEqual({ moment: 'draw' });
  });
  it('now and then says who is well ahead, on a quiet move', () => {
    // white is a queen up (9 ≥ SWING); black's quiet move follows
    const s = 'e2e4 d7d5 e4d5 d8d5 b1c3 d5a5 c3b5 a5b5 f1b5 c7c6 b5a4 a7a6';
    expect(material(game(s), 'w')).toBeGreaterThanOrEqual(SWING);
    expect(eventOf(game(s), 'w', always)).toEqual({ moment: 'ahead' });
    expect(eventOf(game(s), 'b', always)).toEqual({ moment: 'behind' });
    expect(eventOf(game(s), 'w', never)).toBeNull();
  });
});
