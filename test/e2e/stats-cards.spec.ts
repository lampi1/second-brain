// Statistics redesign (owner, 2026-10-19): Brain → Classificatori as a grid of classifier cards (numbers with a "?",
// an 8-week trend, the learning meter toward 20 verified cases, a curious fact) with a detail per classifier (history,
// slices, the routing table under "Scelta del modello"), and the Dashboard's Errori tab with recurring errors grouped
// into cards (cause, count, trend, where, what it means, what to do). Frozen demo with its made-up classifier history
// (main/demo-classifiers.ts) and the brain-ui fixture (ai-errors.md). Screenshots dark and light in
// test-results/shots/stats-*.png.
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeSetup, goPage, launch, launchDemo, setSize, shot } from './helpers';

function fixtureBrain(): string {
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-stats-'));
  const tools = path.join(brain, 'ops', 'tools');
  fs.mkdirSync(tools, { recursive: true });
  const fixture = path.resolve(import.meta.dirname, '..', 'fixtures', 'brain-ui');
  fs.copyFileSync(path.join(fixture, 'brain-site.mjs'), path.join(tools, 'brain-site.mjs'));
  fs.copyFileSync(path.join(fixture, 'data.mjs'), path.join(tools, 'brain-ui-data.mjs'));
  return brain;
}

async function classifiers(page: Page, scheme: string): Promise<void> {
  await goPage(page, 'classificatori');
  const cls = page.getByTestId('bm-classifiers-page');
  await expect(cls.getByTestId('cls-grid')).toBeVisible();
  for (const id of ['kind', 'model', 'skills', 'tasks', 'jobkind', 'mail', 'cmd']) await expect(cls.getByTestId(`cls-card-${id}`)).toBeVisible();
  await expect(cls.getByTestId('cls-card-estimates')).toHaveCount(0); // the brain's retired estimator (ADR 0053, 0101)
  await expect(cls.getByTestId('cls-summary')).not.toContainText('Token spesi');
  await expect(cls.getByTestId('cls-kind-decisions')).not.toContainText('nessun dato');
  await expect(cls.getByTestId('cls-kind-hit')).toContainText(/\d+\/\d+/); // k/n beside the share
  await expect(cls.locator('input, textarea, select')).toHaveCount(0);
  await shot(page, `stats-classifiers-${scheme}`);
  await cls.getByTestId('cls-card-jobkind').scrollIntoViewIfNeeded();
  await shot(page, `stats-classifiers-more-${scheme}`);
  await cls.getByTestId('cls-summary').scrollIntoViewIfNeeded();
  // every number explains itself
  const help = cls.getByTestId('cls-kind-hit').locator('.help-tip');
  await help.click();
  await expect(page.locator('.help-bubble:not([hidden])')).toContainText('altro');
  await shot(page, `stats-classifiers-help-${scheme}`);
  await page.keyboard.press('Escape');
  // the detail of "Tipo di lavoro", then "Scelta del modello" with the routing table of before
  await cls.getByTestId('cls-card-kind').getByRole('button', { name: /Tipo di lavoro/ }).click();
  await expect(cls.getByTestId('cls-detail-kind')).toBeVisible();
  await expect(cls.getByTestId('cls-learning').locator('svg')).toBeVisible();
  await expect(cls.getByTestId('bm-cls-kinds')).toBeVisible();
  await shot(page, `stats-classifier-detail-${scheme}`);
  await cls.getByTestId('cls-slices').scrollIntoViewIfNeeded();
  await shot(page, `stats-classifier-detail-charts-${scheme}`);
  await cls.getByTestId('cls-back').click();
  // the task estimator's weekly backtest (ADR 0087): its card and its learning curve
  await expect(cls.getByTestId('cls-tasks-decisions')).not.toContainText('nessun dato');
  await cls.getByTestId('cls-card-tasks').getByRole('button', { name: /Stima dai lavori simili/ }).click();
  await expect(cls.getByTestId('cls-learning').locator('svg')).toBeVisible();
  await shot(page, `stats-classifier-tasks-${scheme}`);
  await cls.getByTestId('cls-back').click();
  await cls.getByTestId('cls-card-model').getByRole('button', { name: /Scelta del modello/ }).click();
  await expect(cls.getByTestId('bm-cls-routing')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(cls.getByTestId('cls-grid')).toBeVisible();
}

async function errors(page: Page, scheme: string): Promise<void> {
  await page.getByTestId('nav-dashboard').click();
  await page.getByRole('tab', { name: 'Errori' }).click();
  const dash = page.getByTestId('dashboard');
  await expect(dash.getByTestId('err-ai-groups')).toBeVisible();
  await expect(dash.getByTestId('err-ai-group').first()).toBeVisible();
  await expect(dash.getByTestId('err-group')).toHaveCount(4);
  await shot(page, `stats-errors-${scheme}`);
  await dash.getByTestId('err-groups').scrollIntoViewIfNeeded();
  await shot(page, `stats-errors-groups-${scheme}`);
  await dash.getByTestId('err-ai-groups').scrollIntoViewIfNeeded();
  await shot(page, `stats-errors-ai-${scheme}`);
  // costs live only under Andamento → Costi (#125): no Costi tab here, and no role, current or retired, on that page
  await expect(page.getByRole('tab', { name: 'Costi' })).toHaveCount(0);
  await goPage(page, 'costi');
  const costi = page.getByTestId('brain-page-costi');
  await expect(costi.getByTestId('bx-cost-kpis')).toBeVisible();
  await expect(costi.getByTestId('bx-agent-analytics')).toHaveCount(0);
  await expect(costi).not.toContainText(/Router|Judge|Scribe|Equivalente di listino|Tempi osservati/);
  await shot(page, `stats-costs-${scheme}`);
}

for (const scheme of ['dark', 'light'] as const) {
  test(`classifier cards and grouped errors (${scheme})`, async () => {
    const { app, page } = await launchDemo({ scheme, env: { SB_BRAIN: fixtureBrain() } });
    try {
      await page.evaluate(th => window.sb.invoke('settings:set', { theme: th }), scheme);
      await expect(page.locator(`html[data-theme="${scheme}"]`)).toHaveCount(1);
      await classifiers(page, scheme);
      await errors(page, scheme);
    } finally { await app.close(); }
  });
}

test('a clean install shows friendly empty classifier cards and errors', async () => {
  const { app, page } = await launch();
  try {
    await setSize(app, 1600, 1000);
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await closeSetup(page);
    await goPage(page, 'classificatori');
    const cls = page.getByTestId('bm-classifiers-page');
    await expect(cls.getByTestId('cls-clean')).toBeVisible();
    await expect(cls.getByTestId('cls-card-kind')).toContainText('Nessuna chat registrata ancora');
    await expect(cls.getByTestId('cls-card-kind').getByTestId('cls-fact-kind')).toHaveCount(0);
    await expect(cls.getByTestId('cls-card-tasks')).toContainText('Nessun lavoro stimato ancora');
    await shot(page, 'stats-classifiers-empty');
    await page.getByTestId('nav-dashboard').click();
    await page.getByRole('tab', { name: 'Errori' }).click();
    await expect(page.getByTestId('dashboard').getByText('Nessun errore dell’app o degli strumenti')).toBeVisible();
    await shot(page, 'stats-errors-empty');
  } finally { await app.close(); }
});
