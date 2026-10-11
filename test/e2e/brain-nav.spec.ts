// E2E of the navigation into the brain pages (real app, a synthetic brain from test/fixtures/brain-ui): links inside a
// page carry their argument (an Esplora file) through the history and into sb:// links; a page's links to other pages
// go through the history; the map opens a page (the file) and closes; there is one toast area (the pages' own toasts
// are relayed into the app's).
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, setSize } from './helpers';

const FIX = path.resolve(import.meta.dirname, '..', 'fixtures', 'brain-ui');
function fixtureBrain(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-brain-nav-'));
  fs.mkdirSync(path.join(d, 'ops', 'tools'), { recursive: true });
  fs.copyFileSync(path.join(FIX, 'brain-site.mjs'), path.join(d, 'ops', 'tools', 'brain-site.mjs'));
  fs.copyFileSync(path.join(FIX, 'data.mjs'), path.join(d, 'ops', 'tools', 'brain-ui-data.mjs'));
  return d;
}
const settled = async (page: Page) => { await expect(page.getByTestId('bx-loading')).toHaveCount(0, { timeout: 30_000 }); };
const clip = (app: ElectronApplication) => app.evaluate(({ clipboard }) => clipboard.readText());

test('brain pages: arguments through links and history, page-to-page links, map to a file, one toast area', async () => {
  const { app, page } = await launch({ SB_BRAIN: fixtureBrain() });
  await setSize(app, 1600, 1000);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.getByTestId('app')).toBeVisible();
  // an Esplora file through a pasted internal link
  await page.keyboard.press('Control+K');
  await page.getByTestId('palette-input').fill('sb://esplora/AGENTS.md');
  await page.keyboard.press('Enter');
  const esplora = page.getByTestId('brain-page-esplora');
  await settled(page);
  await expect(esplora.getByTestId('bx-file-md')).toContainText('Produzione');
  // a link inside the file: the argument goes into the history and the page's link
  await esplora.getByTestId('bx-file-md').getByRole('link', { name: 'map.md' }).click();
  await expect(esplora.getByTestId('bx-viewer')).toContainText('Mappa della memoria');
  await page.getByTestId('page-copy-link').click();
  await expect.poll(() => clip(app)).toBe('sb://esplora/map.md');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(esplora.getByTestId('bx-file-md')).toContainText('Produzione');
  await page.keyboard.press('Alt+ArrowRight');
  await expect(esplora.getByTestId('bx-viewer')).toContainText('Mappa della memoria');
  // one toast area: the page's own toast shows in the app's toasts, the page's toast element stays hidden
  await esplora.getByRole('button', { name: 'Copia il percorso' }).click();
  await expect(page.getByTestId('toasts')).toContainText('Percorso copiato');
  await expect(page.locator('.bx-toast:visible')).toHaveCount(0);
  // from Oggi, a link to another page goes through the history
  await page.getByTestId('nav-home').click();
  await settled(page);
  await page.getByTestId('brain-page-home').getByRole('button', { name: 'Dove va la spesa →' }).click();
  await expect(page.getByTestId('page-costi')).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.getByTestId('page-home')).toBeVisible();
  // the map (2D list) opens a file and closes
  await page.keyboard.press('Control+K');
  await page.getByTestId('palette-input').fill('sb://mappa/flat');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('bx-map-flat')).toContainText('mem.mjs');
  await page.getByTestId('bx-map-flat').getByRole('button', { name: /reviewer/ }).first().click();
  const piece = page.getByTestId('bx-map-piece');
  await expect(piece).toBeVisible();
  const file = piece.locator('.bx-go').first();
  const name = (await file.textContent())?.trim() ?? '';
  expect(name).not.toBe('');
  await file.click();
  await expect(page.getByTestId('brain-map')).toHaveCount(0);
  await expect(page.getByTestId('page-esplora')).toBeVisible();
  await page.getByTestId('page-copy-link').click();
  await expect.poll(() => clip(app)).toBe(`sb://esplora/${name}`);
  await app.close();
});
