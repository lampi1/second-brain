// A role's own page edits its presets (AgentStudio.tsx → RolePresets.tsx RolePresetRows, ADR 0336, owner 2026-11-23):
// the Scout's Configurazione card shows Minimo / Base / Massimo with a model and an effort each, Base on the card's own
// model; the Orchestrator's page only Base. Picture: test-results/shots/agent-card-presets.png.
import { expect, test, type Page } from '@playwright/test';
import { launchDemo, shot } from './helpers';

async function visit(page: Page, link: string) {
  await page.keyboard.press('Control+K');
  await page.getByTestId('palette-input').fill(link);
  await page.keyboard.press('Enter');
}

test('a role\'s page shows and edits Minimo, Base and Massimo; the Orchestrator only Base', async () => {
  const { app, page } = await launchDemo();
  try {
    await visit(page, 'sb://agenti/scout');
    const presets = page.getByTestId('agent-presets');
    await expect(presets).toBeVisible();
    for (const id of ['min', 'base', 'max']) {
      await expect(presets.getByTestId(`st-preset-model-scout-${id}`)).toBeVisible();
      await expect(presets.getByTestId(`st-preset-effort-scout-${id}`)).toBeVisible();
    }
    await presets.scrollIntoViewIfNeeded();
    await page.locator('.ad-side > section.ad-card').first().scrollIntoViewIfNeeded();
    if (process.env.SHOT_PATH) await page.screenshot({ path: process.env.SHOT_PATH, animations: 'disabled', caret: 'hide' });
    await shot(page, 'agent-card-presets');
    await visit(page, 'sb://agenti/orchestrator');
    await expect(page.getByTestId('agent-presets').getByTestId('st-preset-orchestrator-base')).toBeVisible();
    await expect(page.getByTestId('agent-presets').getByTestId('st-preset-orchestrator-min')).toHaveCount(0);
  } finally { await app.close(); }
});
