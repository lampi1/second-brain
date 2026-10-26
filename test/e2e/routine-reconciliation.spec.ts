// User-only reconciliation evidence and selection; authored on branch, first executed on main.
import { test, expect } from '@playwright/test';
import { launchDemo, shot } from './helpers';
// @ts-expect-error native fixture helper is plain JavaScript
import { captureReconciliation } from '../../scripts/dev-visual-reconciliation.mjs';
test('reconciles only selected writes with evidence from the run history modal', async () => {
  const { app, page } = await launchDemo({ orchestrator: true });
  try {
    await captureReconciliation(app, page, async (name: string) => {
      if (name === 'routine-reconcile-proposal') { await expect(page.getByTestId('qwin-flow-reconcile')).toContainText('PR #17'); await expect(page.getByTestId('flow-reconcile-yes')).toBeEnabled(); await shot(page, name); return; }
      if (name === 'routine-reconcile-resumed') { await expect(page.getByTestId('qwin-flow-reconcile')).toHaveCount(0); await shot(page, name); return; }
      const modal = page.getByTestId('routine-reconciliation');
      await expect(modal.getByTestId('reconcile-operation')).toHaveCount(4);
      if (name === 'routine-write-reconciled') { await expect(modal.locator('select')).toHaveCount(3); await expect(modal).toContainText('Effetto annullato'); await expect(modal.getByTestId('reconcile-confirm')).toBeDisabled(); }
      else { await expect(modal).toContainText('contoso · #42'); await expect(modal.getByTestId('reconcile-confirm')).toBeEnabled(); }
      await shot(page, name);
    });
  } finally { await app.close(); }
});
