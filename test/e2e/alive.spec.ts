// E2E of ADR 0102, the app shows what it does by itself (frozen demo): a collapsed strip says its current step (the
// demo's "Fix totale ordine" runs `dotnet test`), the morning block "Mentre eri via" is one line atop the Orchestrator
// while strips are open, unfolds into its rows and goes away with Ok for the day. The Battito is gone (ADR 0201): no
// settings of its own, no board in Memoria → Idee. SB_MORNING=1: the block is off in the test suites otherwise.
import { expect, test } from '@playwright/test';
import { goPage, launchDemo, shot } from './helpers';

test('strips say their step; the morning line unfolds and Ok dismisses it; no Battito anywhere', async () => {
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
  // the Battito is gone (ADR 0201): Settings → Notifiche has no row of its own, Memoria → Idee «Dell'AI» no board
  await goPage(page, 'impostazioni');
  await expect(page.getByTestId('st-pulse')).toHaveCount(0);
  await page.keyboard.press('Control+K'); await page.getByTestId('palette-input').fill('sb://memoria/idee/ia'); await page.keyboard.press('Enter');
  await expect(page.locator('[data-testid="context-pulse"]')).toHaveCount(0);
  await app.close();
});
