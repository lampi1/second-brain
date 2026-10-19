// End-to-end: the brain's Script and Changelog pages (ADR 0076) in the frozen demo, over the made-up scripts and
// changelog of main/brain/scripts-demo.ts read by the real readers. Both sit under Brain in the sidebar; the scripts are
// cards in a grid with their last test, searchable and filterable; a card opens in place with usage and code (the
// credential line of the demo is masked) and no button that runs anything; the changelog shows one card per day and
// filters by kind; a script entry opens its card on the Script page.
// Screenshots: test-results/shots/brain-scripts-*.png, brain-changelog-*.png.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchDemo, shot } from './helpers';

let app: ElectronApplication, page: Page;
test.beforeAll(async () => { ({ app, page } = await launchDemo()); });
test.afterAll(async () => { await app?.close(); });

test('Script: cards in a grid, search, filters, a card opens in place', async () => {
  const brain = page.getByTestId('nav-group-brain');
  await expect(brain).toBeVisible();
  await page.getByTestId('nav-script').click();
  const p = page.getByTestId('brain-scripts');
  await expect(p).toBeVisible();
  const cards = p.getByTestId('bs-script-card');
  await expect(cards).toHaveCount(4);
  await expect(p.getByTestId('bs-count')).toHaveText('4');
  await shot(page, 'brain-scripts-grid');

  await p.getByTestId('bs-filter-fix').click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('Conta gli errori');
  await p.getByTestId('bs-filter-all').click();
  await p.getByTestId('bs-search').fill('ticket csv');
  await expect(cards).toHaveCount(1);

  await cards.first().getByRole('button', { expanded: false }).click();
  const detail = p.getByTestId('bs-script-detail');
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('python scripts/export-ticket.py');
  await expect(p.getByTestId('bs-script-code')).toContainText('riga nascosta');
  await expect(detail.getByRole('button', { name: /esegui/i })).toHaveCount(0);
  await shot(page, 'brain-scripts-open');
});

test('Changelog: one card per day, filters by kind, a script entry opens its card', async () => {
  await page.getByTestId('nav-changelog').click();
  const p = page.getByTestId('brain-changelog');
  await expect(p).toBeVisible();
  await expect(p.getByTestId('bc-entry')).toHaveCount(8);
  await expect(p.locator('.bc-day').first()).toContainText('Oggi');
  await shot(page, 'brain-changelog');

  await p.getByTestId('bc-filter-script').click();
  await expect(p.getByTestId('bc-entry')).toHaveCount(5);
  await p.getByTestId('bc-entry').first().getByRole('button', { name: 'scripts/backup-note.mjs', exact: true }).click();
  await expect(page.getByTestId('brain-scripts')).toBeVisible();
  await expect(page.getByTestId('bs-script-detail')).toContainText('node scripts/backup-note.mjs');
});
