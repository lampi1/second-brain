// Mappa → Progetti (issue #385, ADR 0271): the demo brain's project map draws its top level (people, the shop, the
// outside systems, the environments) with the parts waiting for the user marked, the agents column lists the demo chats
// bound to it, a click on the shop zooms into its parts with the outside systems it talks to around them, a card lights
// its parts, and the history slider shows the first drawing. Frozen demo; screenshots in test-results/shots/project-map-*.png.
import { expect, test } from '@playwright/test';
import { goPage, launchDemo, shot } from './helpers';

test('the project map draws the project, zooms into a system and plays its history', async () => {
  const { app, page } = await launchDemo();
  try {
    await goPage(page, 'collegamenti');
    await page.getByTestId('bm-map-page').getByRole('button', { name: 'Progetti', exact: true }).click();
    const view = page.getByTestId('pm-view');
    for (const id of ['cliente', 'operatore', 'negozio', 'pagamenti', 'gestionale', 'test', 'pipeline']) await expect(view.getByTestId(`pm-node-${id}`)).toBeVisible();
    await expect(view.getByTestId('pm-node-carrello')).toHaveCount(0);
    await expect(view.getByTestId('pm-waiting')).toHaveText('2 aspettano te');
    await expect(view.getByTestId('pm-agent')).toHaveCount(3);
    await expect(view.getByTestId('pm-agent').first()).toContainText('QA · Rimborsi');
    await shot(page, 'project-map-top');

    // into the shop: its parts, and around them the outside systems they talk to
    await view.getByTestId('pm-node-negozio').click();
    for (const id of ['carrello', 'ordini', 'rimborsi', 'notifiche', 'db', 'pagamenti', 'provider-sms']) await expect(view.getByTestId(`pm-node-${id}`)).toBeVisible();
    await expect(view.getByTestId('pm-node-rimborsi')).toHaveClass(/s-blocked/);
    await expect(view.getByTestId('pm-node-notifiche')).toHaveClass(/s-stale/); // in progress, nobody confirmed it for 3 h
    await shot(page, 'project-map-zoom');
    await view.getByTestId('pm-agent').filter({ hasText: 'Fix totale ordine' }).click();
    await expect(view.getByTestId('pm-node-ordini')).toHaveClass(/lit/);

    // the history: the first drawing, then back to now
    await view.getByTestId('pm-history').locator('input[type=range]').fill('0');
    await expect(view.getByTestId('pm-past')).toContainText('Versione 1');
    await expect(view.getByTestId('pm-node-notifiche')).toHaveCount(0);
    await view.getByRole('button', { name: 'Torna a ora' }).click();
    await expect(view.getByTestId('pm-node-notifiche')).toBeVisible();

    // breadcrumbs back to the whole project
    await view.getByRole('button', { name: 'Tutto il progetto' }).click();
    await expect(view.getByTestId('pm-node-carrello')).toHaveCount(0);
  } finally { await app.close(); }
});
