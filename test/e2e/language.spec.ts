// End-to-end: the UI language (ADR 0057). On an English Windows (SB_LANG=en) the default "system" draws the app in
// English from the first render; Settings → Aspetto → Lingua switches it live to Italian and back, with no restart,
// and the choice is saved. Texts are read only for the language row itself (it is what changes); the rest by testid.
// Screenshots: test-results/shots/language-*.png.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

test('Lingua: English from Windows, switched live in Settings and saved', async () => {
  const { app, page } = await launchDemo({ env: { SB_LANG: 'en' } });
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByTestId('settings').click();
  await page.getByTestId('settings-all').click();
  const row = page.getByTestId('st-language');
  await row.scrollIntoViewIfNeeded();
  await expect(row).toContainText('Language');
  await expect(page.getByTestId('st-language-choice-system')).toHaveAttribute('aria-checked', 'true');
  await shot(page, 'language-en');

  await page.getByTestId('st-language-choice-it').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  // the tree re-mounted: the page is still open, now in Italian
  await expect(page.getByTestId('st-language')).toContainText('Lingua');
  await expect(page.getByTestId('st-language-choice-it')).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => page.evaluate(async () => (await window.sb.invoke('settings:get', undefined)).language)).toBe('it');
  await page.getByTestId('st-language').scrollIntoViewIfNeeded();
  await shot(page, 'language-it');

  await page.getByTestId('st-language-choice-system').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await app.close();
});

test('Lingua: an Italian Windows stays Italian', async () => {
  const { app, page } = await launchDemo();
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  await app.close();
});
