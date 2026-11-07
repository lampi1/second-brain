// End-to-end: the ACP catalog's proposals (ADR 0221) on the demo. Settings → Account e strumenti lists them under «Altri
// agenti ACP (proposte)», each off, with its start command and install page; opening Settings turns none on and trusts
// none; the sidebar's «Agenti» keeps its name; «Attiva» on one records its start definition and switches it on, so it
// leaves the proposals. Screenshot: test-results/shots/acp-catalog.png.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

test('Settings: the ACP catalog proposals are listed off and one turns on only on the user\'s click', async () => {
  const { app, page } = await launchDemo();
  try {
    await page.getByTestId('settings').click();
    await page.getByTestId('settings-all').click();
    const catalog = page.getByTestId('settings-page').getByTestId('st-acp-catalog');
    await catalog.scrollIntoViewIfNeeded();
    await expect(catalog).toContainText('Altri agenti ACP');
    const kilo = catalog.getByTestId('st-catalog-kilo');
    await expect(kilo).toContainText('Proposta, spenta');
    await expect(kilo.locator('code')).toContainText('kilo');
    await expect(kilo.getByRole('link')).toHaveCount(1);
    await expect(catalog.locator('[data-testid^="st-catalog-"]')).toHaveCount(9);
    // the agents page keeps its own name (a shared i18n key would rename it)
    await expect(page.locator('nav').getByText('Agenti', { exact: true }).first()).toBeVisible();
    // opening Settings turns nothing on and trusts nothing
    const before = await page.evaluate(async () => window.sb.invoke('settings:get', undefined));
    expect(before.engineOn.kilo).not.toBe(true);
    await page.mouse.move(2, 2);
    await shot(page, 'acp-catalog');
    await kilo.getByRole('button', { name: 'Attiva' }).click();
    await expect(catalog.getByTestId('st-catalog-kilo')).toHaveCount(0);
    const info = await page.evaluate(async () => window.sb.invoke('app:info', undefined));
    expect(info.engines.find(e => e.id === 'kilo')).toMatchObject({ source: 'catalog', trusted: true });
    expect((await page.evaluate(async () => window.sb.invoke('settings:get', undefined))).engineOn.kilo).toBe(true);
  } finally {
    await app.close();
  }
});
