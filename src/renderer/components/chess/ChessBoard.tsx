// The chessboard of the Scacchi page (ADR 0304): the position drawn with every piece as its own element (a move
// slides, since a piece keeps its id; a taken one fades where it stood), the last move and a check marked, and the user's moves by click (a piece, then
// its square), by drag, or from the keyboard (arrows move the focus, Enter or Space picks and plays). A pawn reaching
// the last rank opens the promotion picker on its file. Legality comes from lib/chess-game.ts: the board offers only
// legal squares and reports a move as UCI. While the bot thinks the user may already make their move (a premove:
// a piece and any square, by click or drag; shown on the two squares, dropped by Esc, a right click or a click
// elsewhere), which the game plays the moment the bot has moved if it is legal then. Always seen from the user's side.
// A dragged piece follows the pointer without React: its element is moved directly, so the board is not drawn again
// at every movement of the mouse (owner, 2026-11-14: «va un po' a scatti»). Used by ChessGame.tsx.
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { PROMOTIONS, needsPromotion, targets, uciOf, type Color, type PieceSymbol, type Placed, type Position, type Square } from '../../lib/chess-game';
import { t } from '../../i18n';
import { pieceArt } from './pieces';

const FILES = 'abcdefgh';
/** Where a square is drawn (column, row from the top) seen from `side`, and back. */
const cell = (sq: Square, side: Color): [number, number] => { const f = FILES.indexOf(sq[0]!), r = Number(sq[1]); return side === 'w' ? [f, 8 - r] : [7 - f, r - 1]; };
const squareAt = (x: number, y: number, side: Color): Square => (side === 'w' ? `${FILES[x]}${8 - y}` : `${FILES[7 - x]}${y + 1}`) as Square;
/** Where the piece on `sq` is drawn: its element's transform (styles/chess.css .chess-piece). */
const place = (sq: Square, side: Color): string => { const [x, y] = cell(sq, side); return `translate(${x * 100}%, ${y * 100}%)`; };
const SQUARES: readonly [number, number][] = Array.from({ length: 64 }, (_, i) => [i % 8, Math.floor(i / 8)]);
/** How long a taken piece stays to fade (styles/chess.css chess-taken-out). */
const GHOST_MS = 180;
/** A pointer that moved this far (px) with a piece held is a drag, not a click. */
const DRAG_PX = 5;

export interface ChessBoardProps {
  pos: Position; side: Color;
  /** it is the user's turn */
  canMove: boolean;
  onMove: (uci: string) => void;
  /** it is the bot's turn in a game going on: a move made now is kept as a premove */
  canPremove?: boolean;
  premove?: { from: string; to: string } | null;
  onPremove?: (from: Square, to: Square) => void;
  onCancelPremove?: () => void;
}

