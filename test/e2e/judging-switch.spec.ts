// The Agenti page's one switch for the independent reviews (2026-10-22): «Abilita controllo livello e performance»,
// off by default, with its estimated cost a day beside it; a click turns it on (judging + judgingSince saved) and the
// text says what it does now; Impostazioni → Ruoli e deleghe no longer has a reviews-per-day count.
// Screenshots in test-results/shots/judging-switch-*.png.
import { expect, test } from '@playwright/test';
import { goPage, launchDemo, shot } from './helpers';

test('one switch with its daily cost turns the reviews on and off', async () => {
  const { app, page } = await launchDemo();
  try {
    await goPage(page, 'agenti');
    const box = page.getByTestId('judging-switch'), toggle = page.getByTestId('judging-on');
    await expect(box).toContainText('Abilita controllo livello e performance');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByTestId('judging-cost')).toContainText('Costo stimato');
    await shot(page, 'judging-switch-off');
    const before = Date.now();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(box).toContainText('ogni lavoro finito viene rivisto');
    const s = await page.evaluate(() => window.sb.invoke('settings:get', undefined));
    expect(s.judging).toBe(true);
    expect(s.judgingSince).toBeGreaterThanOrEqual(before - 60_000);
    await shot(page, 'judging-switch-on');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await goPage(page, 'impostazioni');
    await expect(page.getByTestId('settings-page')).toBeVisible();
    await expect(page.getByTestId('st-delegation-judgeDaily')).toHaveCount(0);
  } finally { await app.close(); }
});
