// End-to-end: the brain's saved queries (ADR 0124) in Memoria → «Script & Query» (G T lands there), over the made-up
// queries of main/brain/queries-demo.ts read by the real BrainQueries: one card per query with its language chip, title,
// what it answers and where it runs; search and the language chips filter; a card opens in place with the query; «Copia»
// copies it; «Elimina» removes it through the brain model's ChangeLog and «Annulla» in the toast puts it back.
// Screenshots dark and light: test-results/shots/queries-*.png.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { goPage, launchDemo, shot } from './helpers';

let app: ElectronApplication, page: Page;
test.beforeAll(async () => { ({ app, page } = await launchDemo({ height: 1100 })); });
test.afterAll(async () => { await app?.close(); });

async function theme(scheme: 'dark' | 'light') {
  await page.evaluate(t => window.sb.invoke('settings:set', { theme: t }), scheme);
  await page.emulateMedia({ colorScheme: scheme });
  await page.waitForTimeout(250);
}

async function openQueries() {
  await goPage(page, 'script');
  const tab = page.getByRole('tab', { name: /Script/ });
  if (await tab.count()) await tab.first().click();
  const q = page.getByTestId('queries-tab');
  await expect(q).toBeVisible();
  await q.scrollIntoViewIfNeeded();
  return q;
}

test('Query: cards with language, data source and actions; search and language filter; a card opens with the query', async () => {
  await theme('dark');
  const q = await openQueries();
  const cards = q.getByTestId('qy-card');
  await expect(cards).toHaveCount(5);
  await expect(q.getByTestId('qy-count')).toHaveText('5');
  await expect(cards.filter({ hasText: 'Clienti attivi negli ultimi 30 giorni' }).getByTestId('qy-lang')).toHaveText('KQL');
  await expect(cards.filter({ hasText: 'Ordini in ritardo' }).getByTestId('qy-source')).toContainText('PostgreSQL');
  await page.mouse.move(2, 2);
  await q.screenshot({ path: 'test-results/shots/queries-dark.png', animations: 'disabled' });

  await q.getByTestId('qy-filter-kql').click();
  await expect(cards).toHaveCount(1);
  await q.getByTestId('qy-filter-all').click();
  await q.getByTestId('qy-search').fill('splunk login');
  await expect(cards).toHaveCount(1);
  await q.getByTestId('qy-search').fill('');
  await expect(cards).toHaveCount(5);

  const kql = cards.filter({ hasText: 'Clienti attivi' });
  await kql.getByRole('button', { expanded: false }).click();
  await expect(q.getByTestId('qy-code')).toContainText('| summarize sessioni = count()');
  await expect(q.getByTestId('qy-detail')).not.toContainText('Esegui');
  await kql.getByTestId('qy-copy').click();
  await expect(page.getByText('Query copiata')).toBeVisible();
  await kql.hover();
  await q.screenshot({ path: 'test-results/shots/queries-open-dark.png', animations: 'disabled' });
  await kql.getByRole('button', { expanded: true }).click();
});

test('Query: delete with undo, then the light theme', async () => {
  const q = await openQueries();
  const cards = q.getByTestId('qy-card');
  await expect(cards).toHaveCount(5);
  await cards.filter({ hasText: 'Login falliti' }).getByTestId('qy-delete').click();
  await expect(cards).toHaveCount(4);
  const toastUndo = page.getByRole('button', { name: 'Annulla' }).last();
  await expect(toastUndo).toBeVisible();
  await shot(page, 'queries-deleted');
  await toastUndo.click();
  await expect(cards).toHaveCount(5);
  await expect(page.getByText('Query ripristinata')).toBeVisible();

  await theme('light');
  await page.mouse.move(2, 2);
  await q.screenshot({ path: 'test-results/shots/queries-light.png', animations: 'disabled' });
  await theme('dark');
});
