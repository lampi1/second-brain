// End-to-end: the «Guida» page (components/GuidePage.tsx, content in src/shared/concept-guide.ts) in the frozen demo.
// It opens from the left rail and from Ctrl+K, shows the prominent card «Ogni compito passa da un agente» first as a
// hero and the other cards in a multi-column grid (not full-width strips), a card opens a reading panel with its
// numbered points, analogy, technical details and sources that Esc closes (focus back on the card), and «Discutine»
// (no explainer agent in the demo catalog) docks the Orchestrator with a draft that carries the card and the Explainer
// instruction, NOT sent.
// Screenshots: test-results/shots/concept-guide-*.png.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchDemo, shot } from './helpers';

let app: ElectronApplication, page: Page;
test.beforeAll(async () => { ({ app, page } = await launchDemo({ orchestrator: true })); });
test.afterAll(async () => { await app?.close(); });

test('Guida opens from the left rail and from Ctrl+K, with the prominent card first', async () => {
  await page.getByTestId('nav-guida').click();
  await expect(page.getByTestId('guide-page')).toBeVisible();
  const first = page.getByTestId('guide-page').locator('article').first();
  await expect(first).toHaveAttribute('data-testid', 'guide-card-every-task-agent');
  await expect(first).toContainText('Ogni compito passa da un agente');
  await expect(first.getByTestId('guide-diagram')).toBeVisible(); // the prominent card shows its diagram collapsed
  await expect(page.getByTestId('guide-body-runs')).toHaveCount(0);
  const card = await page.getByTestId('guide-card-runs').boundingBox();
  const hero = await first.boundingBox();
  expect(card!.width).toBeLessThan(hero!.width / 2 + 1); // a grid of cards, not full-width strips
  await shot(page, 'concept-guide-collapsed');

  await page.getByTestId('nav-home').click();
  await page.keyboard.press('Control+k');
  await page.keyboard.type('guida');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('guide-page')).toBeVisible();
});

test('a card opens a panel with points, analogy, technical details and sources; Esc closes it; the filter narrows the cards', async () => {
  const toggle = page.getByTestId('guide-toggle-runs');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const body = page.getByTestId('guide-body-runs');
  await expect(body.locator('ol.guide-points > li')).toHaveCount(8);
  await expect(body).toContainText('In pratica è come');
  await expect(body).toContainText('Dettagli tecnici');
  await expect(body).toContainText('src/main/agents/runs.ts');
  await expect(body.getByTestId('guide-target')).toBeVisible();
  await expect(page.getByTestId('guide-panel')).toContainText('Le run degli agenti');
  await shot(page, 'concept-guide-expanded');

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('guide-panel')).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
  await expect(page.getByTestId('guide-page')).toBeVisible(); // Esc closed the panel, not the page

  await page.getByTestId('guide-filter').fill('instradamento');
  await expect(page.getByTestId('guide-card-routing')).toBeVisible();
  await expect(page.getByTestId('guide-card-dashboard')).toHaveCount(0);
  await page.getByTestId('guide-filter').fill('');
});

test('«Discutine» docks the Orchestrator with the card as an unsent draft and the Explainer instruction', async () => {
  await page.getByTestId('guide-discuss-runs').click();
  const input = page.getByTestId('orchestrator-input');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(/agent_catalog/);
  await expect(input).toHaveValue(/"Explainer"/);
  await expect(input).toHaveValue(/# Le run degli agenti/);
  await expect(input).toHaveValue(/src\/main\/agents\/runs\.ts/);
  await expect(page.getByTestId('guide-page')).toBeVisible(); // the page stays
  await shot(page, 'concept-guide-discuss');
  await input.fill(''); // never sent
});
