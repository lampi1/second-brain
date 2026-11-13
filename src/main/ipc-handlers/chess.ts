// IPC handlers, the Scacchi page (ADR 0304): the engine's move, its stop, a finished game, the history. Registered by
// src/main/index.ts with every other group (Handlers in ipc.ts keeps the set complete); each channel's shape is in
// src/shared/contract/chess.ts. The arguments are checked where they are used (chess/engine.ts, chess/store.ts).
import type { ChessEngine } from '../chess/engine';
import type { ChessStore } from '../chess/store';
import type { HandlersOf } from './context';

export function chessHandlers(engine: ChessEngine, games: ChessStore): HandlersOf<'chess'> {
  return {
    'chess:move': a => engine.move(a),
    'chess:stop': () => engine.stop(),
    'chess:save': a => games.save(a),
    'chess:history': () => games.history(),
  };
}
