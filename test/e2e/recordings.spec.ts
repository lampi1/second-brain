// E2E of call recordings (ADR 0154) on the frozen demo, whose voice engine is the fake one: «Registra call» records two
// tones in place of the microphone and the PC (no devices in CI), the REC pill shows on every page with the timer, ■
// stops it, the fake Whisper "hears" a short call and the transcript shows «Tu» and «Altri» lines. Screenshots dark.
import { expect, test } from '@playwright/test';
import { goPage, launchDemo, shot } from './helpers';

test('record a call, see it transcribed with Tu and Altri, stop from the pill', async () => {
  test.setTimeout(90_000);
  const { app, page } = await launchDemo();
  try {
    await goPage(page, 'registrazioni');
    const toggle = page.getByTestId('rec-toggle');
    await expect(toggle).toBeVisible();
    await expect(page.getByTestId('rec-found')).toBeVisible();
    await toggle.click();
    await expect(page.getByTestId('rec-live')).toBeVisible();
    const pill = page.getByTestId('rec-pill');
    await expect(pill).toBeVisible();
    await expect(page.getByTestId('rec-live-time')).toHaveText(/0:0[2-9]/, { timeout: 10_000 });
    await shot(page, 'recordings-live-dark');

    // the pill stays on another page and stops the call
    await goPage(page, 'guida');
    await expect(pill).toBeVisible();
    await page.getByTestId('rec-pill-stop').click();
    await expect(pill).toHaveCount(0);

    await goPage(page, 'registrazioni');
    const lines = page.getByTestId('rec-lines');
    await expect(lines).toContainText('pagina di login', { timeout: 15_000 });
    await expect(lines.locator('.rec-line.me .rec-who').first()).toHaveText('Tu');
    await expect(lines.locator('.rec-line.others .rec-who').first()).toHaveText('Altri');
    await page.getByTestId('rec-search').fill('Edge');
    await expect(lines.locator('.rec-line')).toHaveCount(1);
    await page.getByTestId('rec-search').fill('');
    await shot(page, 'recordings-transcript-dark');
  } finally {
    await app.close();
  }
});
