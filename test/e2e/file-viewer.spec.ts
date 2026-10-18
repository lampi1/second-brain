// E2E of the one read-only file viewer (SPEC 22): any local file opens in the app (outside the brain, a dotfile too),
// code is highlighted, CSV is a table with its source a click away, JSON is pretty-printed, a big file says how much
// it shows, and "Show in folder" only selects the file (a hidden run records it, nothing opens).
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, setSize, shot } from './helpers';

const opened = (app: ElectronApplication) => app.evaluate(() => [...((globalThis as unknown as { __sbOpened: string[] }).__sbOpened)]);
const open = async (page: Page, file: string) => { await page.keyboard.press('Control+K'); await page.getByTestId('palette-input').fill('sb://esplora/' + file.replace(/\\/g, '/')); await page.keyboard.press('Enter'); };

test('file viewer: any local file, highlighted code, CSV table, pretty JSON, bounded big file, show in folder', async () => {
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-viewer-brain-'));
  fs.writeFileSync(path.join(brain, 'AGENTS.md'), '# Brain\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-viewer-files-'));
  fs.writeFileSync(path.join(dir, 'app.ts'), 'export const answer = 42;\n// the end\n');
  fs.writeFileSync(path.join(dir, 'people.csv'), 'name;city\nAda;"London, UK"\n');
  fs.writeFileSync(path.join(dir, 'conf.json'), '{"a":{"b":[1,2]}}');
  fs.writeFileSync(path.join(dir, '.env'), 'TOKEN=shown-on-purpose\n');
  fs.writeFileSync(path.join(dir, 'big.log'), 'x'.repeat(1_200_000));
  const { app, page } = await launch({ SB_BRAIN: brain });
  try {
    await setSize(app, 1600, 1000);
    await expect(page.getByTestId('app')).toBeVisible();
    const viewer = page.getByTestId('cited-file-viewer');

    await open(page, path.join(dir, 'app.ts'));
    await expect(viewer.getByTestId('bx-code')).toHaveAttribute('data-highlighted', 'true');
    await expect(viewer.locator('[data-l="1"] .hljs-keyword').first()).toHaveText('export');
    await shot(page, 'file-viewer-code');

    await open(page, path.join(dir, 'people.csv'));
    await expect(viewer.getByTestId('viewer-csv')).toContainText('London, UK');
    await shot(page, 'file-viewer-csv');
    await viewer.getByRole('button', { name: 'Sorgente' }).click();
    await expect(viewer.locator('[data-l="2"]')).toContainText('Ada;"London, UK"');

    await open(page, path.join(dir, 'conf.json'));
    await expect(viewer.locator('[data-l="3"]')).toContainText('"b": [');

    await open(page, path.join(dir, '.env'));
    await expect(viewer).toContainText('TOKEN=shown-on-purpose');

    await open(page, path.join(dir, 'big.log'));
    await expect(viewer.getByTestId('viewer-truncated')).toContainText('977 KB');

    await viewer.getByTestId('viewer-show-in-folder').click();
    await expect.poll(() => opened(app)).toEqual([`folder ${fs.realpathSync.native(path.join(dir, 'big.log'))}`]);
  } finally { await app.close(); }
});
