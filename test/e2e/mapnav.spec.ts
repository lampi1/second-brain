// Main-only visual coverage for the consolidated map entry and full-width exploration; never run on a branch.
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchDemo, shot } from './helpers';

test('Dashboard owns map navigation and restores the coordinator for discussion', async () => {
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-mapnav-'));
  const tools = path.join(brain, 'ops', 'tools');
  fs.mkdirSync(tools, { recursive: true });
  const fixture = path.resolve(import.meta.dirname, '..', 'fixtures', 'brain-ui');
  fs.copyFileSync(path.join(fixture, 'brain-site.mjs'), path.join(tools, 'brain-site.mjs'));
  fs.copyFileSync(path.join(fixture, 'data.mjs'), path.join(tools, 'brain-ui-data.mjs'));
  const { app, page } = await launchDemo({ env: { SB_BRAIN: brain } });
  try {
    await page.getByTestId('nav-dashboard').click();
    await page.getByRole('tab', { name: 'Mappa brain' }).click();
    await expect(page.getByTestId('regia-overlay')).toHaveCount(0);
    await expect(page.getByLabel('Legenda')).toBeVisible();
    await expect(page.locator('.dash-label').first()).toBeVisible();
    await page.locator('.dash-node').first().click();
    await expect(page.locator('.dash-inspector h2')).toBeVisible();
    await shot(page, 'mapnav-selected');
    await page.getByRole('button', { name: 'Esplora in 3D' }).click();
    await expect(page.getByTestId('brain-map')).toBeVisible();
    await expect(page.getByTestId('regia-overlay')).toHaveCount(0);
    await shot(page, 'mapnav-full-width');
    await page.getByTestId('bx-map-close').click();
    await page.locator('.dash-inspector .dash-discuss').click();
    await expect(page.getByTestId('regia-overlay')).toBeVisible();
    await expect(page.getByTestId('page-home')).toBeVisible();
    await page.getByTestId('nav-dashboard').click();
    await page.keyboard.press('Control+r');
    await expect(page.getByTestId('regia-overlay')).toBeVisible();
    await expect(page.getByTestId('page-home')).toBeVisible();
  } finally { await app.close(); }
});
