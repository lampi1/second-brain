// E2E of the Scacchi page (ADR 0304) on the frozen demo. The lobby lists the six agents with their strength and the
// demo's history (fastest wins, last games). A written game against the Artigiano (SB_CHESS_SCRIPT: the bot answers
// from a list instead of asking Stockfish) plays an en passant, a promotion from the picker and a castling by clicks,
// takes a move back, and a resignation is stored. A fool's mate with black against the scripted white ends with the
// end card and «nuovo record»; the card closes to look at the board and «Rivincita» starts again; a second win in a row is a streak, shown on the card and in the lobby. One game asks the real engine (the process in out/chess-engine) for its first move.
// Screenshots dark.
import { expect, test, type Page } from '@playwright/test';
import { goPage, launchDemo, shot } from './helpers';

const sq = (page: Page, s: string) => page.getByTestId(`chess-sq-${s}`);
const piece = (page: Page, at: string) => page.locator(`.chess-piece[data-at="${at}"]`);
/** One user move by two clicks, then the bot's answer shown on `answer`. */
async function move(page: Page, from: string, to: string, answer?: string): Promise<void> {
  await sq(page, from).click();
  await expect(sq(page, to)).toHaveClass(/target/);
  await sq(page, to).click();
  if (answer) await expect(piece(page, answer)).toHaveCount(1);
}

test('the lobby shows the six agents and the history; a written game: en passant, promotion, castling, undo, resign', async () => {
  test.setTimeout(120_000);
  // the bot (black) answers by ply: a6, d5 (beside the e5 pawn), h6, h5, Rxb8, h4, h3
  const script = 'a2a3 a7a6 a2a3 d7d5 a2a3 h7h6 a2a3 h6h5 a2a3 a8b8 a2a3 h5h4 a2a3 h4h3 a2a3 b7b6';
  const { app, page } = await launchDemo({ env: { SB_CHESS_SCRIPT: script } });
  try {
    await goPage(page, 'scacchi');
    await expect(page.getByTestId('chess-lobby')).toBeVisible();
    await expect(page.locator('.chess-bot')).toHaveCount(6);
    await expect(page.getByTestId('chess-bot-orchestrator')).toContainText('2200+');
    await expect(page.getByTestId('chess-bot-scout')).toContainText('~600');
    await expect(page.getByTestId('chess-streak-scout')).toHaveClass(/on/); // the demo's two wins in a row
    await expect(page.getByTestId('chess-fastest').getByTestId('chess-history-row')).toHaveCount(4);
    await expect(page.getByTestId('chess-recent').getByTestId('chess-history-row')).toHaveCount(9);
    await shot(page, 'chess-lobby-dark');

    await page.getByTestId('chess-bot-artisan').click();
    await page.getByTestId('chess-play').click();
    await expect(page.getByTestId('chess-game')).toHaveAttribute('data-bot', 'artisan');
    await expect(page.locator('.chess-piece')).toHaveCount(32);
    await expect(page.getByTestId('chess-bubble')).toBeVisible(); // the opening line

    await move(page, 'e2', 'e4', 'a6');
    await move(page, 'e4', 'e5', 'd5');
    // en passant: the pawn lands on d6, the pawn it passed leaves d5
    await move(page, 'e5', 'd6', 'h6');
    await expect(piece(page, 'd5')).toHaveCount(0);
    await expect(page.locator('.chess-piece')).toHaveCount(31);
    await expect(page.getByTestId('chess-moves')).toContainText('exd6');
    await move(page, 'd6', 'c7', 'h5');
    // the promotion: the picker on the b file, a queen chosen
    await sq(page, 'c7').click();
    await sq(page, 'b8').click();
    await expect(page.getByTestId('chess-promo')).toBeVisible();
    await shot(page, 'chess-promotion-dark');
    await page.getByTestId('chess-promo-q').click();
    await expect(page.getByTestId('chess-moves')).toContainText('cxb8=Q');
    await expect(page.locator('.chess-piece[data-piece="br"][data-at="b8"]')).toHaveCount(1); // the bot took it back
    await move(page, 'g1', 'f3', 'h4');
    await move(page, 'f1', 'c4', 'h3');
    // castling: the king to g1 brings the rook to f1
    await move(page, 'e1', 'g1', 'b6');
    await expect(page.locator('.chess-piece[data-piece="wr"][data-at="f1"]')).toHaveCount(1);
    await expect(page.getByTestId('chess-moves')).toContainText('O-O');
    await shot(page, 'chess-game-dark');

    // a move taken back: the castling and its answer are gone
    await page.getByTestId('chess-undo').click();
    await expect(page.locator('.chess-piece[data-piece="wk"][data-at="e1"]')).toHaveCount(1);
    await expect(piece(page, 'b6')).toHaveCount(0);

    await page.getByTestId('chess-resign').click();
    await expect(page.getByTestId('chess-over')).toBeVisible();
    await expect(page.getByTestId('chess-game')).toHaveAttribute('data-over', 'loss');
    await page.getByTestId('chess-change').click();
    await expect(page.getByTestId('chess-recent').getByTestId('chess-history-row')).toHaveCount(10);
  } finally { await app.close(); }
});

