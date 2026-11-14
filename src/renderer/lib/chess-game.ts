// The rules side of the Scacchi page (ADR 0304): a game is its list of UCI moves from the start position; from it
// this file gives the position to draw (every piece with a stable id, so a move slides and a capture fades), the legal
// targets of a piece, the promotion check, how the game ended, the material, the bot's move (the weakest bots slip
// into a random one) and what just happened on the board for the bot's lines (lib/chess-lines.ts). Legality, check,
// mate, castling, en passant, promotion and the draws are chess.js's. Pure: no DOM, no IPC.
// Used by store/chess.ts and components/chess/. Tests: test/unit/chess-game.test.ts.
import { Chess, type Color, type Move, type PieceSymbol, type Square } from 'chess.js';
import type { ChessBot, ChessColor, ChessEnding, ChessResult } from '@shared/chess';

export type { Color, PieceSymbol, Square };

/** A piece on the board; `id` stays the same from the first move to the last (a promoted pawn keeps its own). */
export interface Placed { id: string; type: PieceSymbol; color: Color; square: Square }

export interface Position {
  /** the moves that lead here */
  ucis: readonly string[];
  /** the same moves as the move list writes them (SAN) */
  sans: readonly string[];
  pieces: readonly Placed[];
  turn: Color;
  /** the last move, for its highlight and for what happened */
  last: Move | null;
  /** the square of the king in check, or null */
  check: Square | null;
  /** what each side has taken, in the order it happened */
  taken: Readonly<Record<Color, readonly PieceSymbol[]>>;
  /** how it ended, or null while it is played */
  over: { ending: ChessEnding; winner: Color | null } | null;
  /** every legal move from here */
  legal: readonly Move[];
}

const FILES = 'abcdefgh';
const BACK: PieceSymbol[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
/** The 32 pieces at the start, each with its id: colour, type and the file it starts on. */
function startPieces(): Map<Square, Placed> {
  const out = new Map<Square, Placed>();
  for (let f = 0; f < 8; f++) {
    for (const [color, back, pawns] of [['w', 1, 2], ['b', 8, 7]] as const) {
      const file = FILES[f]!;
      out.set(`${file}${back}` as Square, { id: `${color}${BACK[f]}${file}`, type: BACK[f]!, color, square: `${file}${back}` as Square });
      out.set(`${file}${pawns}` as Square, { id: `${color}p${file}`, type: 'p', color, square: `${file}${pawns}` as Square });
    }
  }
  return out;
}

/** One move on the tracked pieces: the capture (en passant: the pawn beside), the rook of a castling, the promotion. */
function track(at: Map<Square, Placed>, m: Move): void {
  const piece = at.get(m.from);
  if (!piece) return;
  if (m.isEnPassant()) at.delete(`${m.to[0]}${m.from[1]}` as Square);
  at.delete(m.from);
  at.set(m.to, { ...piece, square: m.to, type: m.promotion ?? piece.type });
  if (m.isKingsideCastle() || m.isQueensideCastle()) {
    const rank = m.from[1]!, from = `${m.isKingsideCastle() ? 'h' : 'a'}${rank}` as Square, to = `${m.isKingsideCastle() ? 'f' : 'd'}${rank}` as Square;
    const rook = at.get(from);
    if (rook) { at.delete(from); at.set(to, { ...rook, square: to }); }
  }
}

const split = (uci: string): { from: string; to: string; promotion?: string } => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci[4] ? { promotion: uci[4] } : {}) });

function ending(chess: Chess): Position['over'] {
  if (chess.isCheckmate()) return { ending: 'checkmate', winner: chess.turn() === 'w' ? 'b' : 'w' };
  if (chess.isStalemate()) return { ending: 'stalemate', winner: null };
  if (chess.isInsufficientMaterial()) return { ending: 'material', winner: null };
  if (chess.isThreefoldRepetition()) return { ending: 'repetition', winner: null };
  if (chess.isDrawByFiftyMoves()) return { ending: 'fifty', winner: null };
  return null;
}

let memo: { key: string; pos: Position } | null = null;
/** The game as it was last walked: a game grows by one move at a time, so the next position plays only the new
 *  moves on it and never the whole game again (a long game cost a frame per move). */
interface Walk { ucis: string[]; chess: Chess; at: Map<Square, Placed>; taken: Record<Color, PieceSymbol[]>; sans: string[]; last: Move | null }
let walk: Walk | null = null;
const newWalk = (): Walk => ({ ucis: [], chess: new Chess(), at: startPieces(), taken: { w: [], b: [] }, sans: [], last: null });

