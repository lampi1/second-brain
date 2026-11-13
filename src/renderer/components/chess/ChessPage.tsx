// The Scacchi page (ADR 0304; owner, 2026-11-13: «una sezione scacchi dove io posso giocare contro i miei agenti»):
// the lobby (choose an agent) or the game. Opening it reads the history; leaving it stops the engine's process and
// keeps the game, which goes on when the page is opened again (store/chess.ts). Its own chunk (App.tsx loads it when
// first opened): the rules library and the pieces cost nothing until then. Used by App.tsx PageFrame.
import { useEffect } from 'react';
import { chess } from '../../store/chess';
import { t } from '../../i18n';
import { ChessGame } from './ChessGame';
import { ChessLobby } from './ChessLobby';
import '../../styles/chess.css';

export function ChessPage() {
  const view = chess.store.use(s => s.view);
  useEffect(() => { chess.open(); return () => chess.close(); }, []);
  return (
    <div className="bx bx-page bx-scroll chess-page" data-testid="chess-page" role="region" aria-label={t('brainPages.nav.scacchi')}>
      {view === 'lobby' ? <ChessLobby /> : <ChessGame />}
    </div>
  );
}
