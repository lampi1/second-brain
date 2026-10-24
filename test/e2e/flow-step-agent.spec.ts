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
