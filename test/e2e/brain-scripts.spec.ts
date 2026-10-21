// End-to-end: the brain's Script page (ADR 0076) and the Log page that holds its changelog (ADR 0111) in the frozen demo,
// over the made-up scripts and changelog of main/brain/scripts-demo.ts read by the real readers and the demo's Log events
// (main/activity/demo.ts). The scripts are cards in a grid with their last test, searchable and filterable; a card opens
// in place with usage and code (the credential line of the demo is masked) and no button that runs anything; the Log
// shows the tasks as chains, the changelog's lines in its stream, and a step's details in a side panel.
// Screenshots: test-results/shots/brain-scripts-*.png, log-*.png.
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

test('Log: the brain changelog is on the Log page; the tasks are chains, a step opens its details', async () => {
  await page.getByTestId('nav-log').click();
  const p = page.getByTestId('log-page');
  await expect(p).toBeVisible();
  await expect(page.getByTestId('nav-changelog')).toHaveCount(0);
  await expect(p.getByTestId('lg-task').first()).toBeVisible();
  await page.mouse.move(2, 2);
  await shot(page, 'log-page');

  await p.getByTestId('lg-filter-brain').click();
  await expect(p.getByTestId('lg-row')).toHaveCount(8);
  await p.getByTestId('lg-filter-all').click();
  await p.getByTestId('lg-task').first().getByTestId('lg-step-work').first().click();
  const detail = page.getByTestId('lg-detail');
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('Input');
  await shot(page, 'log-detail');
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
});