export const ChessBoard = memo(function ChessBoard({ pos, side, canMove, onMove, canPremove = false, premove = null, onPremove, onCancelPremove }: ChessBoardProps) {
  const board = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<Square | null>(null);
  const [promo, setPromo] = useState<{ from: Square; to: Square } | null>(null);
  /** the square of the piece being dragged (where it is under the pointer is not state: see `follow`) */
  const [held, setHeld] = useState<Square | null>(null);
  const [focus, setFocus] = useState<Square>(side === 'w' ? 'e2' : 'e7');
  /** the pointer went down on a piece of the user's: where, the board's box then (read once, not at every movement)
   *  and, once it is a drag, the piece's element */
  const down = useRef<{ sq: Square; x: number; y: number; wasSel: boolean; moved: boolean; box: DOMRect; el: HTMLElement | null } | null>(null);
  /** The pointer is let go of (or the drag is dropped): the piece's element is React's again. It goes to the square
   *  React has for it by then: the new one after a move, its own after anything else. */
  const release = () => {
    const el = down.current?.el;
    down.current = null;
    setHeld(null);
    if (!el) return;
    el.style.transition = '';
    requestAnimationFrame(() => { const sq = el.dataset.at as Square | undefined; if (el.isConnected && sq) el.style.transform = place(sq, side); });
  };
  const at = useMemo(() => new Map(pos.pieces.map(p => [p.square, p])), [pos]);
  // a piece just taken stays for a moment and fades where it stood (only on a move forward: not on a move taken back
  // or a new game)
  const before = useRef<Position>(pos);
  const [ghosts, setGhosts] = useState<readonly Placed[]>([]);
  useEffect(() => {
    const prev = before.current;
    before.current = pos;
    if (pos.ucis.length !== prev.ucis.length + 1 || !pos.last?.captured) { setGhosts(g => (g.length ? [] : g)); return; }
    const here = new Set(pos.pieces.map(p => p.id));
    setGhosts(prev.pieces.filter(p => !here.has(p.id)));
    const id = setTimeout(() => setGhosts([]), GHOST_MS);
    return () => clearTimeout(id);
  }, [pos]);
  // a new position (a move, a move taken back, a new game): the promotion picker closes; a piece the user holds stays
  // in hand while it is still theirs on that square (the bot moved while they were dragging a premove)
  useEffect(() => {
    setPromo(null);
    const inHand = down.current?.sq ?? sel;
    if (inHand && at.get(inHand)?.color !== side) { setSel(null); release(); }
  }, [pos]);
  // nothing to move and nothing to premove (the game ended, the lobby): nothing stays picked
  useEffect(() => { if (!canMove && !canPremove) { setSel(null); setPromo(null); release(); } }, [canMove, canPremove]);
  const from = held ?? sel;
  /** Nothing in hand: the pick, a drag going on, the kept premove. */
  const drop = () => { release(); setSel(null); onCancelPremove?.(); };
  /** The promotion picker closes and the keyboard is back on the board (the picker had the focus). */
  const closePromo = (sq: Square) => { setPromo(null); setFocus(sq); board.current?.querySelector<HTMLElement>(`[data-square="${sq}"]`)?.focus(); };
  const to = useMemo(() => new Set(from && canMove ? targets(pos, from) : []), [pos, from, canMove]);

  const tryMove = (a: Square, b: Square) => {
    setSel(null);
    if (needsPromotion(pos, a, b)) { setPromo({ from: a, to: b }); return; }
    const uci = uciOf(pos, a, b);
    if (uci) onMove(uci);
  };
  /** A click on a square (or Enter on it): play to it, pick its piece, or drop the pick. */
  const act = (sq: Square) => {
    if (promo) return;
    const own = at.get(sq)?.color === side;
    if (canMove) {
      if (sel && sel !== sq && targets(pos, sel).includes(sq)) { tryMove(sel, sq); return; }
      setSel(own && sel !== sq ? sq : null);
    } else if (canPremove) {
      // the bot's turn: a picked piece and any other square make a premove; a click elsewhere drops the one kept
      if (sel && sel !== sq && !own) { setSel(null); onPremove?.(sel, sq); return; }
      if (!own || sel === sq) onCancelPremove?.();
      setSel(own && sel !== sq ? sq : null);
    }
  };
  const under = (e: PointerEvent): Square | null => {
    const r = board.current?.getBoundingClientRect();
    if (!r || !r.width) return null;
    const x = Math.floor((e.clientX - r.left) / r.width * 8), y = Math.floor((e.clientY - r.top) / r.height * 8);
    return x < 0 || x > 7 || y < 0 || y > 7 ? null : squareAt(x, y, side);
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || promo) return;
    const sq = under(e);
    if (!sq) return;
    setFocus(sq);
    // the user's own piece is picked at once and may be dragged; any other square is a plain click
    if ((canMove || canPremove) && at.get(sq)?.color === side && !(sel && sel !== sq && to.has(sq))) {
      if (!canMove) onCancelPremove?.();
      down.current = { sq, x: e.clientX, y: e.clientY, wasSel: sel === sq, moved: false, box: e.currentTarget.getBoundingClientRect(), el: null };
      setSel(sq);
      e.currentTarget.setPointerCapture(e.pointerId);
    } else act(sq);
  };
  /** The held piece follows the pointer: only its element's transform changes, nothing is drawn again. */
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = down.current;
    if (!d) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_PX) return;
      d.moved = true;
      d.el = e.currentTarget.querySelector<HTMLElement>(`.chess-piece[data-at="${d.sq}"]`);
      if (d.el) d.el.style.transition = 'none';
      setHeld(d.sq);
    }
    if (d.el) d.el.style.transform = `translate(calc(${e.clientX - d.box.left}px - 50%), calc(${e.clientY - d.box.top}px - 50%))`;
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = down.current;
    if (!d) return;
    release();
    if (d.moved) {
      const sq = under(e);
      if (!sq || sq === d.sq) return;
      if (canMove) { if (targets(pos, d.sq).includes(sq)) tryMove(d.sq, sq); }
      // a premove may land on the user's own piece: the bot may take it first (a recapture made in advance)
      else if (canPremove) { setSel(null); onPremove?.(d.sq, sq); }
    } else if (d.wasSel) setSel(null); // a second click on the picked piece puts it down
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (promo) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePromo(promo.from); } return; }
    const [x, y] = cell(focus, side);
    const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const s = step[e.key];
    if (s) {
      e.preventDefault();
      const next = squareAt(Math.min(7, Math.max(0, x + s[0])), Math.min(7, Math.max(0, y + s[1])), side);
      setFocus(next);
      board.current?.querySelector<HTMLElement>(`[data-square="${next}"]`)?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(focus); }
    else if (e.key === 'Escape' && (sel || premove || down.current)) { e.preventDefault(); e.stopPropagation(); drop(); }
  };
  const name = (sq: Square): string => {
    const p = at.get(sq);
    return t('chess.square', { square: sq, piece: p ? t('chess.pieceOf', { piece: t(`chess.piece.${p.type}`), color: t(`chess.color.${p.color}`) }) : '' });
  };
  const choose = (type: PieceSymbol) => {
    if (!promo) return;
    const uci = uciOf(pos, promo.from, promo.to, type);
    closePromo(promo.to);
    if (uci) onMove(uci);
  };

  return (
    <div className={`chess-board${canMove || canPremove ? ' can-move' : ''}${held ? ' is-dragging' : ''}`} ref={board} role="group" aria-label={t('chess.board')} data-testid="chess-board" data-side={side} data-turn={pos.turn}
      onPointerDown={onDown} onPointerMove={onPointerMove} onPointerUp={onUp} onPointerCancel={release} onKeyDown={onKey}
      onContextMenu={e => { if (premove || sel || down.current) { e.preventDefault(); drop(); } }}>
      {SQUARES.map(([x, y]) => {
        const sq = squareAt(x, y, side);
        const cls = ['chess-sq', (x + y) % 2 ? 'dark' : 'light', pos.last && (pos.last.from === sq || pos.last.to === sq) ? 'last' : '', from === sq ? 'picked' : '',
          pos.check === sq ? 'in-check' : '', premove && (premove.from === sq || premove.to === sq) ? 'premove' : '', to.has(sq) ? (at.has(sq) ? 'target capture' : 'target') : ''].filter(Boolean).join(' ');
        return (
          <button key={sq} type="button" className={cls} data-square={sq} data-testid={`chess-sq-${sq}`} tabIndex={focus === sq ? 0 : -1} aria-label={name(sq)} aria-pressed={from === sq}
            onFocus={() => setFocus(sq)}>
            {x === 0 && <span className="chess-rank" aria-hidden="true">{sq[1]}</span>}
            {y === 7 && <span className="chess-file" aria-hidden="true">{sq[0]}</span>}
          </button>
        );
      })}
      {pos.pieces.map(p => {
        // the held piece keeps its square's transform here: while it is dragged `onPointerMove` moves the element itself
        const style: CSSProperties = { transform: place(p.square, side), backgroundImage: `url("${pieceArt(p.color, p.type)}")` };
        return <span key={p.id} className={`chess-piece${held === p.square ? ' is-held' : ''}`} style={style} data-piece={`${p.color}${p.type}`} data-at={p.square} aria-hidden="true" />;
      })}
      {ghosts.map(p => {
        return <span key={`gone-${p.id}`} className="chess-piece is-gone" style={{ transform: place(p.square, side), backgroundImage: `url("${pieceArt(p.color, p.type)}")` }} aria-hidden="true" />;
      })}
      {promo && (
        <div className="chess-promo-veil" onPointerDown={e => { e.stopPropagation(); closePromo(promo.from); }} data-testid="chess-promo">
          <div className="chess-promo" role="dialog" aria-label={t('chess.promote')} style={{ left: `${cell(promo.to, side)[0] * 12.5}%` }} onPointerDown={e => e.stopPropagation()}>
            {PROMOTIONS.map((type, i) => (
              <button key={type} type="button" className="chess-promo-opt" autoFocus={i === 0} onClick={() => choose(type)} aria-label={`${t('chess.promote')} ${t(`chess.piece.${type}`)}`} data-tip={t(`chess.piece.${type}`)}
                data-testid={`chess-promo-${type}`} style={{ backgroundImage: `url("${pieceArt(side, type)}")` }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
