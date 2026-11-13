// End-to-end: the UI language (ADR 0057, 0117). On an English Windows (SB_LANG=en) the default "system" draws the app in
// English from the first render; Settings → Aspetto → Lingua switches it live to Italian and back, with no restart,
// and the choice is saved; a German Windows (SB_LANG=de) draws it in German with Austrian dates. Texts are read only for
// the language row itself (it is what changes); the rest by testid. Screenshots: test-results/shots/language-*.png.
import { expect, test, type Page } from '@playwright/test';
import { launchDemo, shot } from './helpers';

async function languageRow(page: Page) {
  await page.getByTestId('settings').click();
  await page.getByTestId('settings-all').click();
  const select = page.getByTestId('st-language-select');
  await select.scrollIntoViewIfNeeded();
  return select;
}

test('Lingua: English from Windows, switched live in Settings and saved', async () => {
  const { app, page } = await launchDemo({ env: { SB_LANG: 'en' } });
  try {
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('[data-testid^="chat-menu-"]').first()).toHaveAttribute('aria-label', 'Rename, model, permissions and more');
    await shot(page, 'language-chat-controls-en');
    const select = await languageRow(page);
    await expect(select).toHaveAttribute('aria-label', 'Language');
    await shot(page, 'language-en');
    await select.click();
    await page.getByRole('option', { name: 'Italiano' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'it');
    // the tree re-mounted: the page is still open, now in Italian
    await expect(page.getByTestId('st-language-select')).toHaveAttribute('aria-label', 'Lingua');
    await expect.poll(() => page.evaluate(async () => (await window.sb.invoke('settings:get', undefined)).language)).toBe('it');
    await shot(page, 'language-it');
    await page.evaluate(() => window.sb.invoke('settings:set', { language: 'system' }));
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  } finally { await app.close(); }
});

test('Lingua: an Italian Windows stays Italian', async () => {
  const { app, page } = await launchDemo();
  try { await expect(page.locator('html')).toHaveAttribute('lang', 'it'); } finally { await app.close(); }
});

test('Sprache: a German Windows draws the app in German', async () => {
  const { app, page } = await launchDemo({ env: { SB_LANG: 'de' } });
  try {
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    const select = await languageRow(page);
    await expect(select).toHaveAttribute('aria-label', 'Sprache');
    await shot(page, 'language-de');
  } finally { await app.close(); }
});