test('a mate with black ends the game with the end card and a new record', async () => {
  test.setTimeout(120_000);
  // the bot (white) walks into the fool's mate: f3, g4
  const { app, page } = await launchDemo({ env: { SB_CHESS_SCRIPT: 'f2f3 a2a3 g2g4' } });
  try {
    await goPage(page, 'scacchi');
    await page.getByTestId('chess-bot-orchestrator').click();
    await page.getByTestId('chess-side-b').click();
    await page.getByTestId('chess-play').click();
    await expect(page.getByTestId('chess-board')).toHaveAttribute('data-side', 'b');
    await expect(piece(page, 'f3')).toHaveCount(1);
    await move(page, 'e7', 'e5', 'g4');
    await move(page, 'd8', 'h4');
    await expect(page.getByTestId('chess-over')).toBeVisible();
    await expect(page.getByTestId('chess-game')).toHaveAttribute('data-over', 'win');
    await expect(page.getByTestId('chess-new-record')).toBeVisible(); // the first win against the Orchestrator
    await expect(page.locator('.chess-sq.check')).toHaveAttribute('data-square', 'e1');
    await shot(page, 'chess-over-dark');
    // the card closes to look at the final position; «Rivincita» stays in the panel
    await page.getByTestId('chess-over-close').click();
    await expect(page.getByTestId('chess-over')).toHaveCount(0);
    await expect(page.locator('.chess-piece[data-piece="bq"][data-at="h4"]')).toHaveCount(1);
    await page.getByTestId('chess-again').click();
    await expect(page.getByTestId('chess-game')).not.toHaveAttribute('data-over');
    await expect(piece(page, 'h4')).toHaveCount(0);
    await expect(piece(page, 'f3')).toHaveCount(1);
    // a second win in a row is a streak, and the longest against the Orchestrator
    await move(page, 'e7', 'e5', 'g4');
    await move(page, 'd8', 'h4');
    await expect(page.getByTestId('chess-streak')).toContainText('2');
    await expect(page.getByTestId('chess-new-record')).toHaveCount(0); // not faster than the first
    await shot(page, 'chess-streak-dark');
    await page.getByTestId('chess-change').click();
    await expect(page.getByTestId('chess-streak-orchestrator')).toContainText('2');
  } finally { await app.close(); }
});

test('the real engine answers the first move', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchDemo();
  try {
    await goPage(page, 'scacchi');
    await page.getByTestId('chess-bot-sentinel').click();
    await page.getByTestId('chess-play').click();
    await move(page, 'e2', 'e4');
    // Stockfish's own process starts at this first request and answers: black has moved, it is the user's turn again
    await expect(page.getByTestId('chess-board')).toHaveAttribute('data-turn', 'w', { timeout: 60_000 });
    await expect(page.getByTestId('chess-moves').locator('li').first().locator('span').nth(2)).not.toBeEmpty();
    await expect(page.getByTestId('chess-problem')).toHaveCount(0);
  } finally { await app.close(); }
});
