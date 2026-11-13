// The finished chess games (ADR 0304): one row per game in userData/app.db (area `chess_games`, ADR 0199), from which
// the Scacchi page shows wins, losses and draws per bot and the fastest wins. Local only, zero tokens: nothing leaves
// the machine. At most KEEP_GAMES rows (the oldest go). If the database cannot be opened the games stay in memory for
// this session (said once in the log). One instance per process (`chessGames`), initialised by index.ts; read by
// ipc-handlers/chess.ts. Tests: test/unit/chess-store.test.ts.
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { chessHistory, cleanGame, type ChessGame, type ChessGameInput, type ChessHistory } from '../../shared/chess';
import { APP_DB, migrate, openAppDb, reopenAppDb, type Migration } from '../app-db';
import { errText, log } from '../log';

export const AREA = 'chess_games';
/** Rows kept: years of games; the oldest are deleted past it. */
export const KEEP_GAMES = 5000;

export const CHESS_STEPS: readonly Migration[] = [
  db => db.exec('create table chess_games(id integer primary key autoincrement, at integer not null, bot text not null, color text not null, result text not null, ending text not null, moves integer not null, ms integer not null, undos integer not null)'),
];

export class ChessStore {
  private db: DatabaseSync | null = null;
  private file: string | null = null;
  /** the games when there is no database (not initialised yet, the demo, a database that would not open) */
  private mem: ChessGame[] = [];
  private nextId = 1;
  private now: () => number = Date.now;

  /** `userData` null = memory only (the demo, tests); `seed` = games to start from (the demo's history). */
  init(o: { userData: string | null; now?: () => number; seed?: readonly ChessGameInput[] }): void {
    this.close();
    this.mem = []; this.nextId = 1;
    this.now = o.now ?? Date.now;
    this.file = o.userData ? path.join(o.userData, APP_DB) : null;
    // the seed's games end a day apart, the last one yesterday
    (o.seed ?? []).forEach((g, i, all) => this.mem.push({ ...g, id: this.nextId++, at: this.now() - (all.length - i) * 864e5 }));
  }

  /** Opened at first use: the agent runs' store has opened (and checked) app.db at start by then. */
  private open(): DatabaseSync | null {
    if (!this.file) return null;
    if (this.db?.isOpen) return this.db;
    try {
      this.db = this.db ? reopenAppDb(this.file) : openAppDb(this.file).db;
      migrate(this.db, AREA, CHESS_STEPS);
      return this.db;
    } catch (e) {
      log.error('chess', 'chess games database not opened', { cause: errText(e), hint: 'the games of this session stay in memory until the app quits; nothing else is affected' });
      try { if (this.db?.isOpen) this.db.close(); } catch { /* nothing to close */ }
      this.file = null; this.db = null;
      return null;
    }
  }

  private games(): ChessGame[] {
    const db = this.open();
    const out: ChessGame[] = [];
    if (db) {
      try {
        for (const r of db.prepare('select id, at, bot, color, result, ending, moves, ms, undos from chess_games order by id').all() as unknown as Record<string, unknown>[]) {
          const g = cleanGame({ ...r, moves: Number(r.moves), ms: Number(r.ms), undos: Number(r.undos) });
          if (g) out.push({ ...g, id: Number(r.id), at: Number(r.at) });
        }
      } catch (e) {
        log.error('chess', 'chess games not read', { cause: errText(e), hint: 'Scacchi shows only this session\'s games' });
      }
    }
    // the memory's games after the database's, with ids past them (they are never both for long)
    const base = out.reduce((m, g) => Math.max(m, g.id), 0);
    return [...out, ...this.mem.map(g => ({ ...g, id: base + g.id }))];
  }

  /** Stores a finished game; returns it as stored with the history after it, or null when it is not a game. */
  save(a: unknown): { game: ChessGame; history: ChessHistory } | null {
    const g = cleanGame(a);
    if (!g) return null;
    const at = this.now();
    const db = this.open();
    let rowId: number | null = null;
    if (db) {
      try {
        const info = db.prepare('insert into chess_games(at, bot, color, result, ending, moves, ms, undos) values(?, ?, ?, ?, ?, ?, ?, ?)').run(at, g.bot, g.color, g.result, g.ending, g.moves, g.ms, g.undos);
        rowId = Number(info.lastInsertRowid);
      } catch (e) {
        log.error('chess', 'chess game not saved', { cause: errText(e), hint: 'this game is kept in memory; the next ones try the database again' });
      }
      if (rowId !== null) {
        try { db.prepare('delete from chess_games where id <= ?').run(rowId - KEEP_GAMES); }
        catch (e) { log.warn('chess', 'old chess games not pruned', { cause: errText(e), hint: 'the game is saved; the next save prunes again' }); }
      }
    }
    if (rowId === null) { this.mem.push({ ...g, id: this.nextId++, at }); if (this.mem.length > KEEP_GAMES) this.mem.shift(); }
    const all = this.games();
    // the one just stored: the database's row, or the memory's last (games() lists the memory's after the database's)
    const game = (rowId === null ? undefined : all.find(x => x.id === rowId)) ?? all[all.length - 1] ?? { ...g, id: rowId ?? 0, at };
    return { game, history: chessHistory(all) };
  }

  history(): ChessHistory { return chessHistory(this.games()); }

  close(): void {
    try { if (this.db?.isOpen) this.db.close(); } catch { /* already closed */ }
    this.db = null;
  }
}

/** The app's one store (index.ts initialises it with userData). */
export const chessGames = new ChessStore();

/** A plausible history for the demo (memory only, never written): the page and the screenshots have records. */
export const DEMO_CHESS_GAMES: readonly ChessGameInput[] = [
  { bot: 'scout', color: 'w', result: 'win', ending: 'checkmate', moves: 19, ms: 142_000, undos: 0 },
  { bot: 'scout', color: 'b', result: 'win', ending: 'checkmate', moves: 24, ms: 201_000, undos: 0 },
  { bot: 'herald', color: 'w', result: 'win', ending: 'checkmate', moves: 31, ms: 356_000, undos: 0 },
  { bot: 'herald', color: 'w', result: 'loss', ending: 'resign', moves: 22, ms: 240_000, undos: 0 },
  { bot: 'artisan', color: 'b', result: 'draw', ending: 'repetition', moves: 44, ms: 612_000, undos: 1 },
  { bot: 'artisan', color: 'w', result: 'win', ending: 'checkmate', moves: 38, ms: 547_000, undos: 0 },
  { bot: 'sentinel', color: 'w', result: 'loss', ending: 'checkmate', moves: 41, ms: 703_000, undos: 0 },
  { bot: 'strategist', color: 'b', result: 'loss', ending: 'checkmate', moves: 29, ms: 488_000, undos: 0 },
  { bot: 'orchestrator', color: 'w', result: 'loss', ending: 'checkmate', moves: 23, ms: 391_000, undos: 0 },
];
