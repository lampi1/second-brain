// A role's own page (AgentStudio.tsx → RoleLevels.tsx, ADR 0347): the Scout's «Modelli per livello» shows Minimo, Base
// and Massimo as ordered model chips with what the app would start on now; the back of its card shows its engines, not
// a model; the Orchestrator's page only Base. Picture: test-results/shots/role-levels.png.
import { expect, test, type Page } from '@playwright/test';
import { launchDemo, openAgentOverview, shot } from './helpers';

async function visit(page: Page, link: string) {
  await page.keyboard.press('Control+K');
  await page.getByTestId('palette-input').fill(link);
  await page.keyboard.press('Enter');
}

test('a role\'s page shows its models per level; the card back its engines; the Orchestrator only Base', async () => {
  const { app, page } = await launchDemo();
  try {
    await openAgentOverview(page);
    await page.getByTestId('catalog-flip-scout').click();
    await expect(page.getByTestId('catalog-engine-scout')).toBeVisible();
    await expect(page.getByTestId('catalog-model-scout')).toHaveCount(0);
    await visit(page, 'sb://agenti/scout');
    const levels = page.getByTestId('role-levels');
    await expect(levels).toBeVisible();
    for (const id of ['min', 'base', 'max']) {
      await expect(levels.getByTestId(`role-level-${id}-0`)).toBeVisible();
      await expect(levels.getByTestId(`role-level-${id}-now`)).toBeVisible();
    }
    await expect(page.getByTestId('role-permissions')).toHaveCount(0);
    if (process.env.SHOT_PATH) await page.screenshot({ path: process.env.SHOT_PATH, animations: 'disabled', caret: 'hide' });
    await shot(page, 'role-levels');
    await visit(page, 'sb://agenti/orchestrator');
    await expect(page.getByTestId('role-levels').getByTestId('st-preset-orchestrator-base')).toBeVisible();
    await expect(page.getByTestId('role-levels').getByTestId('st-preset-orchestrator-min')).toHaveCount(0);
  } finally { await app.close(); }
});
