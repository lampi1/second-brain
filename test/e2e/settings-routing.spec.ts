// End-to-end: Impostazioni → «Instradamento modelli» (components/RoutingGroup.tsx, ADR 0032) on the demo's routing
// (brain/routing-demo.ts: the real hard rules on a table in memory). The table shows version and rows; a broken rule
// (a row without its "perché") is refused with main's message and nothing is saved; a valid edit becomes a new
// version through 'routing:save'. Screenshot: test-results/shots/settings-routing.png.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

test('Instradamento modelli: the table, a refused save, a new version', async () => {
  const { app, page } = await launchDemo({ freeze: true });
  await page.getByTestId('settings').click();
  await page.getByTestId('settings-all').click();
  const g = page.getByTestId('st-group-routing');
  await g.scrollIntoViewIfNeeded();
  await expect(g.getByTestId('st-routing-version')).toContainText('Versione 3');
  const rows = g.locator('[data-testid^="st-routing-row-"]');
  await expect(rows).toHaveCount(4);
  await expect(g.getByLabel('Riga 2: tipo di lavoro')).toHaveValue('triage');
  await expect(g.getByLabel('Riga 2: modello')).toHaveValue('claude-sonnet-5-5');
  await expect(g.getByLabel('Riga 1: area')).toHaveValue('App, Pers · App');
  // max is never offered: only an agent's override with a reason
  await expect(g.getByLabel('Riga 1: sforzo').locator('option[value="max"]')).toHaveCount(0);
  await expect(g.getByTestId('st-routing-save')).toBeDisabled();
  await g.evaluate(el => el.scrollIntoView({ block: 'start' }));
  await shot(page, 'settings-routing');

  // a new row without its "perché": refused by main, the version stays
  await g.getByTestId('st-routing-add').click();
  await expect(rows).toHaveCount(5);
  await g.getByLabel('Riga 5: tipo di lavoro').selectOption('review');
  await g.getByLabel('Riga 5: modello').selectOption('claude-sonnet-5-5');
  await g.getByTestId('st-routing-save').click();
  await expect(g.getByTestId('st-routing-error')).toContainText('riga 5: manca il perché');
  await expect(g.getByTestId('st-routing-version')).toContainText('Versione 3');

  // with the reason: saved as version 4, the editor reloads from main
  await g.getByLabel('Riga 5: perché').fill('review brevi: basta Sonnet');
  await g.getByTestId('st-routing-reason').fill('prova e2e');
  await g.getByTestId('st-routing-save').click();
  await expect(g.getByTestId('st-routing-version')).toContainText('Versione 4');
  await expect(g.getByTestId('st-routing-error')).toHaveCount(0);
  const saved = await page.evaluate(async () => (await window.sb.invoke('routing:get', undefined)).table);
  expect(saved?.routes.at(-1)).toMatchObject({ kind: 'review', harness: 'claude', model: 'claude-sonnet-5-5', why: 'review brevi: basta Sonnet' });
  await app.close();
});
