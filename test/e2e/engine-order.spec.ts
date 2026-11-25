// The one order of the engines (ADR 0359, EngineOrder.tsx) in the demo: Impostazioni → Motori shows the order with its
// thresholds, the keyboard moves an engine, the choice is saved, and a role's page shows its exception. Seen at 1280 and
// 375 px with nothing cut off. Demo data only.
import { expect, test } from '@playwright/test';
import { goPage, launchDemo, openAgents, setSize, shot } from './helpers';

test('the engine order is set once, by keyboard too, and reads at 1280 and 375 px', async () => {
  const { app, page } = await launchDemo({ width: 1280, height: 900, config: { engineOrder: ['cursor', 'claude'], engineThresholds: { cursor: 80 }, engineOn: { claude: true, cursor: true }, engines: { claude: true, cursor: true } } });
  try {
    await goPage(page, 'impostazioni');
    const box = page.getByTestId('st-engine-order');
    await box.scrollIntoViewIfNeeded();
    const rows = box.locator('.eo-row');
    await expect(rows.first()).toHaveAttribute('data-testid', 'engine-order-cursor');
    await expect(page.getByTestId('engine-threshold-cursor')).toContainText('80%');
    await shot(page, 'engine-order-1280');
    // the keyboard does what the mouse does
    await page.getByTestId('engine-order-cursor-down').focus();
    await page.keyboard.press('Enter');
    await expect(rows.first()).toHaveAttribute('data-testid', 'engine-order-claude');
    await setSize(app, 375, 812);
    await box.scrollIntoViewIfNeeded();
    expect(await box.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await shot(page, 'engine-order-375');
    await setSize(app, 1280, 900);
    await openAgents(page, 'scout');
    await page.getByTestId('role-engine-order-toggle').click();
    await expect(page.getByTestId('role-engine-order').locator('.eo-row').first()).toHaveAttribute('data-testid', 'engine-order-claude');
    await page.getByTestId('role-engine-order').scrollIntoViewIfNeeded();
    await shot(page, 'engine-order-role-1280');
  } finally { await app.close(); }
});
