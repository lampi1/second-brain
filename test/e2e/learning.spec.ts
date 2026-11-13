// E2E of the Apprendimento page (ADR 0109) on the frozen demo: the counter with one change per verdict, the «Da guardare»
// panel with the Strategist update that made things worse and its Annulla, a corrections curve per role with the
// changes as marks, the list filtered by a tile (and back), and the same claim under a change on the Memoria page's maintenance
// panel. Screenshots dark and light in test-results/shots/learning-*.png.
import { expect, test, type Page } from '@playwright/test';
import { goPage, launchDemo, shot } from './helpers';

/** G J (helpers.ts goPage has no entry for it: kept out of a file another branch is changing) */
async function goLearning(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('g');
  await page.keyboard.press('j');
}

async function theme(page: Page, scheme: 'dark' | 'light') {
  await page.evaluate(t => window.sb.invoke('settings:set', { theme: t }), scheme);
  await page.emulateMedia({ colorScheme: scheme });
  await page.waitForTimeout(250);
}

test('Apprendimento: verdicts, the change to look at, curves per role, the list and the claim on Memoria', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchDemo({ height: 2300 });
  try {
    await goLearning(page);
    const lr = page.getByTestId('learning-page');
    await expect(lr.getByTestId('lr-k-aiuta')).toContainText('1');
    await expect(lr.getByTestId('lr-k-peggiora')).toContainText('1');
    await expect(lr.getByTestId('lr-k-nessun-effetto')).toContainText('1');
    await expect(lr.getByTestId('lr-k-annullato')).toContainText('1');
    await expect(lr.getByTestId('lr-worse')).toContainText('Strategist: piani più brevi');
    await expect(lr.getByTestId('lr-worse').getByTestId('bm-undo')).toBeVisible();
    await expect(lr.getByTestId('lr-curve-artisan').locator('.lr-mark')).not.toHaveCount(0);
    await expect(lr.getByTestId('lr-changes')).toContainText('IC 90%');
    await shot(page, 'learning-dark');
    await lr.getByRole('button', { name: /^Beneficio provato: 1/ }).click();
    await expect(lr.getByTestId('lr-changes').getByTestId('bm-change')).toHaveCount(1);
    await expect(lr.getByTestId('lr-changes')).toContainText('Artisan: prima di riportare');
    await shot(page, 'learning-filtered-dark');
    await lr.getByRole('button', { name: /^Beneficio provato: 1/ }).click();
    await theme(page, 'light');
    await shot(page, 'learning-light');
    await goPage(page, 'memoria');
    await page.getByTestId('mh-tab-file').click(); // the memory's files and their upkeep (ADR 0122)
    await expect(page.getByTestId('bm-maint-memory').getByTestId('bm-claim').first()).toBeVisible();
  } finally { await app.close(); }
});
