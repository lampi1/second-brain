// A game of the Scacchi page (ADR 0304): the board on the left; on the right the opponent (the agent's little person:
// thinking while the engine thinks, at its own job while the user thinks, asleep when they take long, jumping when it
// wins, head down when it loses; its line in a bubble that goes away by itself), what each side has taken, the moves,
// the time, «Annulla mossa» and «Abbandona»; over the board, the end of the game with «Rivincita» (the card closes to
// look at the final position; «Rivincita» stays in the panel). The game itself is
// store/chess.ts; this file only draws it. Used by ChessPage.tsx.
import { useEffect, useMemo, useRef, useState } from 'react';
import { CHESS_BOTS, STREAK_MIN, clock, eloLabel, type ChessColor } from '@shared/chess';
import { roleName } from '@shared/roles';
import { VALUE, material, position, userMoves, type PieceSymbol } from '../../lib/chess-game';
import { useNow, now } from '../../lib/clock';
import type { SpriteState } from '../../lib/agent-sprites';
import { chess } from '../../store/chess';
import { t } from '../../i18n';
import { AgentSprite } from '../AgentSprite';
import { IconArrowLeft, IconX } from '../Icons';
import { Button } from '../ui';
import { ChessBoard } from './ChessBoard';
import { pieceArt } from './pieces';

/** The user has been on the same move this long: the opponent says so and dozes off. */
const SLOW_MS = 45_000;
// the board's handlers never change, so the board is drawn again only when the position or the turn does (not at
// every second of the clock)
const onMove = (uci: string) => { chess.play(uci); };
const onPremove = (from: string, to: string) => { chess.premove(from, to); };
const onCancelPremove = () => chess.cancelPremove();
/** A line stays this long, then its bubble fades (the last line of a finished game stays). */
const BUBBLE_MS = 5200;

function Taken({ pieces, color, lead }: { pieces: readonly PieceSymbol[]; color: ChessColor; lead: number }) {
  const sorted = [...pieces].sort((a, b) => VALUE[b] - VALUE[a]);
  return (
    <span className="chess-taken" role="group" aria-label={t('chess.taken')}>
      {sorted.length > 0 && <span className="chess-taken-set">{sorted.map((p, i) => <img key={i} src={pieceArt(color, p)} alt={t(`chess.piece.${p}`)} width={20} height={20} draggable={false} />)}</span>}
      {lead > 0 && <span className="chess-plus">+{lead}</span>}
    </span>
  );
}

/** The game's time. Its own component: the second that passes draws these few characters again, not the panel. */
function GameTime({ startedAt, over }: { startedAt: number | null; over: number | null }) {
  const tick = useNow(1000);
  const elapsed = over ?? (startedAt ? Math.max(0, Math.max(tick, now()) - startedAt) : 0);
  return <span className="chess-time" data-testid="chess-time">{t('chess.time')} {clock(elapsed)}</span>;
}

