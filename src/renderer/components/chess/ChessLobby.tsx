// The lobby of the Scacchi page (ADR 0304): the six agents as opponents, weakest first (each with its little person,
// its strength, a line on how it plays, the user's record against it and the wins in a row, now and at most), the colour to play and «Gioca», then the
// records: the fastest wins and the last games. The numbers come from main's store ('chess:history', kept in
// store/chess.ts). Used by ChessPage.tsx.
import { CHESS_BOTS, CHESS_BOT_IDS, STREAK_MIN, clock, eloLabel, type ChessGame } from '@shared/chess';
import { roleName } from '@shared/roles';
import { chess } from '../../store/chess';
import { locale, t } from '../../i18n';
import { AgentSprite } from '../AgentSprite';
import { Button } from '../ui';

const day = (at: number): string => new Date(at).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });

function GameRow({ g, withResult }: { g: ChessGame; withResult?: boolean }) {
  return (
    <li className="chess-row" data-testid="chess-history-row">
      {withResult && <span className={`chess-chip is-${g.result}`}>{t(`chess.result.${g.result}`)}</span>}
      <AgentSprite id={g.bot} state="idle" still height={26} />
      <span className="chess-row-name">{roleName(g.bot)}</span>
      <span className="chess-row-time">{clock(g.ms)}</span>
      <span className="chess-row-meta">{t('chess.movesN', { n: g.moves })}{withResult ? ` · ${t(`chess.ending.${g.ending}`)}` : ''}</span>
      <span className="chess-row-day">{day(g.at)}</span>
    </li>
  );
}

export function ChessLobby() {
  const bot = chess.store.use(s => s.bot);
  const side = chess.store.use(s => s.side);
  const history = chess.store.use(s => s.history);
  return (
    <div className="bx-inner chess-lobby" data-testid="chess-lobby">
      <header className="chess-head">
        <h1>{t('brainPages.nav.scacchi')}</h1>
        <p className="chess-lead">{t('chess.lead')}</p>
      </header>
      <section aria-label={t('chess.pick')}>
        <div className="chess-bots" role="radiogroup" aria-label={t('chess.pick')}>
          {CHESS_BOT_IDS.map(id => {
            const b = CHESS_BOTS[id], r = history?.bots[id], on = bot === id;
            return (
              <button key={id} type="button" role="radio" aria-checked={on} className={`chess-bot${on ? ' on' : ''}`} onClick={() => chess.pick(id)} onDoubleClick={() => { chess.pick(id); chess.start(); }} data-testid={`chess-bot-${id}`}>
                <span className="chess-bot-face"><AgentSprite id={id} state={on ? 'work' : 'idle'} still={!on} height={72} /></span>
                <span className="chess-bot-name">{roleName(id)}</span>
                <span className="chess-elo" data-tip={t('chess.eloTip')}>{t('chess.elo', { elo: eloLabel(b) })}</span>
                <span className="chess-bot-tag">{t(`chess.tag.${id}`)}</span>
                <span className="chess-bot-record" data-tip={t('chess.recordTip')}>{t('chess.record', { w: r?.wins ?? 0, l: r?.losses ?? 0, d: r?.draws ?? 0 })}</span>
                <span className={`chess-bot-best${r?.fastest ? ' has' : ''}`}>{r?.fastest ? t('chess.best', { time: clock(r.fastest.ms), moves: r.fastest.moves }) : t('chess.neverBeaten')}</span>
                <span className={`chess-bot-streak${r && r.streak >= STREAK_MIN ? ' on' : ''}`} data-tip={t('chess.streakTip')} data-testid={`chess-streak-${id}`}>{t('chess.streak', { now: r?.streak ?? 0, best: r?.bestStreak ?? 0 })}</span>
              </button>
            );
          })}
        </div>
        <div className="chess-start">
          <span className="chess-start-label">{t('chess.side')}</span>
          <span className="segmented" role="radiogroup" aria-label={t('chess.side')}>
            {(['w', 'b', 'random'] as const).map(x => <button key={x} type="button" role="radio" aria-checked={side === x} className={side === x ? 'on' : ''} onClick={() => chess.setSide(x)} data-testid={`chess-side-${x}`}>{t(`chess.side.${x}`)}</button>)}
          </span>
          <Button variant="primary" onClick={() => chess.start()} testid="chess-play">{t('chess.playVs', { name: roleName(bot) })}</Button>
        </div>
      </section>
      <div className="chess-history">
        <section className="chess-card" data-testid="chess-fastest">
          <h2>{t('chess.fastest')}</h2>
          {history?.fastest.length ? <ol className="chess-rows">{history.fastest.map(g => <GameRow key={g.id} g={g} />)}</ol> : <p className="chess-empty">{t('chess.fastestEmpty')}</p>}
          <p className="chess-note">{t('chess.fastestNote')}</p>
        </section>
        <section className="chess-card" data-testid="chess-recent">
          <h2>{t('chess.recent')}</h2>
          {history?.recent.length ? <ol className="chess-rows">{history.recent.map(g => <GameRow key={g.id} g={g} withResult />)}</ol> : <p className="chess-empty">{t('chess.recentEmpty')}</p>}
        </section>
      </div>
      <p className="chess-credits">{t('chess.credits')}</p>
    </div>
  );
}
