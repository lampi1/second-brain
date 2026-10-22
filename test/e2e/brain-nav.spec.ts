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
  fs.writeFileSync(path.join(d,'AGENTS.md'),'# Produzione\n');
  fs.writeFileSync(path.join(d,'map.md'),'# Mappa della memoria\n');
  fs.writeFileSync(path.join(d,'proposals.md'),'# Proposals\n');
  return d;
}
const settled = async (page: Page) => { await expect(page.getByTestId('bx-loading')).toHaveCount(0, { timeout: 30_000 }); };
const clip = (app: ElectronApplication) => app.evaluate(({ clipboard }) => clipboard.readText());
/** the page's link through the palette (the page bar's «Copia link» button is gone, ADR 0125) */
const copyPageLink = async (page: Page) => { await page.keyboard.press('Control+K'); await page.getByTestId('palette-input').fill('Copia il link'); await page.getByTestId('palette-item-copylink').click(); };

test('brain pages: arguments through links and history, page-to-page links, map to a file, one toast area', async () => {
  const { app, page } = await launch({ SB_BRAIN: fixtureBrain() });
  await setSize(app, 1600, 1000);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.getByTestId('app')).toBeVisible();
  // Old file links retain history and open the internal source viewer without an explorer page.
  const fileLink=async(name:string)=>{await page.keyboard.press('Control+K');await page.getByTestId('palette-input').fill('sb://esplora/'+name);await page.keyboard.press('Enter');};
  await fileLink('AGENTS.md');const viewer=page.getByTestId('cited-file-viewer');await expect(viewer).toContainText('Produzione');
  await fileLink('map.md');await expect(viewer).toContainText('Mappa della memoria');
  await copyPageLink(page);  await expect.poll(async()=> (await clip(app)).startsWith('sb://file/')).toBe(true);
  await page.keyboard.press('Alt+ArrowLeft');await expect(viewer).toContainText('Produzione');
  await page.keyboard.press('Alt+ArrowRight');await expect(viewer).toContainText('Mappa della memoria');
  await expect(page.getByTestId('nav-esplora')).toHaveCount(0);
  // from Qualità, a link to another page goes through the history (Task's link to Fatto shows only once Task is read)
  await page.keyboard.press('Control+K');await page.getByTestId('palette-input').fill('sb://qualita');await page.keyboard.press('Enter');
  await settled(page);
  await page.getByTestId('brain-page-qualita').getByRole('button', { name: 'Decidi in Memoria' }).click();
  await expect(page.getByTestId('page-memoria')).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.getByTestId('page-qualita')).toBeVisible();
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
  await expect(page.getByTestId('page-file')).toBeVisible();
  await copyPageLink(page);
  await expect.poll(async()=> (await clip(app)).startsWith('sb://file/')).toBe(true);
  await expect(page.getByTestId('page-copy-link')).toHaveCount(0); // no «Copia link» at the top of a page (owner, 2026-10-22)
  await app.close();
});
