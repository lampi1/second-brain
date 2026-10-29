// «Modalità notte» (ADR 0191): the moon on the Orchestrator's head turns it on (the setting awayMode), a line under the
// head says the agents go on alone with «Sono qui» to turn it off, and Impostazioni → Ruoli e deleghe has the same
// switch. What it does to the chats is pinned by test/unit/chats/away.test.ts. Screenshots in
// test-results/shots/away-mode-*.png.
import { expect, test } from '@playwright/test';
import { goPage, launchDemo, shot } from './helpers';

test('the moon turns night mode on and off, and Settings shows the same switch', async () => {
  const { app, page } = await launchDemo();
  try {
    const moon = page.getByTestId('orchestrator-away');
    await expect(moon).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('away-line')).toHaveCount(0);
    await moon.click();
    await expect(moon).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('away-line')).toContainText('nessuna domanda');
    expect((await page.evaluate(() => window.sb.invoke('settings:get', undefined))).awayMode).toBe(true);
    await shot(page, 'away-mode-on');
    await goPage(page, 'impostazioni');
    await expect(page.getByTestId('st-away-on')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('st-away').scrollIntoViewIfNeeded();
    await shot(page, 'away-mode-settings');
    await page.getByTestId('away-off').click();
    await expect(page.getByTestId('away-line')).toHaveCount(0);
    await expect(page.getByTestId('st-away-on')).toHaveAttribute('aria-checked', 'false');
  } finally { await app.close(); }
});
