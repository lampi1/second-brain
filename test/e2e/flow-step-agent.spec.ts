// Flussi shows, for each agent step, the role's avatar, the role and the model resolved from the routing table, in the
// definition and on a running run's active step. A renderer fixture: no workflow starts, no agent is invoked.
// Authored only: this suite runs on main after the merge (ADR 0027).
import { test, expect } from '@playwright/test';
import { stepAgentSnapshot } from './flow-step-agent.fixture';
import { launchDemo, shot } from './helpers';


test('Flussi shows each agent step\'s role avatar and resolved model', async () => {
  const { app, page } = await launchDemo({ orchestrator: true, width: 1400, height: 900 });
  try {
    await page.getByTestId('nav-flussi').click();
    await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0]!.webContents.send('flows:changed', value), stepAgentSnapshot());
    await expect(page.getByTestId('flow-definition')).toContainText('Correzione di prova');
    await page.locator('.flow-full-definition > summary').click();
    await expect(page.locator('.flow-full-definition').getByTestId('flow-step-agent').first()).toContainText('Scout · mid · demo-mid-model');
    await expect(page.locator('.flow-full-definition').getByTestId('flow-step-agent').nth(1)).toContainText('Artisan · scelto dal ruolo');
    await expect(page.locator('.flow-full-definition').getByTestId('flow-step-agent').nth(2)).toContainText('scelto dal ruolo');
    // the running step's node carries its role's avatar too
    await expect(page.locator('.flow-node[data-status=running]').getByTestId('flow-node-agent').locator('[data-character=scout]')).toBeVisible();
    await shot(page, 'flow-step-agent');
  } finally { await app.close(); }
});

test('a step tier pick proposes a new revision; the active version stays until the modal approves it', async () => {
  const { app, page } = await launchDemo({ orchestrator: true, width: 1400, height: 900 });
  try {
    // stand-in host: records the exact request and answers like FlowService.editStepTier (a proposed draft revision)
    await app.evaluate(({ ipcMain }, base) => {
      const g = globalThis as unknown as { tierEdits: unknown[] };
      g.tierEdits = [];
      ipcMain.removeHandler('flows:editStepTier');
      ipcMain.handle('flows:editStepTier', (_event, edit: { stepId: string; tier: string | null }) => {
        g.tierEdits.push(edit);
        const definition = structuredClone(base.versions[0]!.definition);
        const step = definition.steps.find(s => s.id === edit.stepId)!;
        if (edit.tier) step.tier = edit.tier as never; else delete step.tier;
        return { ...base, drafts: [{ definition, revision: 2, updatedAt: Date.now(), status: 'proposed' }] };
      });
    }, stepAgentSnapshot());
    await page.getByTestId('nav-flussi').click();
    await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0]!.webContents.send('flows:changed', value), stepAgentSnapshot());
    await expect(page.getByTestId('flow-definition')).toContainText('Correzione di prova');
    await page.locator('#flow-run-picker').selectOption('definition');
    await page.locator('.flow-full-definition > summary').click();
    const menus = page.locator('.flow-full-definition').getByTestId('flow-step-tier');
    await expect(menus).toHaveCount(2); // the role-less step has no menu
    // only the tiers the role allows, up to its tierMax, each with its model
    await expect(menus.first().locator('option')).toHaveText(['scelto dal ruolo', 'light · demo-light-model', 'mid · demo-mid-model']);
    await expect(menus.nth(1).locator('option')).toHaveCount(4);
    await menus.first().scrollIntoViewIfNeeded();
    await shot(page, 'flow-step-tier-menu');
    await menus.first().selectOption('light');
    expect(await app.evaluate(() => (globalThis as unknown as { tierEdits: unknown[] }).tierEdits)).toEqual([
      { flowId: 'demo-fix', base: { version: 1 }, stepId: 'investigate', tier: 'light', contextKey: 'flow-step-agent-fixture' },
    ]);
    // the version shown is still v1 (mid); the new revision waits in the existing modal and locks further picks
    await expect(page.locator('.flow-draft-notice')).toBeVisible();
    await expect(page.locator('.flow-badge[data-status=active]')).toBeVisible();
    await expect(menus.first()).toHaveValue('mid');
    await expect(menus.first()).toBeDisabled();
    await shot(page, 'flow-step-tier');
  } finally { await app.close(); }
});
