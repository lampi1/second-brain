// End-to-end: the language switch in the top bar (ADR 0120, issue #163). It shows the language in force (IT on the
// Italian test Windows), its menu has the Settings options (system, it, en, de); a pick re-draws the UI live, is saved,
// rewrites the brain profile's `Language:` line and shows in Settings' select (and the other way round). In a narrow
// window it stays on screen (the bar's end group) and still works. Screenshots: test-results/shots/lang-switch-*.png,
// dark and light.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { choose, launchDemo, setSize, shot } from './helpers';

const ME = '# Tu\n\n## Who\n\nTu, developer. Language: italiano in chat; code, commits and PR texts in English.\n\n## How to work with Tu\n\n- **Reply style**: short.\n';
const language = (root: string) => /Language: (\S+)/.exec(fs.readFileSync(path.join(root, 'me.md'), 'utf8'))?.[1];

test('Lingua nella barra: same options as Settings, live, saved, the profile follows, also in a narrow window', async () => {
  const brainRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-brain-'));
  fs.writeFileSync(path.join(brainRoot, 'me.md'), ME);
  const { app, page } = await launchDemo({ config: { brainRoot } });
  const button = page.getByTestId('topbar-lang');
  await expect(button).toBeVisible();
  await expect(button).toHaveText('IT');
  await expect(button).toHaveAttribute('data-mode', 'system');
  await shot(page, 'lang-switch-bar-dark');

  await button.click();
  const menu = page.getByTestId('topbar-lang-pop');
  await expect(menu.getByRole('menuitemradio')).toHaveCount(4);
  await expect(page.getByTestId('topbar-lang-system')).toHaveAttribute('aria-checked', 'true');
  await shot(page, 'lang-switch-menu-dark');

  // German: the UI re-draws, the setting is saved, me.md says Deutsch
  await page.getByTestId('topbar-lang-de').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(button).toHaveText('DE');
  await expect.poll(() => page.evaluate(async () => (await window.sb.invoke('settings:get', undefined)).language)).toBe('de');
  await expect.poll(() => language(brainRoot)).toBe('Deutsch');
  await button.click();
  await expect(page.getByTestId('topbar-lang-de')).toHaveAttribute('aria-checked', 'true');
  await shot(page, 'lang-switch-menu-de-dark');
  await page.keyboard.press('Escape');

  // Settings shows the same value, and a pick there moves the bar
  await page.getByTestId('settings').click();
  await page.getByTestId('settings-all').click();
  const select = page.getByTestId('st-language-select');
  await select.scrollIntoViewIfNeeded();
  await expect(select).toHaveAttribute('data-value', 'de');
  await choose(page.getByTestId('st-language-select'), 'en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(button).toHaveText('EN');
  await expect.poll(() => language(brainRoot)).toBe('English');

  // the narrowest window (minWidth 1000): the switch stays on screen and still works
  await setSize(app, 1000, 700);
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1000);
  await expect(button).toBeVisible();
  const box = await button.boundingBox(), width = await page.evaluate(() => window.innerWidth);
  expect(box && box.x + box.width).toBeLessThanOrEqual(width);
  await expect(page.getByTestId('topbar')).toHaveAttribute('data-fit', /\d/); // some fit steps on (no more the last: the bar lost its questions switch, 2026-10-22)
  await shot(page, 'lang-switch-narrow-dark');
  await button.click();
  await page.getByTestId('topbar-lang-system').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  await expect(button).toHaveText('IT');
  await expect.poll(() => language(brainRoot)).toBe('italiano');

  await page.evaluate(() => window.sb.invoke('settings:set', { theme: 'light' }));
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await shot(page, 'lang-switch-narrow-light');
  await setSize(app, 1600, 1000);
  await button.click();
  await shot(page, 'lang-switch-menu-light');
  await app.close();
  fs.rmSync(brainRoot, { recursive: true, force: true });
});
