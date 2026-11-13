// Runs on main's Windows gate: persistent column, the agents' strips in the Grindhouse (SPEC 19) and the custom picker.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

test('the Grindhouse keeps the coordinator beside expandable agent strips', async () => {
  const { app, page } = await launchDemo();
  try {
    await page.getByTestId('nav-home').click();
    const column = page.getByTestId('orchestrator-overlay');
    const initial = await column.boundingBox();
    expect(initial).not.toBeNull();
    await expect(page.getByTestId('page-home').getByTestId('view-agents')).toBeVisible();
    await expect(page.getByTestId('page-back')).toHaveCount(0); // every way back leads here
    const expand = page.getByTestId('chat-expand-fix');
    const was = await expand.getAttribute('aria-expanded');
    await expand.click();
    await expect(expand).not.toHaveAttribute('aria-expanded', was ?? '');
    await expand.click();
    await expect(expand).toHaveAttribute('aria-expanded', was ?? '');
    await page.getByTestId('orchestrator-resize').focus();
    await page.keyboard.press('ArrowLeft');
    expect((await column.boundingBox())!.width).toBeGreaterThan(initial!.width);
    await page.keyboard.press('Control+r');
    await expect(column).toBeVisible();
    await shot(page, 'coordinator-home');
    const width = (await column.boundingBox())!.width;
    await page.getByTestId('settings').click();
    await page.getByTestId('settings-all').click();
    await expect(page.getByTestId('settings-page')).toBeVisible();
    expect((await column.boundingBox())!.width).toBeLessThan(width);
    const select = page.getByTestId('st-language-select');
    await expect(select).toBeVisible();
    await select.click();
    await expect(page.locator('.ui-select-list')).toBeVisible();
    await shot(page, 'coordinator-picker');
    await page.keyboard.press('Escape');
    await expect(page.locator('.ui-select-list')).toHaveCount(0);
  } finally { await app.close(); }
});
