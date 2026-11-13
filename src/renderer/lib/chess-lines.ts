// What the bot says at the board (ADR 0304; owner, 2026-11-13: «frasi divertenti … ogni agente un carattere», «il più
// collegati possibile a quello che stanno realmente facendo … a zero consumo di token»): a line is chosen by what just
// happened on the board (lib/chess-game.ts eventOf: which piece was taken, a check, a castling, a promotion, who is
// ahead, how it ended) and by the role's character, the same characters as the Grindhouse's bubbles
// (shared/agent-quips.ts, whose short lines the bot also mutters while it thinks). Fixed text, no model call.
// The lines live per language in chess-lines.<lang>.ts. Used by store/chess.ts. Tests: test/unit/chess-lines.test.ts.
import type { Lang } from '@shared/contract';
import type { ChessBotId } from '@shared/chess';
import type { ChessEvent, ChessMoment, PieceSymbol } from './chess-game';
import { chessLinesDe } from './chess-lines.de';
import { chessLinesEn } from './chess-lines.en';
import { chessLinesIt } from './chess-lines.it';

type Named = Exclude<PieceSymbol, 'k'>;
export interface ChessLines {
  /** the user's piece, as the object of a sentence («il tuo cavallo») */
  yours: Record<Named, string>;
  /** the bot's own piece («il mio cavallo») */
  mine: Record<Named, string>;
  /** the bare name, for what a pawn became */
  piece: Record<Named, string>;
  says: Record<ChessBotId, Record<ChessMoment, readonly string[]>>;
}

export const CHESS_LINES: Readonly<Record<Lang, ChessLines>> = { it: chessLinesIt, en: chessLinesEn, de: chessLinesDe };
/** A bubble stays a bubble: no line is longer than this once its piece is written in. */
export const LINE_MAX = 96;
export const CHESS_MOMENTS: readonly ChessMoment[] = ['start', 'take', 'takeQueen', 'lost', 'lostQueen', 'check', 'checked', 'castle', 'promo', 'userPromo', 'enPassant',
  'ahead', 'behind', 'win', 'lose', 'draw', 'resign', 'slow', 'undo'];

const upper = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** A line with its piece written in; a sentence that starts with the piece starts with a capital. */
export function fill(line: string, set: ChessLines, piece: PieceSymbol | undefined): string {
  const p: Named = piece && piece !== 'k' ? piece : 'p';
  return upper(line.replace('{yours}', set.yours[p]).replace('{mine}', set.mine[p]).replace('{piece}', set.piece[p]));
}

/** The bot's line for what happened, never the one it said last (`avoid`) when it has another. */
export function chessLine(bot: ChessBotId, e: ChessEvent, lang: Lang, rnd: () => number = Math.random, avoid?: string): string {
  const set = CHESS_LINES[lang] ?? CHESS_LINES.it;
  const all = set.says[bot][e.moment].map(l => fill(l, set, e.piece));
  const pool = all.length > 1 ? all.filter(l => l !== avoid) : all;
  return pool[Math.min(pool.length - 1, Math.floor(rnd() * pool.length))] ?? '';
}
