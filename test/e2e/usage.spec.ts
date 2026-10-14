// E2E of the usage strip in the top bar (UsageBar.tsx) on the frozen demo: today's spend, the Claude 5-hour and week
// windows with their reset times, Cursor's estimate (≈ with its margin), and the detail panel with the reason Cursor's plan usage is missing;
// screenshots in dark and light theme and at 1280 px (test-results/shots/usage-*.png). Then the real app on a Cursor
// ledger and a usage CSV in test folders (SB_CURSOR_LEDGER, SB_DOWNLOADS): "≈ $" while estimated, exact once the CSV
// covers the day, and the Costi page says the same. The app runs hidden (SB_HIDDEN).
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import os from 'node:os';
import { launch, launchDemo, setSize, shot } from './helpers';

const SHOTS = path.resolve(import.meta.dirname, '..', '..', 'test-results', 'shots');
async function clip(page: Page, name: string, testid: string): Promise<void> {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.getByTestId(testid).screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled' });
}

for (const scheme of ['dark', 'light'] as const) {
  test(`usage strip always shows today, Claude 5 h / week with resets and Cursor (${scheme})`, async () => {
    const { app, page } = await launchDemo({ scheme });
    if (scheme === 'light') { // the app's own theme setting (default dark)
      await page.getByTestId('settings').click();
      await page.getByTestId('theme-light').click();
      await expect(page.locator('html[data-theme="light"]')).toHaveCount(1);
    }
    const bar = page.getByTestId('usage');
    await expect(bar).toBeVisible();
    await expect(page.getByTestId('usage-today')).toHaveText(/\d+,\d\d \$/);
    await expect(page.getByTestId('usage-5h')).toContainText('42%');
    await expect(page.getByTestId('usage-5h')).toContainText('↻');
    await expect(page.getByTestId('usage-week')).toContainText('31%');
    await expect(page.getByTestId('usage-cursor')).toContainText('≈ 1,84 $');
    expect(await page.getByTestId('topbar').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0); // nothing pushed out
    await clip(page, `usage-bar-${scheme}`, 'topbar');

    await bar.click();
    const pop = page.getByTestId('usage-pop');
    await expect(pop).toBeVisible();
    await expect(page.getByTestId('usage-pop-5h')).toContainText('Si azzera alle');
    await expect(page.getByTestId('usage-pop-week')).toContainText('Si azzera');
    await expect(page.getByTestId('usage-pop-cursor')).toContainText('Non disponibile');
    await expect(page.getByTestId('usage-pop-cursor')).toContainText('export CSV');
    await expect(pop).toContainText('±9%');
    await expect(page.getByTestId('usage-pop-cursor-est')).toHaveText('stima');
    await expect(pop).toContainText('Chat aperte');
    await clip(page, `usage-pop-${scheme}`, 'usage-pop');
    await shot(page, `usage-${scheme}`);
    await page.keyboard.press('Escape');
    await expect(pop).toBeHidden();
    await app.close();
  });
}

test('usage strip fits the top bar at 1280 px', async () => {
  const { app, page } = await launchDemo({ width: 1280, height: 800 });
  await setSize(app, 1280, 800);
  await expect(page.getByTestId('usage-5h')).toContainText('42%');
  await expect(page.getByTestId('usage-week')).toContainText('31%');
  const overflow = await page.getByTestId('topbar').evaluate(el => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await clip(page, 'usage-bar-1280', 'topbar');
  await app.close();
});

test('Cursor today: estimated from the ledger (≈, margin), exact once a usage CSV covers it; the Costi page agrees', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-ledger-')), dl = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-dl-'));
  const t = Date.now() - 60e3;
  // one turn of 1M uncached grok-4.7 input = 2 $ at list price
  fs.writeFileSync(path.join(dir, 'cursor-ledger.jsonl'), JSON.stringify({ at: t, source: 'hook', conversationId: 'c1', generationId: 'g1', model: 'grok-4.7', input: 1e6, cacheWrite: 0, cacheRead: 0, output: 0 }) + '\n');
  const env = { SB_CURSOR_LEDGER: dir, SB_DOWNLOADS: dl };
  let { app, page } = await launch(env);
  await expect(page.getByTestId('usage-cursor-value')).toHaveText('≈ 2,00 $');
  await page.getByTestId('usage').click();
  await expect(page.getByTestId('usage-pop')).toContainText('±20%');
  await expect(page.getByTestId('usage-pop')).toContainText('nessun CSV ancora');
  await clip(page, 'usage-cursor-estimate', 'usage-pop');
  await app.close();

  // the user exports the CSV: today's row is exact (1,70 $ instead of the 2,00 $ estimate)
  const csv = path.join(dl, 'team-usage-events-1-today.csv');
  fs.writeFileSync(csv, `Date,User,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost
"${new Date(t - 1000).toISOString()}",me,Included,grok-4.7-low,No,0,1000000,0,0,1000000,"$1.70"
`);
  // a synthetic brain (its data server answers /api/cost), so the Costi page renders
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-brain-'));
  const FIX = path.resolve(import.meta.dirname, '..', 'fixtures', 'brain-ui');
  fs.mkdirSync(path.join(brain, 'ops', 'tools'), { recursive: true });
  fs.copyFileSync(path.join(FIX, 'brain-site.mjs'), path.join(brain, 'ops', 'tools', 'brain-site.mjs'));
  fs.copyFileSync(path.join(FIX, 'data.mjs'), path.join(brain, 'ops', 'tools', 'brain-ui-data.mjs'));
  ({ app, page } = await launch({ ...env, SB_BRAIN: brain }));
  await expect(page.getByTestId('usage-cursor-value')).toHaveText('1,70 $');
  await page.getByTestId('usage').click();
  await expect(page.getByTestId('usage-pop')).toContainText('dal CSV delle');
  await expect(page.getByTestId('usage-pop-cursor-est')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByTestId('nav-costi').click();
  await expect(page.getByTestId('bx-cursor-today')).toContainText('1,70', { timeout: 30_000 });
  await expect(page.getByTestId('bx-cursor-today')).toContainText('esatto');
  await shot(page, 'usage-cursor-costi');
  await app.close();
});
