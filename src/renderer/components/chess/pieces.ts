// The chess pieces' pictures (ADR 0304): the «Chessnut» set by Alexis Luengas (Apache 2.0, assets/chess/chessnut with
// its licence), one SVG per piece and colour, bundled with the page (never fetched). Used by ChessBoard.tsx, the
// promotion picker and the taken pieces of ChessGame.tsx.
import bB from '../../assets/chess/chessnut/bB.svg';
import bK from '../../assets/chess/chessnut/bK.svg';
import bN from '../../assets/chess/chessnut/bN.svg';
import bP from '../../assets/chess/chessnut/bP.svg';
import bQ from '../../assets/chess/chessnut/bQ.svg';
import bR from '../../assets/chess/chessnut/bR.svg';
import wB from '../../assets/chess/chessnut/wB.svg';
import wK from '../../assets/chess/chessnut/wK.svg';
import wN from '../../assets/chess/chessnut/wN.svg';
import wP from '../../assets/chess/chessnut/wP.svg';
import wQ from '../../assets/chess/chessnut/wQ.svg';
import wR from '../../assets/chess/chessnut/wR.svg';
import type { Color, PieceSymbol } from '../../lib/chess-game';

const ART: Readonly<Record<Color, Readonly<Record<PieceSymbol, string>>>> = {
  w: { p: wP, n: wN, b: wB, r: wR, q: wQ, k: wK },
  b: { p: bP, n: bN, b: bB, r: bR, q: bQ, k: bK },
};
/** The picture's URL of a piece. */
export const pieceArt = (color: Color, type: PieceSymbol): string => ART[color][type];
