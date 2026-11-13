// Chess against the agents (ADR 0304): the six bots (one per role, each with its own strength, the Orchestrator the
// strongest), the UCI lines the engine is given for a move, the finished game as it is stored and the history shown
// (wins, losses, draws, the fastest wins and the rows of wins per bot). The engine is Stockfish as a separate process speaking UCI
// (main/chess/engine.ts); the rules live in the page (renderer/lib/chess-game.ts, chess.js). Pure: no Node, no DOM.
// Used by main (chess/engine.ts, chess/store.ts, ipc-handlers/chess.ts) and the renderer (components/chess/).
import { isRoleId, type RoleId } from './roles';

/** A bot is a role: its little person plays. */
export type ChessBotId = RoleId;
export const CHESS_BOT_IDS: readonly ChessBotId[] = ['scout', 'herald', 'artisan', 'sentinel', 'strategist', 'orchestrator'];

export interface ChessBot {
  id: ChessBotId;
  /** the rating shown; under 1320 an estimate of ours, from 1320 on Stockfish's own UCI_Elo scale */
  elo: number;
  /** no limit on the engine: the rating is a floor ("2200+") */
  open: boolean;
  /** Stockfish's UCI_Elo (1320..3190); null = not limited this way */
  uciElo: number | null;
  /** Stockfish's Skill Level (0..20) when UCI_Elo is not used */
  skill: number;
  /** a cap on the search depth (the weakest bots look one or two moves ahead); 0 = none */
  depth: number;
  /** how long the engine may think on a move, ms */
  moveMs: number;
  /** how often the bot plays a random legal move instead of the engine's: the weakest bots' blunders (0..1) */
  slip: number;
}

/** Weakest first. Stockfish's limit starts at 1320: the two bots under it play its lowest skill at a shallow depth and
 *  throw in random moves. The Orchestrator has no limit at all (owner, 2026-11-13: «2200 … MINIMO»). */
export const CHESS_BOTS: Readonly<Record<ChessBotId, ChessBot>> = {
  scout: { id: 'scout', elo: 600, open: false, uciElo: null, skill: 0, depth: 1, moveMs: 200, slip: 0.3 },
  herald: { id: 'herald', elo: 900, open: false, uciElo: null, skill: 0, depth: 2, moveMs: 300, slip: 0.12 },
  artisan: { id: 'artisan', elo: 1400, open: false, uciElo: 1400, skill: 20, depth: 0, moveMs: 500, slip: 0 },
  sentinel: { id: 'sentinel', elo: 1700, open: false, uciElo: 1700, skill: 20, depth: 0, moveMs: 700, slip: 0 },
  strategist: { id: 'strategist', elo: 2000, open: false, uciElo: 2000, skill: 20, depth: 0, moveMs: 900, slip: 0 },
  orchestrator: { id: 'orchestrator', elo: 2200, open: true, uciElo: null, skill: 20, depth: 0, moveMs: 1200, slip: 0 },
};
/** A bot's rating as shown: an estimate under Stockfish's own scale («~600»), a floor without a limit («2200+»). */
export const eloLabel = (b: ChessBot): string => (b.open ? `${b.elo}+` : b.uciElo === null ? `~${b.elo}` : String(b.elo));
export const isChessBot = (v: unknown): v is ChessBotId => isRoleId(v);

/** A move as UCI writes it: e2e4, e7e8q. */
export const UCI_MOVE_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
/** The longest game the engine is asked about (plies): far past any real game, small enough for one command line. */
export const MAX_PLIES = 1000;

/** The moves of a request as the engine may read them: UCI moves only, at most MAX_PLIES; null = not a move list. */
export function cleanMoves(a: unknown): string[] | null {
  if (!Array.isArray(a) || a.length > MAX_PLIES) return null;
  const out: string[] = [];
  for (const m of a) { if (typeof m !== 'string' || !UCI_MOVE_RE.test(m)) return null; out.push(m); }
  return out;
}

/** The UCI lines for one move of `bot` after `moves` from the start position (the engine keeps no game of its own). */
export function goLines(bot: ChessBot, moves: readonly string[]): string[] {
  const limited = bot.uciElo !== null;
  return [
    ...(moves.length < 2 ? ['ucinewgame'] : []),
    `setoption name UCI_LimitStrength value ${limited ? 'true' : 'false'}`,
    ...(limited ? [`setoption name UCI_Elo value ${bot.uciElo}`] : [`setoption name Skill Level value ${bot.skill}`]),
    `position startpos${moves.length ? ` moves ${moves.join(' ')}` : ''}`,
    `go movetime ${bot.moveMs}${bot.depth ? ` depth ${bot.depth}` : ''}`,
  ];
}

/** "bestmove e7e5 ponder …" → "e7e5"; "bestmove (none)" → '' (no legal move); any other line → null. */
export function bestMove(line: string): string | null {
  const m = /^bestmove\s+(\S+)/.exec(line.trim());
  if (!m) return null;
  return UCI_MOVE_RE.test(m[1]!) ? m[1]! : '';
}

/** What the engine answered: its move, or why there is none. */
export type ChessMoveReply = { move: string } | { move: null; error: 'missing' | 'failed' | 'timeout' | 'superseded' | 'bad-request' };

export type ChessColor = 'w' | 'b';
/** From the user's side. */
export type ChessResult = 'win' | 'loss' | 'draw';
export const CHESS_ENDINGS = ['checkmate', 'resign', 'stalemate', 'repetition', 'fifty', 'material'] as const;
export type ChessEnding = (typeof CHESS_ENDINGS)[number];

