// Exact App Service and push permissions stay inspectable in approval and fullscreen. Written on the branch;
// execute only in the main-branch E2E suite. All values are synthetic, with no remote effects or model calls.
import { test, expect } from '@playwright/test';
import { launchDemo, publishFlows, shot } from './helpers';
import { routineConsentSnapshot } from '../fixtures/routine-consent';
test('routine consent shows exact targets and fullscreen retains the environment contract', async () => {
  const { app, page } = await launchDemo({ orchestrator: true });
  try {
    await page.getByTestId('nav-flussi').click(); await publishFlows(app, routineConsentSnapshot);
    const modal = page.getByTestId('qwin-flow-automation'); await expect(modal).toBeVisible();
    await expect(modal.getByTestId('flow-deploy-target')).toContainText('sample-test');
    await expect(modal.getByTestId('flow-deploy-target')).toContainText('Sample_Test');
    await expect(modal.getByTestId('flow-push-target')).toContainText('refs/heads/fix/routine-');
    await shot(page, 'routine-exact-target-consent'); await page.getByTestId('qwin-later').click();
    await page.getByTestId('rt-tab-routines').click(); await page.getByTestId('rt-routine-card').filter({ hasText: 'Correzione verificata in test' }).click(); await page.getByTestId('flow-fullscreen-open').click();
    await expect(page.getByTestId('flow-fullscreen')).toContainText('shared-test');
    await expect(page.getByTestId('flow-fullscreen')).toContainText('Raccogli screenshot');
    await shot(page, 'routine-environment-fullscreen'); await page.keyboard.press('Escape');
    await expect(page.getByTestId('flow-fullscreen')).toHaveCount(0);
  } finally { await app.close(); }
});
