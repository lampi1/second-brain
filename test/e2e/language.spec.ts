// End-to-end: the UI language (ADR 0057). On an English Windows (SB_LANG=en) the default "system" draws the app in
// English from the first render; Settings → Aspetto e lingua → Lingua (a Select) switches it live to Italian and back,
// with no restart, and the choice is saved. Texts are read only for the language group (it is what changes); the rest
// by testid.
// Screenshots: test-results/shots/language-*.png.
import { expect, test } from '@playwright/test';
import { choose, launchDemo, shot } from './helpers';

test('Lingua: English from Windows, switched live in Settings and saved', async () => {
  const { app, page } = await launchDemo({ env: { SB_LANG: 'en' } });
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('[data-testid^="chat-menu-"]').first()).toHaveAttribute('aria-label', 'Rename, model, permissions and more');
  await shot(page, 'language-chat-controls-en');
  await page.getByTestId('settings').click();
  await page.getByTestId('settings-all').click();
  const group = page.getByTestId('st-group-appearance');
  const select = page.getByTestId('st-language-select');
  await select.scrollIntoViewIfNeeded();
  await expect(group).toContainText('Language');
  await expect(select).toHaveAttribute('data-value', 'system');
  await shot(page, 'language-en');

  await choose(select, 'it');
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  // the tree re-mounted: the page is still open, now in Italian
  await expect(page.getByTestId('st-group-appearance')).toContainText('Lingua');
  await expect(page.getByTestId('st-language-select')).toHaveAttribute('data-value', 'it');
  await expect.poll(() => page.evaluate(async () => (await window.sb.invoke('settings:get', undefined)).language)).toBe('it');
  await page.getByTestId('st-language-select').scrollIntoViewIfNeeded();
  await shot(page, 'language-it');

  await choose(page.getByTestId('st-language-select'), 'system');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await app.close();
});

test('Lingua: an Italian Windows stays Italian', async () => {
  const { app, page } = await launchDemo();
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  await app.close();
});