export function ChessGame() {
  const s = chess.store.use(x => x);
  const pos = useMemo(() => position(s.ucis), [s.ucis]);
  const bot = CHESS_BOTS[s.bot], botColor: ChessColor = s.color === 'w' ? 'b' : 'w';
  const usersTurn = !s.outcome && !s.thinking && pos.turn === s.color;

  // the user takes long on a move: one line, and the opponent falls asleep until they play
  const [asleep, setAsleep] = useState(false);
  useEffect(() => {
    setAsleep(false);
    if (!usersTurn || !s.startedAt) return;
    const id = setTimeout(() => { setAsleep(true); chess.slow(); }, SLOW_MS);
    return () => clearTimeout(id);
  }, [usersTurn, s.ucis, s.startedAt]);

  // the bubble: there with each new line, gone after a while
  const [bubble, setBubble] = useState(false);
  useEffect(() => {
    if (!s.line) { setBubble(false); return; }
    setBubble(true);
    if (s.outcome) return;
    const id = setTimeout(() => setBubble(false), BUBBLE_MS);
    return () => clearTimeout(id);
  }, [s.line?.n, !!s.outcome]);

  // the end card may be closed to look at the final position; a new game brings it back
  const [card, setCard] = useState(true);
  useEffect(() => { setCard(true); }, [s.game]);

  const sprite: SpriteState = s.outcome ? (s.outcome.result === 'loss' ? 'done' : s.outcome.result === 'win' ? 'err' : 'idle') : s.thinking ? 'think' : asleep ? 'idle' : 'work';
  const status = s.outcome ? t(`chess.over.${s.outcome.result}`) : s.thinking ? t('chess.thinking') : pos.check ? t('chess.check') : usersTurn ? t('chess.yourTurn') : '';
  const lead = material(pos, s.color);
  const moves = useRef<HTMLOListElement>(null);
  useEffect(() => { moves.current?.scrollTo({ top: moves.current.scrollHeight }); }, [s.ucis.length]);
  const rows: [string, string | undefined][] = [];
  for (let i = 0; i < pos.sans.length; i += 2) rows.push([pos.sans[i]!, pos.sans[i + 1]]);
  const canUndo = usersTurn && s.ucis.length >= (s.color === 'w' ? 2 : 3);
  const name = roleName(s.bot);
  // a game with nothing to lose yet (the user has not moved) or that cannot go on (the engine does not answer) is
  // left without a result; from the user's first move on, leaving is a resignation
  const leave = userMoves(s.ucis.length, s.color) === 0 || !!s.problem;
  const botSan = pos.last && pos.last.color === botColor ? pos.last.san : null;

  return (
    <div className="chess-game" data-testid="chess-game" data-bot={s.bot} data-color={s.color} data-thinking={s.thinking || undefined} data-over={s.outcome?.result} data-premove={s.premove ? `${s.premove.from}${s.premove.to}` : undefined}>
      <div className="chess-stage">
        <ChessBoard pos={pos} side={s.color} canMove={usersTurn} onMove={onMove}
          canPremove={!s.outcome && pos.turn !== s.color} premove={s.premove} onPremove={onPremove} onCancelPremove={onCancelPremove} />
        {s.outcome && card && (
          <div className={`chess-over is-${s.outcome.result}`} role="status" data-testid="chess-over">
            <button type="button" className="chess-over-close" onClick={() => setCard(false)} aria-label={t('chess.seeBoard')} data-tip={t('chess.seeBoard')} data-testid="chess-over-close"><IconX size={13} /></button>
            <strong>{t(`chess.over.${s.outcome.result}`)}</strong>
            <span>{t('chess.overLine', { ending: t(`chess.ending.${s.outcome.ending}`), time: clock(s.outcome.ms), moves: t('chess.movesN', { n: s.outcome.moves }) })}</span>
            {s.outcome.record && <span className="chess-record-badge" data-testid="chess-new-record">{t('chess.newRecord')}</span>}
            {s.outcome.streak >= STREAK_MIN && <span className={s.outcome.streakRecord ? 'chess-record-badge' : 'chess-streak-line'} data-testid="chess-streak">{t(s.outcome.streakRecord ? 'chess.streakRecord' : 'chess.streakNow', { n: s.outcome.streak })}</span>}
            {s.outcome.result === 'win' && s.undos > 0 && <span className="chess-over-note">{t('chess.undosNote', { n: s.undos })}</span>}
            <span className="chess-over-actions">
              <Button variant="primary" onClick={() => chess.start()} testid="chess-rematch">{t('chess.rematch')}</Button>
              <Button onClick={() => chess.lobby()} testid="chess-change">{t('chess.back')}</Button>
            </span>
          </div>
        )}
      </div>
      <aside className="chess-panel">
        <section className={`chess-rival is-${sprite}`} data-testid="chess-rival">
          <div className="chess-rival-face">
            <AgentSprite id={s.bot} state={sprite} height={104} label={name} onTouch={sign => chess.touch(sign)} />
            {s.line && <p key={s.line.n} className={`chess-bubble${bubble ? '' : ' gone'}`} role="status" data-testid="chess-bubble">{s.line.text}</p>}
          </div>
          <div className="chess-rival-id">
            <strong>{name}</strong>
            <span className="chess-elo" data-tip={t('chess.eloTip')}>{t('chess.elo', { elo: eloLabel(bot) })}</span>
            <span className={`chess-status${s.thinking ? ' is-thinking' : ''}`} data-testid="chess-status">{status}</span>
            <span className="sr-only" aria-live="polite">{botSan ? t('chess.botPlayed', { name, san: botSan }) : ''}</span>
          </div>
          <Taken pieces={pos.taken[botColor]} color={s.color} lead={-lead} />
        </section>
        {s.problem && (
          <div className="chess-problem" role="alert" data-testid="chess-problem">
            <span>{t(`chess.problem.${s.problem}`)}</span>
            {s.problem !== 'missing' && <Button size="s" onClick={() => chess.retry()} testid="chess-retry">{t('chess.retry')}</Button>}
          </div>
        )}
        <section className="chess-moves-box">
          <header><span>{t('chess.moves')}</span><GameTime startedAt={s.startedAt} over={s.outcome ? s.outcome.ms : null} /></header>
          {rows.length ? (
            <ol className="chess-moves" ref={moves} data-testid="chess-moves">
              {rows.map(([w, b], i) => <li key={i}><span className="n">{i + 1}.</span><span className={i * 2 === pos.sans.length - 1 ? 'on' : ''}>{w}</span><span className={b && i * 2 + 1 === pos.sans.length - 1 ? 'on' : ''}>{b ?? ''}</span></li>)}
            </ol>
          ) : <p className="chess-moves-empty">{s.color === 'w' ? t('chess.noMoves') : t('chess.noMovesBot')}</p>}
        </section>
        <section className="chess-me">
          <strong>{t('chess.you')}</strong>
          <span className="chess-me-color"><i className={`chess-dot ${s.color}`} aria-hidden="true" />{t(`chess.side.${s.color}`)}</span>
          <Taken pieces={pos.taken[s.color]} color={botColor} lead={lead} />
        </section>
        <div className="chess-actions">
          {s.outcome
            ? <><Button variant="primary" onClick={() => chess.start()} testid="chess-again">{t('chess.rematch')}</Button><Button onClick={() => chess.lobby()} testid="chess-back"><IconArrowLeft size={13} />{t('chess.back')}</Button></>
            : <><Button onClick={() => chess.undo()} disabled={!canUndo} tip={t('chess.undoTip')} testid="chess-undo">{t('chess.undo')}</Button><Button variant={leave ? undefined : 'danger'} onClick={() => chess.resign()} testid="chess-resign">{leave ? t('chess.back') : t('chess.resign')}</Button></>}
        </div>
      </aside>
    </div>
  );
}
