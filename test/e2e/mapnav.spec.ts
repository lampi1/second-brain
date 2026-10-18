// Main-only coverage of map navigation beside the persistent coordinator, including resize and focus regressions.
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchDemo, shot } from './helpers';

test('Dashboard and the 3D map keep the coordinator beside exploration and discussion', async () => {
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
    const coordinator = page.getByTestId('regia-overlay');
    const dashboard = page.getByTestId('dashboard');
    const besideCoordinator = async (selector: string) => {
      await expect(coordinator).toBeVisible();
      await expect.poll(async () => {
        const content = await page.locator(selector).boundingBox();
        const column = await coordinator.boundingBox();
        return !!content && !!column && content.width > 0 && content.x + content.width <= column.x + 1;
      }).toBe(true);
    };
    await besideCoordinator('[data-testid="dashboard"]');
    await expect(page.getByLabel('Legenda')).toBeVisible();
    await expect(page.locator('.dash-label').first()).toBeVisible();
    await page.locator('.dash-node').first().click();
    await expect(page.locator('.dash-inspector h2')).toBeVisible();
    await shot(page, 'mapnav-selected');
    await page.getByRole('button', { name: 'Esplora in 3D' }).click();
    await expect(page.getByTestId('brain-map')).toBeVisible();
    await expect(page.getByTestId('brain-map')).not.toHaveAttribute('aria-modal', 'true');
    await besideCoordinator('[data-testid="brain-map"]');
    const canvas = page.getByTestId('bx-map-canvas').locator('canvas');
    await expect(canvas).toBeVisible();
    const initialWidth = (await canvas.boundingBox())!.width;
    await page.getByTestId('regia-resize').focus();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await canvas.boundingBox())?.width ?? initialWidth).toBeLessThan(initialWidth);
    await besideCoordinator('[data-testid="brain-map"]');
    await page.keyboard.press('Control+r');
    await expect(page.getByTestId('brain-map')).toBeVisible();
    await expect.poll(() => coordinator.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await shot(page, 'mapnav-beside-orchestrator');
    await page.getByTestId('bx-map-close').click();
    await page.locator('.dash-inspector .dash-discuss').click();
    await expect(page.getByTestId('regia-overlay')).toBeVisible();
    await expect(dashboard).toBeVisible();
    await expect(page.locator('.dash-inspector h2')).toBeVisible();
    await besideCoordinator('[data-testid="dashboard"]');
    await expect.poll(() => coordinator.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Control+r');
    await expect(page.getByTestId('regia-overlay')).toBeVisible();
    await expect(dashboard).toBeVisible();
  } finally { await app.close(); }
});
