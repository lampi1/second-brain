// Manual acceptance: run only where opening Electron is authorized.
import { expect, test } from '@playwright/test';
import { launchDemo, openAgents, shot } from './helpers';

// The Grindhouse (ADR 0068): only the agents' strips, beside the persistent Orchestrator column (strips in detail:
// grindhouse-strips.spec.ts).
for (const lang of ['it', 'en']) test(`Home is the default Grindhouse and keeps detail routes (${lang})`, async () => {
  const it = lang === 'it';
  const { app, page } = await launchDemo({ env: { SB_LANG: lang } });
  try {
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByTestId('home').getByRole('heading', { level: 1 })).toHaveCount(0); // no greeting
    await expect(page.getByTestId('dash-headline')).toHaveCount(0); // the headline heads Memoria (ADR 0122)
    await expect(page.getByTestId('view-agents')).toBeVisible();
    await expect(page.getByTestId('orchestrator-overlay')).toBeVisible();
    await expect(page.locator('[data-testid^="home-request-"]')).toHaveCount(0); // a decision waits as a pill on its strip
    await expect(page.getByTestId('chat-wait-qa')).toBeVisible();
    await shot(page, `home-${lang}`);
    await expect(page.getByTestId('nav-home')).toHaveAttribute('aria-label', 'Grindhouse');
    await expect(page.getByTestId('nav-workspace')).toHaveCount(0);
    // Agenti is in the Brain group (ADR 0077), Costi and Qualità in Andamento (ADR 0101, 0109); Confronto and Idee only
    // in a work profile that lists them
    for (const id of ['agenti', 'costi', 'qualita']) await expect(page.getByTestId(`nav-${id}`)).toBeVisible();
    for (const id of ['confronto', 'idee']) await expect(page.getByTestId(`nav-${id}`)).toHaveCount(0);
    await expect(page.getByRole('button', { name: it ? 'Nuovo agente' : 'New agent', exact: true })).toHaveCount(0);
    // work starts only from the Orchestrator's column (ADR 0083): Ctrl+N gives its input the keyboard, no dialog
    await page.keyboard.press('Control+N');
    await expect(page.getByTestId('newchat')).toHaveCount(0);
    await openAgents(page);
  } finally { await app.close(); }
});
