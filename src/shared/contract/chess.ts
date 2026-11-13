// The Scacchi page (ADR 0304): the engine's move for a bot, the engine's stop, a finished game, the history.
// One area of the IPC contract: src/shared/contract.ts re-exports it and assembles the channel maps (change a shape
// here first, then both sides).
import type { ChessBotId, ChessGame, ChessGameInput, ChessHistory, ChessMoveReply } from '../chess';

/** renderer → main, chess: each entry [argument, result]. Part of InvokeMap (src/shared/contract.ts). */
export interface ChessInvokeMap {
  /** the bot's move after `moves` (UCI, from the start position): Stockfish in its own process, started at the first
   *  request (main/chess/engine.ts); a newer request supersedes the one in flight */
  'chess:move': [{ bot: ChessBotId; moves: string[] }, ChessMoveReply];
  /** the page closed or the game ended: the engine's process stops */
  'chess:stop': [void, void];
  /** a finished game (main/chess/store.ts): stored as given when its shape is a game's; null when it is not */
  'chess:save': [ChessGameInput, { game: ChessGame; history: ChessHistory } | null];
  'chess:history': [void, ChessHistory];
}