/** The position after `ucis`. Throws on a move that is not legal where it is played (the callers check first). */
export function position(ucis: readonly string[]): Position {
  const key = ucis.join(' ');
  if (memo?.key === key) return memo.pos;
  // the walked game goes on when `ucis` starts with it; a move taken back or another game starts a new walk
  let w = walk;
  if (!w || w.ucis.length > ucis.length || w.ucis.some((u, i) => u !== ucis[i])) w = newWalk();
  walk = null; // a move that throws leaves no half-walked game behind
  for (let i = w.ucis.length; i < ucis.length; i++) {
    const m = w.chess.move(split(ucis[i]!));
    if (m.captured) w.taken[m.color].push(m.captured);
    track(w.at, m);
    w.sans.push(m.san);
    w.ucis.push(ucis[i]!);
    w.last = m;
  }
  walk = w;
  const turn = w.chess.turn(), pieces = [...w.at.values()];
  const check = w.chess.inCheck() ? pieces.find(p => p.type === 'k' && p.color === turn)?.square ?? null : null;
  // a position is a picture: its lists are its own, the walk goes on without changing them
  const pos: Position = { ucis: [...ucis], sans: [...w.sans], pieces, turn, last: w.last, check, taken: { w: [...w.taken.w], b: [...w.taken.b] }, over: ending(w.chess), legal: w.chess.moves({ verbose: true }) };
  memo = { key, pos };
  return pos;
}

/** Where the piece on `from` may go. */
export const targets = (pos: Position, from: Square): Square[] => [...new Set(pos.legal.filter(m => m.from === from).map(m => m.to))];
/** Whether `from`→`to` is a pawn reaching the last rank: the user picks the piece first. */
export const needsPromotion = (pos: Position, from: Square, to: Square): boolean => pos.legal.some(m => m.from === from && m.to === to && !!m.promotion);
export const PROMOTIONS: readonly PieceSymbol[] = ['q', 'n', 'r', 'b'];
/** The legal move `from`→`to` as UCI (with the promotion when it needs one), or null. */
export function uciOf(pos: Position, from: Square, to: Square, promotion?: PieceSymbol): string | null {
  const m = pos.legal.find(x => x.from === from && x.to === to && (!x.promotion || x.promotion === promotion));
  return m ? `${m.from}${m.to}${m.promotion ?? ''}` : null;
}
export const isLegal = (pos: Position, uci: string): boolean => pos.legal.some(m => `${m.from}${m.to}${m.promotion ?? ''}` === uci);

export const VALUE: Readonly<Record<PieceSymbol, number>> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
/** The material of `color` minus the other side's, in pawns (a promoted pawn counts as what it became). */
export function material(pos: Position, color: Color): number {
  let n = 0;
  for (const p of pos.pieces) n += (p.color === color ? 1 : -1) * VALUE[p.type];
  return n;
}

/** The result from the user's side. */
export const resultFor = (winner: Color | null, user: ChessColor): ChessResult => (winner === null ? 'draw' : winner === user ? 'win' : 'loss');
/** The user's moves so far. */
export const userMoves = (plies: number, user: ChessColor): number => (user === 'w' ? Math.ceil(plies / 2) : Math.floor(plies / 2));

/** The bot's move: the engine's, or (the weakest bots, `slip` of the times) any legal one. Null when the engine's
 *  move is not legal here and there is nothing to play. */
export function botMove(bot: ChessBot, engine: string, pos: Position, rnd: () => number = Math.random): string | null {
  if (!pos.legal.length) return null;
  if (bot.slip > 0 && rnd() < bot.slip) {
    const m = pos.legal[Math.min(pos.legal.length - 1, Math.floor(rnd() * pos.legal.length))]!;
    return `${m.from}${m.to}${m.promotion ?? ''}`;
  }
  return isLegal(pos, engine) ? engine : null;
}

/** What the bot may comment, from its side (lib/chess-lines.ts has the lines of each). */
export type ChessMoment = 'start' | 'take' | 'takeQueen' | 'lost' | 'lostQueen' | 'check' | 'checked' | 'castle' | 'promo' | 'userPromo' | 'enPassant'
  | 'ahead' | 'behind' | 'win' | 'lose' | 'draw' | 'resign' | 'slow' | 'undo';
export interface ChessEvent { moment: ChessMoment; piece?: PieceSymbol }
/** From this many pawns of material the bot says it is ahead or behind. */
export const SWING = 5;

/** What the last move was, for the bot of colour `bot`: the end of the game, a promotion, a queen taken, an en
 *  passant, a check, a capture, the bot's castling; else, now and then (`rnd` under 0.25), who is well ahead. */
export function eventOf(pos: Position, bot: Color, rnd: () => number = Math.random): ChessEvent | null {
  const m = pos.last;
  if (!m) return null;
  if (pos.over) return { moment: pos.over.winner === null ? 'draw' : pos.over.winner === bot ? 'win' : 'lose' };
  const mine = m.color === bot;
  if (m.promotion) return { moment: mine ? 'promo' : 'userPromo', piece: m.promotion };
  if (m.captured === 'q') return { moment: mine ? 'takeQueen' : 'lostQueen', piece: 'q' };
  if (m.isEnPassant()) return { moment: 'enPassant', piece: 'p' };
  if (pos.check) return { moment: mine ? 'check' : 'checked' };
  if (m.captured) return { moment: mine ? 'take' : 'lost', piece: m.captured };
  if (mine && (m.isKingsideCastle() || m.isQueensideCastle())) return { moment: 'castle' };
  const lead = material(pos, bot);
  if (Math.abs(lead) >= SWING && rnd() < 0.25) return { moment: lead > 0 ? 'ahead' : 'behind' };
  return null;
}
