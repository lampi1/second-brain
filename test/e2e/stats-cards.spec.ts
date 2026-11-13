// Statistics redesign (owner, 2026-10-19): Qualità's app errors (once the Dashboard's Errori tab) with recurring errors
// grouped into cards (cause, count, trend, where, what it means, what to do), and the costs under Andamento → Costi.
// The Classificatori grid this spec also covered left with ADR 0291. Frozen demo and the brain-ui fixture
// (ai-errors.md). Screenshots dark and light in test-results/shots/stats-*.png.
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

async function errors(page: Page, scheme: string): Promise<void> {
  // the app's and tools' errors are on Qualità now (the Dashboard is gone, ADR 0122); the AI's are its patterns
  await goPage(page, 'qualita');
  const dash = page.getByTestId('bx-q-app-errors');
  await dash.scrollIntoViewIfNeeded();
  await expect(dash.getByTestId('err-group')).toHaveCount(4);
  await shot(page, `stats-errors-${scheme}`);
  await dash.getByTestId('err-groups').scrollIntoViewIfNeeded();
  await shot(page, `stats-errors-groups-${scheme}`);
  // costs live only under Andamento → Costi (#125): no role, current or retired, on that page
  await goPage(page, 'costi');
  const costi = page.getByTestId('an-panel-costi');
  await expect(costi.getByTestId('bx-cost-kpis')).toBeVisible();
  await expect(costi.getByTestId('bx-agent-analytics')).toHaveCount(0);
  await expect(costi).not.toContainText(/Router|Judge|Scribe|Equivalente di listino|Tempi osservati/);
  await shot(page, `stats-costs-${scheme}`);
}

for (const scheme of ['dark', 'light'] as const) {
  test(`grouped errors and costs (${scheme})`, async () => {
    const { app, page } = await launchDemo({ scheme, env: { SB_BRAIN: fixtureBrain() } });
    try {
      await page.evaluate(th => window.sb.invoke('settings:set', { theme: th }), scheme);
      await expect(page.locator(`html[data-theme="${scheme}"]`)).toHaveCount(1);
      await errors(page, scheme);
    } finally { await app.close(); }
  });
}

test('a clean install shows a friendly empty errors section', async () => {
  const { app, page } = await launch();
  try {
    await setSize(app, 1600, 1000);
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await closeSetup(page);
    await goPage(page, 'qualita');
    await expect(page.getByTestId('bx-q-app-errors').getByText('Nessun errore dell’app o degli strumenti')).toBeVisible();
    await shot(page, 'stats-errors-empty');
  } finally { await app.close(); }
});
