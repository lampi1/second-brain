// End-to-end: Impostazioni → «Instradamento modelli» (components/RoutingGroup.tsx, ADR 0032) on the demo's routing
// (brain/routing-demo.ts: the real hard rules on a table in memory). The table shows version and rows; a broken rule
// (an app row off Opus medium) is refused with main's message and nothing is saved; a valid edit, its "perché" left out
// (the AI writes it), becomes a new version through 'routing:save'; the Esplorazione field is refused over 50% and saved
// the same way; the Cronologia restores a version; the switch «L'AI può cambiarla» locks a row and the cost weight
// (0-10) is saved like the rest. Screenshots: test-results/shots/settings-routing.png, settings-routing-explore.png,
// settings-routing-history.png, settings-routing-ai.png.
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

  // a new row for the app's chats on another model: refused by main (app chats only on Opus medium), the version stays
  await g.getByTestId('st-routing-add').click();
  await expect(rows).toHaveCount(5);
  await g.getByLabel('Riga 5: tipo di lavoro').selectOption('review');
  await g.getByLabel('Riga 5: modello').selectOption('claude-sonnet-5-5');
  await g.getByLabel('Riga 5: area').fill('App');
  await g.getByTestId('st-routing-save').click();
  await expect(g.getByTestId('st-routing-error')).toContainText('riga 5: le chat sull’app vanno sempre su claude-opus-5-5 medium');
  await expect(g.getByTestId('st-routing-version')).toContainText('Versione 3');

  // any area and no "perché" (the user may leave it out: the AI writes it): saved as version 4, the editor reloads from main
  await g.getByLabel('Riga 5: area').fill('');
  await g.getByTestId('st-routing-reason').fill('prova e2e');
  await g.getByTestId('st-routing-save').click();
  await expect(g.getByTestId('st-routing-version')).toContainText('Versione 4');
  await expect(g.getByTestId('st-routing-error')).toHaveCount(0);
  const saved = await page.evaluate(async () => (await window.sb.invoke('routing:get', undefined)).table);
  expect(saved?.routes.at(-1)).toMatchObject({ kind: 'review', harness: 'claude', model: 'claude-sonnet-5-5', why: '' });

  // Esplorazione: over 50% refused by main, 10% saved as a new version like the rows
  const x = g.getByTestId('st-routing-explore-input');
  await expect(x).toHaveValue('0');
  await x.fill('60');
  await g.getByTestId('st-routing-save').click();
  await expect(g.getByTestId('st-routing-error')).toContainText('esplorazione: da 0 a 50%');
  await expect(g.getByTestId('st-routing-version')).toContainText('Versione 4');
  await x.fill('10');
  await g.getByTestId('st-routing-save').click();
  await expect(g.getByTestId('st-routing-version')).toContainText('Versione 5');
  await expect(x).toHaveValue('10');
  expect((await page.evaluate(async () => (await window.sb.invoke('routing:get', undefined)).table))?.exploration).toBe(0.1);
  // a cleared field keeps the rate in force (never a silent 0)
  await x.fill('');
  await g.getByTestId('st-routing-save').click();
  await expect(g.getByTestId('st-routing-version')).toContainText('Versione 6');
  await expect(x).toHaveValue('10');

  // Cronologia: every change with who and why (the demo's agent change too); Ripristina brings version 3 back as a new one
  const hist = g.getByTestId('st-routing-history');
  await expect(hist.getByTestId('st-routing-change-2')).toContainText('agente: Regia dell’app');
  await expect(hist.getByTestId('st-routing-change-2')).toContainText('dati: 31 chat');
  await expect(hist.getByTestId('st-routing-change-6')).toContainText('in vigore');
  await hist.getByTestId('st-routing-restore-3').click();
  await expect(g.getByTestId('st-routing-version')).toContainText('Versione 7');
  await expect(rows).toHaveCount(4);
  await expect(x).toHaveValue('0');
  await expect(hist.getByTestId('st-routing-change-7')).toContainText('ripristino della versione 3');
  await hist.evaluate(el => el.scrollIntoView({ block: 'center' }));
  await page.mouse.move(2, 2);
  await shot(page, 'settings-routing-history');
  await g.getByTestId('st-routing-explore').evaluate(el => el.scrollIntoView({ block: 'center' }));
  await shot(page, 'settings-routing-explore');

  // the user's switches: «L'AI può cambiarla» per row (the demo's bug-fix row is locked) and the cost weight (0-10)
  await expect(g.getByTestId('st-routing-ai-3')).not.toBeChecked();
  await expect(g.getByTestId('st-routing-ai-1')).toBeChecked();
  await g.getByTestId('st-routing-ai-1').uncheck();
  const w = g.getByTestId('st-routing-weight-input');
  await expect(w).toHaveValue('7');
  await w.fill('11');
  await g.getByTestId('st-routing-save').click();
  await expect(g.getByTestId('st-routing-error')).toContainText('peso del costo: da 0 a 10');
  await w.fill('4');
  await g.getByTestId('st-routing-save').click();
  await expect(g.getByTestId('st-routing-version')).toContainText('Versione 8');
  await expect(g.getByTestId('st-routing-ai-1')).not.toBeChecked();
  const locked = await page.evaluate(async () => (await window.sb.invoke('routing:get', undefined)).table);
  expect(locked).toMatchObject({ costWeight: 4, routes: [{}, { kind: 'triage', locked: true }, {}, { kind: 'bug-fix', locked: true }] });
  await expect(hist.getByTestId('st-routing-change-8')).toContainText('peso del costo 7 → 4');
  await g.getByTestId('st-routing-table').evaluate(el => el.scrollIntoView({ block: 'center' }));
  await shot(page, 'settings-routing-ai');
  await app.close();
});
