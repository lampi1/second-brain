// E2E of ADR 0102, the app shows what it does by itself (frozen demo): a collapsed strip says its current step (the
// demo's "Fix totale ordine" runs `dotnet test`), the morning block "Mentre eri via" is one line atop the Orchestrator
// while strips are open, unfolds into its rows and goes away with Ok for the day; the Battito's settings sit in
// Settings → Notifiche with today's spend; its board shows in Dashboard → Spunti. SB_MORNING=1: the block is off in the
// test suites otherwise.
import { expect, test } from '@playwright/test';
import { goPage, launchDemo, shot } from './helpers';

test('strips say their step; the morning line unfolds and Ok dismisses it; the Battito is in sight', async () => {
  const { app, page } = await launchDemo({ env: { SB_MORNING: '1' } });
  // a collapsed working strip: its current command, not a bare "sta lavorando…"
  await expect(page.getByTestId('strip-step-fix')).toContainText('Lancia');
  await expect(page.getByTestId('strip-step-fix').locator('code')).toContainText('dotnet test');
  // strips are open: the morning block is one line atop the Orchestrator
  const line = page.getByTestId('morning-line');
  await expect(line).toBeVisible();
  await expect(line).toContainText('Mentre eri via');
  await page.getByTestId('morning-line-details').click();
  await expect(line.getByTestId('morning-block')).toBeVisible();
  await expect(line.getByTestId('morning-row-runs')).toBeVisible();
  await shot(page, 'alive-morning-line');
  await page.getByTestId('morning-line-ok').click();
  await expect(line).toHaveCount(0);
  // Settings → Notifiche: the Battito's switch, times and budget, with today's spend
  await goPage(page, 'impostazioni');
  await expect(page.getByTestId('st-pulse')).toBeVisible();
  await expect(page.getByTestId('st-pulse-slots')).toHaveValue('08:30, 13:00, 18:30');
  await expect(page.getByTestId('st-pulse-today')).toContainText('Oggi');
  await page.getByTestId('st-pulse').scrollIntoViewIfNeeded();
  await shot(page, 'alive-settings-pulse');
  // Dashboard → Spunti: the Battito's board, at most three cards
  await goPage(page, 'dashboard');
  await page.locator('#dash-tab-tips').click();
  const board = page.locator('[data-testid="context-pulse"][data-place="board"]');
  await expect(board).toBeVisible();
  expect(await board.locator('[data-testid^="context-card-"]').count()).toBeLessThanOrEqual(3);
  await shot(page, 'alive-dashboard-board');
  await app.close();
});
