// The finished chess games (ADR 0304, src/main/chess/store.ts): stored in app.db and read back as the history, the
// newest rows kept, the shape checked, memory only without a database, the demo's made-up history.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeAppDbs } from '../../src/main/app-db';
import { ChessStore, DEMO_CHESS_GAMES } from '../../src/main/chess/store';
import { cleanGame } from '../../src/shared/chess';

const dirs: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-chess-')); dirs.push(d); return d; };
afterEach(() => { closeAppDbs(); for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const win = { bot: 'scout', color: 'w', result: 'win', ending: 'checkmate', moves: 20, ms: 120_000, undos: 0 } as const;

describe('the chess games in app.db', () => {
  it('stores a game, returns it with the history, and reads it back after a restart', () => {
    const dir = tmp();
    let t = 1000;
    const a = new ChessStore();
    a.init({ userData: dir, now: () => t });
    const first = a.save(win)!;
    expect(first.game).toMatchObject({ ...win, id: 1, at: 1000 });
    expect(first.history.bots.scout).toMatchObject({ wins: 1, losses: 0, draws: 0 });
    expect(first.history.bots.scout.fastest?.id).toBe(1);
    t = 2000;
    const second = a.save({ ...win, ms: 60_000 })!;
    expect(second.game).toMatchObject({ id: 2, at: 2000, ms: 60_000 });
    expect(second.history.bots.scout.fastest?.id).toBe(2);
    a.close();
    const b = new ChessStore();
    b.init({ userData: dir });
    const h = b.history();
    expect(h.total).toBe(2);
    expect(h.recent.map(g => g.id)).toEqual([2, 1]);
    b.close();
  });
  it('refuses what is not a game', () => {
    const s = new ChessStore();
    s.init({ userData: tmp() });
    expect(s.save({ ...win, bot: 'x' })).toBeNull();
    expect(s.save(null)).toBeNull();
    expect(s.history().total).toBe(0);
    s.close();
  });
});

describe('without a database', () => {
  it('keeps the games in memory', () => {
    const s = new ChessStore();
    s.init({ userData: null, now: () => 5000 });
    expect(s.save(win)!.game).toMatchObject({ id: 1, at: 5000 });
    expect(s.save({ ...win, result: 'loss' })!.game.id).toBe(2);
    expect(s.history()).toMatchObject({ total: 2 });
  });
  it('starts from the demo\'s history: every game a real shape, wins and losses on both sides of the ladder', () => {
    for (const g of DEMO_CHESS_GAMES) expect(cleanGame(g)).toEqual(g);
    const s = new ChessStore();
    s.init({ userData: null, seed: DEMO_CHESS_GAMES, now: () => 1e12 });
    const h = s.history();
    expect(h.total).toBe(DEMO_CHESS_GAMES.length);
    expect(h.bots.scout.wins).toBeGreaterThan(0);
    expect(h.bots.orchestrator.wins).toBe(0);
    expect(h.fastest.length).toBeGreaterThan(0);
    expect(h.recent[0]!.at).toBeLessThan(1e12);
  });
});
