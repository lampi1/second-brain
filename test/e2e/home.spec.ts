// Manual acceptance: run only where opening Electron is authorized.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

for (const lang of ['it', 'en']) test(`Home is the default and keeps detail routes (${lang})`, async () => {
  const { app, page } = await launchDemo({ env: { SB_LANG: lang } });
  try {
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.locator('#home-question')).toBeFocused();
    await expect(page.getByRole('heading', { name: lang === 'it' ? 'Ehi Brother, cosa facciamo oggi?' : 'Hey Brother, what shall we do today?', exact: true })).toBeVisible();
    await expect(page.locator('.home-card')).toHaveCount(4);
    await expect(page.locator('.home-map [role="region"]')).toBeVisible();
    await shot(page, `home-${lang}`);
    await expect(page.getByTestId('nav-workspace')).toHaveAttribute('aria-label', lang === 'it' ? 'Agenti' : 'Agents');
    for (const id of ['costi', 'qualita', 'confronto', 'idee', 'migliora', 'agenti']) {
      await expect(page.getByTestId(`nav-${id}`)).toHaveCount(0);
    }
    await page.getByTestId('home-card-ideas').getByRole('button').click();
    await expect(page.getByTestId('page-idee')).toBeVisible();
    await page.getByTestId('nav-home').click();
    await page.getByRole('button', { name: lang === 'it' ? 'Gestisci agenti' : 'Manage agents', exact: true }).click();
    await expect(page.getByTestId('agent-studio')).toBeVisible();
  } finally { await app.close(); }
});
