// E2E of «Quanto ritrova la memoria» (ADR 0235) on the frozen demo: Memoria → Statistiche shows the two percentages
// (words only, words + meaning), what the meaning adds and the facts the words miss, dark and light.
// Screenshots: test-results/shots/recall-check-{dark,light}.png.
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchDemo, shot } from './helpers';

const FIX = path.resolve(import.meta.dirname, '..', 'fixtures', 'brain-ui');
function fixtureBrain(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-recall-'));
  fs.mkdirSync(path.join(d, 'ops', 'tools'), { recursive: true });
  fs.copyFileSync(path.join(FIX, 'brain-site.mjs'), path.join(d, 'ops', 'tools', 'brain-site.mjs'));
  fs.copyFileSync(path.join(FIX, 'data.mjs'), path.join(d, 'ops', 'tools', 'brain-ui-data.mjs'));
  return d;
}

test('Memoria → Statistiche says how well the launch memory finds the right fact', async () => {
  const { app, page } = await launchDemo({ height: 1000, width: 1440, env: { SB_BRAIN: fixtureBrain() } });
  try {
    await page.getByTestId('nav-memoria').click();
    await page.getByTestId('mh-tab-statistiche').click();
    const card = page.getByTestId('mm-recall');
    await expect(card).toBeVisible({ timeout: 30000 });
    await expect(card).toHaveAttribute('data-state', 'ready');
    await expect(card).toContainText('69%');
    await expect(card).toContainText('88%');
    await expect(page.getByTestId('mm-recall-find')).toContainText('9');
    await card.locator('summary').click();
    await card.scrollIntoViewIfNeeded();
    await shot(page, 'recall-check-dark');
    await page.evaluate(() => window.sb.invoke('settings:set', { theme: 'light' }));
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(250);
    await shot(page, 'recall-check-light');
  } finally { await app.close(); }
});
