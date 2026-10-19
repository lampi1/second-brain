// The Guida page's screenshots for docs (docs/screenshots/concept-guide/*.png), from the frozen demo: dark theme,
// 1600x1000, the page collapsed, one card opened («Le run degli agenti») and the search card with its «in arrivo
// (PR #12)» part. Run with the README shots (`npm run shots`, playwright.shots.config.ts); never part of the e2e suite:
// it writes into docs/. The app runs hidden (SB_HIDDEN, set by launch()).
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchDemo } from '../e2e/helpers';

const OUT = path.resolve(import.meta.dirname, '..', '..', 'docs', 'screenshots', 'concept-guide');

let app: ElectronApplication, page: Page;
test.beforeAll(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  ({ app, page } = await launchDemo({ orchestrator: true }));
});
test.afterAll(async () => { await app?.close(); });

async function save(name: string): Promise<void> {
  for (const x of await page.getByTestId('toast-close').all()) await x.click();
  await expect(page.getByTestId('toast')).toHaveCount(0);
  await page.mouse.move(2, 2);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled', caret: 'hide' });
}

test('Guida: collapsed, one card expanded, the search card with PR #12 coming', async () => {
  await page.getByTestId('nav-guida').click();
  await expect(page.getByTestId('guide-page')).toBeVisible();
  await save('guida-collapsed');

  await page.getByTestId('guide-toggle-runs').click();
  await expect(page.getByTestId('guide-body-runs')).toBeVisible();
  await page.getByTestId('guide-card-runs').evaluate(el => el.scrollIntoView({ block: 'start' }));
  await save('guida-expanded');
  await page.getByTestId('guide-toggle-runs').click();

  await page.getByTestId('guide-filter').fill('ricerca');
  await page.getByTestId('guide-toggle-search').click();
  await expect(page.getByTestId('guide-body-search').getByTestId('guide-coming')).toContainText('PR #12');
  await save('guida-search-coming');
});
