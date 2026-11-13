// A game of the Scacchi page from the first move to its record (ADR 0304): the lobby's choice (which agent, which
// colour), the user's move (or a premove, made while the bot thinks), the bot's (asked to main's engine, 'chess:move'; the weakest bots slip into a random
// legal one), a move taken back, the resignation, the end (stored with 'chess:save', which gives back the history and
// whether it is a record, the row of wins) and the bot's line for what happened (lib/chess-lines.ts). The game lives here, not in the
// page: leaving Scacchi stops the engine and keeps the game, coming back asks the bot again if it was thinking.
// Everything it needs from outside comes as `deps`, so the tests play whole games in Node.
// Used by store/chess.ts (the app's one instance). Tests: test/unit/chess-play.test.ts.
import { pickQuip } from '@shared/agent-quips';
import { CHESS_BOTS, isRecord, isStreakRecord, type ChessBotId, type ChessColor, type ChessEnding, type ChessGame, type ChessGameInput, type ChessHistory, type ChessMoveReply, type ChessResult } from '@shared/chess';
import type { Lang } from '@shared/contract';
import { createStore, type Store } from '../store/createStore';
import { botMove, eventOf, isLegal, position, resultFor, userMoves, type ChessEvent } from './chess-game';
import { chessLine } from './chess-lines';

export interface ChessOutcome {
  result: ChessResult; ending: ChessEnding;
  /** the user's moves and the game's time, as stored */
  moves: number; ms: number;
  /** the fastest clean win against this bot so far */
  record: boolean;
  /** the wins in a row against this bot, this game included (0 until the store answers, and after a loss or a draw) */
  streak: number;
  /** that row is the longest ever against this bot */
  streakRecord: boolean;
}
export interface ChessState {
  view: 'lobby' | 'game';
  /** the agent chosen in the lobby, the opponent of the game */
  bot: ChessBotId;
  /** the lobby's colour choice */
  side: ChessColor | 'random';
  /** the user's colour in the game */
  color: ChessColor;
  /** the game: its moves from the start position */
  ucis: readonly string[];
  /** the bot's move was asked and has not come yet */
  thinking: boolean;
  /** when the first move was played */
  startedAt: number | null;
  undos: number;
  outcome: ChessOutcome | null;
  /** what the bot says now; `n` counts the lines (a new one restarts the bubble) */
  line: { text: string; n: number } | null;
  /** the engine could not give a move: «Riprova» asks again */
  problem: 'missing' | 'failed' | 'timeout' | null;
  history: ChessHistory | null;
  /** a move the user made while the bot thinks: played the moment the bot has moved, if it is legal then */
  premove: { from: string; to: string } | null;
  /** counts the games: an answer for an older one is dropped */
  game: number;
}

export interface ChessDeps {
  move(a: { bot: ChessBotId; moves: string[] }): Promise<ChessMoveReply>;
  stop(): Promise<void>;
  save(g: ChessGameInput): Promise<{ game: ChessGame; history: ChessHistory } | null>;
  history(): Promise<ChessHistory>;
  now(): number;
  rnd(): number;
  lang(): Lang;
  /** resolves after `ms` (the bot is seen thinking even when the engine answers at once) */
  wait(ms: number): Promise<void>;
}

/** The bot's move never comes sooner than this, so the user's own move is seen landing first. Kept short: a weak bot
 *  answers almost at once and a strong one takes its engine's time (owner, 2026-11-13: «le animazioni fluide e
 *  veloci», «mi piace bullet … amo il premove e gioco veloce, mi immagino massacrare lo Scout velocemente»). */
export const MIN_THINK_MS = 150;
/** How often the bot mutters one of its short Grindhouse lines while it thinks. */
export const MUTTER = 0.4;

export const INITIAL: ChessState = { view: 'lobby', bot: 'scout', side: 'w', color: 'w', ucis: [], thinking: false, startedAt: null, undos: 0, outcome: null, line: null, problem: null, history: null, premove: null, game: 0 };

export interface ChessPlay {
  store: Store<ChessState>;
  /** the page opened: the history is read, a bot that was thinking is asked again */
  open(): void;
  /** the page closed: the engine stops, the game stays */
  close(): void;
  pick(bot: ChessBotId): void;
  setSide(side: ChessState['side']): void;
  start(): void;
  /** the user's move (UCI); false when it is not theirs to play or not legal */
  play(uci: string): boolean;
  /** a move made while it is the bot's turn: kept, and played right after the bot's move if it is legal there (a pawn
   *  reaching the last rank becomes a queen); false when there is no game going or it is the user's turn */
  premove(from: string, to: string): boolean;
  /** the kept move is dropped */
  cancelPremove(): void;
  undo(): void;
  resign(): void;
  retry(): void;
  lobby(): void;
  /** the user has been thinking for a long time */
  slow(): void;
  /** a click on the bot's little person: +1 a pat, -1 a whack */
  touch(sign: 1 | -1): void;
}