/** A finished game as the page reports it. */
export interface ChessGameInput {
  bot: ChessBotId;
  /** the user's colour */
  color: ChessColor;
  result: ChessResult;
  ending: ChessEnding;
  /** the user's moves */
  moves: number;
  /** from the game's first move to its end, ms */
  ms: number;
  /** moves the user took back: a game with any is kept but is never a record */
  undos: number;
}
/** As stored: with its id and when it ended. */
export interface ChessGame extends ChessGameInput { id: number; at: number }

export const MAX_GAME_MS = 24 * 3600_000;
const whole = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max ? v : null);

/** The page's report as stored, or null when it is not a game (the page is trusted for its content, not its shape). */
export function cleanGame(a: unknown): ChessGameInput | null {
  if (!a || typeof a !== 'object') return null;
  const g = a as Record<string, unknown>;
  const moves = whole(g.moves, 0, MAX_PLIES), ms = whole(g.ms, 0, MAX_GAME_MS), undos = whole(g.undos, 0, MAX_PLIES);
  if (!isChessBot(g.bot) || (g.color !== 'w' && g.color !== 'b') || moves === null || ms === null || undos === null) return null;
  if (g.result !== 'win' && g.result !== 'loss' && g.result !== 'draw') return null;
  if (!(CHESS_ENDINGS as readonly unknown[]).includes(g.ending)) return null;
  const ending = g.ending as ChessEnding;
  // a result its ending cannot give: a mate or a resignation is never a draw, the drawn endings are never a win
  if ((ending === 'checkmate' || ending === 'resign') === (g.result === 'draw')) return null;
  // only the user resigns
  if (ending === 'resign' && g.result !== 'loss') return null;
  return { bot: g.bot, color: g.color, result: g.result, ending, moves, ms, undos };
}

export interface ChessBotRecord {
  wins: number; losses: number; draws: number;
  /** the fastest win without a move taken back, or null */
  fastest: ChessGame | null;
  /** the win in the fewest moves without a move taken back, or null */
  shortest: ChessGame | null;
  /** the wins in a row against this bot up to the last game (a loss or a draw ends it; a move taken back does not) */
  streak: number;
  /** the longest such row ever */
  bestStreak: number;
  /** the game that made the row that long (the first to reach it: a later row of the same length is not a record), or null */
  bestStreakId: number | null;
}
export interface ChessHistory {
  total: number;
  bots: Record<ChessBotId, ChessBotRecord>;
  /** the fastest wins overall (no move taken back), fastest first */
  fastest: ChessGame[];
  /** the last games, newest first */
  recent: ChessGame[];
}

export const FASTEST_SHOWN = 8;
export const RECENT_SHOWN = 12;
/** A win that may be a record: nothing taken back. */
export const isClean = (g: ChessGame): boolean => g.result === 'win' && g.undos === 0;
const faster = (a: ChessGame, b: ChessGame): number => a.ms - b.ms || a.moves - b.moves || a.at - b.at;
const shorter = (a: ChessGame, b: ChessGame): number => a.moves - b.moves || a.ms - b.ms || a.at - b.at;

/** The history page's numbers from every stored game. */
export function chessHistory(games: readonly ChessGame[]): ChessHistory {
  const bots = Object.fromEntries(CHESS_BOT_IDS.map(id => [id, { wins: 0, losses: 0, draws: 0, fastest: null, shortest: null, streak: 0, bestStreak: 0, bestStreakId: null }])) as Record<ChessBotId, ChessBotRecord>;
  // oldest first: the rows of wins are read in the order the games ended
  for (const g of [...games].sort((a, b) => a.id - b.id)) {
    const r = bots[g.bot];
    if (!r) continue;
    if (g.result === 'win') r.wins++; else if (g.result === 'loss') r.losses++; else r.draws++;
    r.streak = g.result === 'win' ? r.streak + 1 : 0;
    if (r.streak > r.bestStreak) { r.bestStreak = r.streak; r.bestStreakId = g.id; }
    if (!isClean(g)) continue;
    if (!r.fastest || faster(g, r.fastest) < 0) r.fastest = g;
    if (!r.shortest || shorter(g, r.shortest) < 0) r.shortest = g;
  }
  return {
    total: games.length, bots,
    fastest: games.filter(isClean).sort(faster).slice(0, FASTEST_SHOWN),
    recent: [...games].sort((a, b) => b.at - a.at || b.id - a.id).slice(0, RECENT_SHOWN),
  };
}

/** Whether `g`, just stored, is the fastest clean win against its bot (the "nuovo record" of the end card). */
export const isRecord = (g: ChessGame, h: ChessHistory): boolean => isClean(g) && h.bots[g.bot]?.fastest?.id === g.id;

/** From this many wins in a row the page speaks of a streak (one win is not a row). */
export const STREAK_MIN = 2;
/** Whether `g`, just stored, made the longest row of wins against its bot (the «serie record» of the end card): a
 *  row that only equals the old record is not one. */
export function isStreakRecord(g: ChessGame, h: ChessHistory): boolean {
  const r = h.bots[g.bot];
  return g.result === 'win' && !!r && r.streak >= STREAK_MIN && r.bestStreakId === g.id;
}

/** 754000 → "12:34"; an hour or more → "1:02:03". */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  const two = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}
