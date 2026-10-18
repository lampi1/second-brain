// Manual acceptance: run only where opening Electron is authorized.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

// The Grindhouse (ADR 0068): the requests waiting, then the agents' strips, beside the persistent Orchestrator column.
for (const lang of ['it', 'en']) test(`Home is the default Grindhouse and keeps detail routes (${lang})`, async () => {
  const it = lang === 'it';
  const { app, page } = await launchDemo({ env: { SB_LANG: lang } });
  try {
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByRole('heading', { name: it ? 'Ehi Brother, cosa facciamo oggi?' : 'Hey Brother, what shall we do today?', exact: true })).toBeVisible();
    // the headline (SPEC 18): the demo never calls a model, so a line of the app's own list
    const headline = page.getByTestId('home-headline');
    await expect(headline).toHaveAttribute('data-source', 'builtin');
    await expect(headline).not.toBeEmpty();
    await expect(page.getByRole('heading', { name: it ? 'Agenti' : 'Agents', exact: true })).toBeVisible();
    await expect(page.getByTestId('view-agents')).toBeVisible();
    await expect(page.getByTestId('regia-overlay')).toBeVisible();
    await expect(page.locator('[data-testid^="home-request-"]').first()).toBeVisible(); // the demo's open requests
    await shot(page, `home-${lang}`);
    await expect(page.getByTestId('nav-home')).toHaveAttribute('aria-label', 'Grindhouse');
    await expect(page.getByTestId('nav-workspace')).toHaveCount(0);
    for (const id of ['costi', 'qualita', 'confronto', 'idee', 'migliora', 'agenti']) {
      await expect(page.getByTestId(`nav-${id}`)).toHaveCount(0);
    }
    await page.getByRole('button', { name: it ? 'Nuovo agente' : 'New agent', exact: true }).click();
    await expect(page.getByTestId('newchat')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('newchat')).toHaveCount(0);
    await page.getByRole('button', { name: it ? 'Gestisci agenti' : 'Manage agents', exact: true }).click();
    await expect(page.getByTestId('agent-studio')).toBeVisible();
  } finally { await app.close(); }
});
