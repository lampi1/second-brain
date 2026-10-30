// The Agenti page's one switch for the independent reviews (2026-10-22): «Abilita controllo livello e performance»,
// on by default (ADR 0125), with its estimated cost a day and its daily cap beside it (ADR 0203: a nightly sample under
// «Tetto al giorno»); a click turns it off and back on (judging + judgingSince saved) and the text says what it does now;
// a cap choice saves judgingCapUsd; the work roles' cards say when the nightly review last updated them; Impostazioni →
// Ruoli e deleghe no longer has a reviews-per-day count.
// Screenshots in test-results/shots/judging-switch-*.png.
import { expect, test } from '@playwright/test';
import { goPage, launchDemo, shot } from './helpers';

test('one switch with its daily cost turns the reviews on and off', async () => {
  const { app, page } = await launchDemo();
  try {
    await goPage(page, 'agenti');
    const box = page.getByTestId('judging-switch'), toggle = page.getByTestId('judging-on');
    await expect(box).toContainText('Abilita controllo livello e performance');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('judging-cost')).toContainText('Costo stimato');
    await expect(page.getByTestId('judging-cap-1')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('judging-last')).toContainText('Ultima revisione');
    await expect(page.getByTestId('catalog-updated-scout')).toContainText('Aggiornato');
    await expect(page.getByTestId('catalog-updated-orchestrator')).toHaveCount(0);
    await shot(page, 'judging-switch-on');
    await page.getByTestId('judging-cap-2').click();
    await expect(page.getByTestId('judging-cap-2')).toHaveAttribute('aria-checked', 'true');
    expect((await page.evaluate(() => window.sb.invoke('settings:get', undefined))).judgingCapUsd).toBe(2);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await shot(page, 'judging-switch-off');
    const before = Date.now();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(box).toContainText('ogni notte un Sentinel nascosto');
    const s = await page.evaluate(() => window.sb.invoke('settings:get', undefined));
    expect(s.judging).toBe(true);
    expect(s.judgingSince).toBeGreaterThanOrEqual(before - 60_000);
    await goPage(page, 'impostazioni');
    await expect(page.getByTestId('settings-page')).toBeVisible();
    await expect(page.getByTestId('st-delegation-judgeDaily')).toHaveCount(0);
  } finally { await app.close(); }
});