export function createChessPlay(d: ChessDeps): ChessPlay {
  const store = createStore<ChessState>(INITIAL);
  const get = store.get, set = (p: Partial<ChessState>) => store.set(s => ({ ...s, ...p }));
  const botColor = (): ChessColor => (get().color === 'w' ? 'b' : 'w');
  const speak = (text: string) => { if (text) set({ line: { text, n: (get().line?.n ?? 0) + 1 } }); };
  const say = (e: ChessEvent | null) => { if (e) speak(chessLine(get().bot, e, d.lang(), d.rnd, get().line?.text)); };
  const usersTurn = (): boolean => { const s = get(); return s.view === 'game' && !s.outcome && !s.thinking && position(s.ucis).turn === s.color; };

  function finish(result: ChessResult, ending: ChessEnding): void {
    const s = get();
    const input: ChessGameInput = { bot: s.bot, color: s.color, result, ending, moves: userMoves(s.ucis.length, s.color), ms: Math.max(0, d.now() - (s.startedAt ?? d.now())), undos: s.undos };
    set({ thinking: false, problem: null, premove: null, outcome: { result, ending, moves: input.moves, ms: input.ms, record: false, streak: 0, streakRecord: false } });
    const game = s.game;
    void d.stop().catch(() => undefined);
    void d.save(input).then(saved => {
      if (!saved) return;
      set({ history: saved.history });
      const now = get();
      if (now.game === game && now.outcome) set({ outcome: { ...now.outcome, record: isRecord(saved.game, saved.history), streak: saved.history.bots[saved.game.bot]?.streak ?? 0, streakRecord: isStreakRecord(saved.game, saved.history) } });
    }).catch(() => undefined);
  }

  /** After a move: the game ended, or the bot comments it. */
  function after(): boolean {
    const s = get(), pos = position(s.ucis);
    say(eventOf(pos, botColor(), d.rnd));
    if (!pos.over) return false;
    finish(resultFor(pos.over.winner, s.color), pos.over.ending);
    return true;
  }

  async function askBot(): Promise<void> {
    const s = get();
    if (s.view !== 'game' || s.outcome || s.thinking) return;
    const { game, ucis, bot } = s;
    const mine = () => { const n = get(); return n.game === game && n.ucis === ucis && n.thinking; };
    set({ thinking: true, problem: null });
    const t0 = d.now();
    if (ucis.length > 1 && d.rnd() < MUTTER) speak(pickQuip(bot, 'work', d.lang(), d.rnd, get().line?.text));
    let reply: ChessMoveReply;
    try { reply = await d.move({ bot, moves: [...ucis] }); } catch { reply = { move: null, error: 'failed' }; }
    if (!mine()) return;
    if (reply.move === null) {
      // superseded = the page closed or another request took its place: open() asks again
      set({ thinking: false, problem: reply.error === 'superseded' || reply.error === 'bad-request' ? null : reply.error });
      return;
    }
    const move = botMove(CHESS_BOTS[bot], reply.move, position(ucis), d.rnd);
    if (!move) { set({ thinking: false, problem: 'failed' }); return; }
    await d.wait(Math.max(0, MIN_THINK_MS - (d.now() - t0)));
    if (!mine()) return;
    set({ ucis: [...ucis, move], thinking: false, startedAt: get().startedAt ?? d.now() });
    if (after()) return;
    // the move the user made meanwhile: played at once when it is legal here, dropped when it is not
    const pre = get().premove;
    if (!pre) return;
    set({ premove: null });
    const pos = position(get().ucis), uci = `${pre.from}${pre.to}`;
    const legal = isLegal(pos, uci) ? uci : isLegal(pos, `${uci}q`) ? `${uci}q` : null;
    if (legal) play(legal);
  }

  function play(uci: string): boolean {
    const s = get();
    if (!usersTurn() || !isLegal(position(s.ucis), uci)) return false;
    set({ ucis: [...s.ucis, uci], startedAt: s.startedAt ?? d.now(), problem: null, premove: null });
    if (!after()) void askBot();
    return true;
  }

  function lobby(): void {
    set({ view: 'lobby', thinking: false, problem: null, premove: null, outcome: null, ucis: [], startedAt: null, undos: 0, line: null, game: get().game + 1 });
    void d.stop().catch(() => undefined);
  }

  return {
    store,
    open() {
      void d.history().then(history => set({ history })).catch(() => undefined);
      const s = get();
      if (s.view === 'game' && !s.outcome && !s.thinking && !s.problem && position(s.ucis).turn !== s.color) void askBot();
    },
    close() {
      if (get().thinking) set({ thinking: false });
      void d.stop().catch(() => undefined);
    },
    pick(bot) { if (get().view === 'lobby') set({ bot }); },
    setSide(side) { if (get().view === 'lobby') set({ side }); },
    start() {
      const s = get();
      const color: ChessColor = s.side === 'random' ? (d.rnd() < 0.5 ? 'w' : 'b') : s.side;
      set({ view: 'game', color, ucis: [], thinking: false, startedAt: null, undos: 0, outcome: null, problem: null, premove: null, game: s.game + 1 });
      say({ moment: 'start' });
      if (color === 'b') void askBot();
    },
    play,
    premove(from, to) {
      const s = get();
      if (s.view !== 'game' || s.outcome || from === to || position(s.ucis).turn === s.color) return false;
      set({ premove: { from, to } });
      return true;
    },
    cancelPremove() { if (get().premove) set({ premove: null }); },
    undo() {
      const s = get();
      // the user's last move and the bot's answer to it; the bot's opening move (the user plays black) stays
      if (!usersTurn() || s.ucis.length < (s.color === 'w' ? 2 : 3)) return;
      set({ ucis: s.ucis.slice(0, -2), undos: s.undos + 1, problem: null });
      say({ moment: 'undo' });
    },
    resign() {
      const s = get();
      if (s.view !== 'game' || s.outcome) return;
      // nothing played yet: there is no game to lose
      if (!s.startedAt) { lobby(); return; }
      say({ moment: 'resign' });
      finish('loss', 'resign');
    },
    retry() { if (get().problem) { set({ problem: null }); void askBot(); } },
    lobby,
    slow() { if (usersTurn()) say({ moment: 'slow' }); },
    touch(sign) { speak(pickQuip(get().bot, sign > 0 ? 'pat' : 'whack', d.lang(), d.rnd, get().line?.text)); },
  };
}
