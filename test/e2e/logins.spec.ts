// E2E of the "Credenziali" panel in the frozen demo (fictional entries, demo-browser.ts): opened from the command
// palette and from the top bar, grouped as in the credentials file, filterable, a masked password with Copia, Apri on
// entries with a URL. Screenshots test-results/shots/credentials-{dark,light}.png. The real file, Copia and the agents'
// paste block are covered with a fixture brain in browser-handoff.spec.ts.
import { expect, test } from '@playwright/test';
import { launchDemo, moreAction, shot } from './helpers';

for (const scheme of ['dark', 'light'] as const) {
  test(`the Credenziali panel lists the environments with Copia password (${scheme})`, async () => {
    const { app, page } = await launchDemo({ scheme });
    try {
      if (scheme === 'light') await page.evaluate(() => window.sb.invoke('settings:set', { theme: 'light' }));
      // from the palette
      await page.keyboard.press('Control+K');
      await page.getByTestId('palette-input').fill('credenziali');
      await page.getByTestId('palette-item-credentials').click();
      const panel = page.getByTestId('credentials');
      await expect(panel).toBeVisible();
      await expect(panel.locator('.cred-group-title')).toHaveText(['air · test', 'air · local', 'sistemaTsTest']);
      await expect(panel.getByTestId(/^cred-user-/)).toHaveCount(4);
      await expect(panel.getByTestId(/^cred-open-/)).toHaveCount(2);
      await expect(panel.getByTestId('cred-copy-password-demo-1')).toBeVisible();
      await shot(page, `credentials-${scheme}`);
      await panel.getByTestId('cred-copy-password-demo-1').click();
      await expect(panel.getByTestId('cred-copy-password-demo-1')).toContainText('Copiata');
      await panel.getByTestId('credentials-filter').fill('sistema');
      await expect(panel.getByTestId(/^cred-user-/)).toHaveText(['MEDICO-DEMO-01']);
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
      // from the top bar's "…"
      await moreAction(page, 'more-credentials');
      await expect(panel).toBeVisible();
    } finally {
      await app.close();
    }
  });
}
