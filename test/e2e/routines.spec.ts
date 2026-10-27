// The Routine section on the new model (ADR 0175, 0176), on the demo's seeded packages and run folders (no engine, no
// DevOps): the list with the trigger badge and «Credenziali da inserire», the runs of the app and of the terminal, a
// package's trigger, filters and copyable commands, a run waiting for a person (red, with the DevOps link) and a
// finished run with its report; credentials are typed write-only.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

test('Routine section: packages, app and terminal runs, live run view, write-only credentials', async () => {
  const { app, page } = await launchDemo({ width: 1440, height: 900 });
  try {
    await page.getByTestId('nav-flussi').click();
    const list = page.getByTestId('routines-page');
    await expect(list.getByTestId('routine-card-air-bugfix')).toContainText('Trigger attivo');
    await expect(list.getByTestId('routine-card-release-notes')).toContainText('Credenziali da inserire');
    await expect(list.getByTestId('routine-run-20261026-163000-112233')).toContainText('Terminale');
    await expect(list.getByTestId('routine-run-20261027-091500-a1b2c3')).toContainText('Serve una persona');
    await shot(page, 'routines-list');

    await list.getByTestId('routine-card-air-bugfix').click();
    const detail = page.getByTestId('routine-detail');
    await expect(detail.getByTestId('routine-trigger-toggle')).toBeChecked();
    await expect(detail.getByTestId('routine-filter-states')).toHaveValue('New');
    await expect(detail.getByTestId('routine-filter-include')).toHaveValue('ai-fixable');
    await detail.getByTestId('routine-item-input').fill('48213');
    await expect(detail.getByTestId('routine-commands')).toContainText('workItem=48213');
    await expect(detail).not.toContainText('demo-only');
    await shot(page, 'routines-detail');

    await detail.getByTestId('routine-run-20261027-091500-a1b2c3').click();
    const waiting = page.getByTestId('routine-run-view');
    await expect(waiting.getByTestId('run-current-step')).toContainText('Step 2 di 4');
    await expect(waiting.getByTestId('run-waiting').getByRole('link')).toHaveAttribute('href', /_workitems\/edit\/48213/);
    await shot(page, 'routines-run-waiting');

    await page.getByRole('button', { name: '← Indietro', exact: true }).click();
    await page.getByTestId('routine-detail').getByTestId('routine-run-20261027-071000-d4e5f6').click();
    const done = page.getByTestId('routine-run-view');
    await expect(done.getByTestId('run-report')).toBeVisible();
    await expect(done.getByTestId('run-not-verified')).toBeVisible();
    await expect(done.getByTestId('run-waiting')).toHaveCount(0);
    await shot(page, 'routines-run-done');

    await page.getByRole('button', { name: '← Indietro', exact: true }).click();
    await page.getByRole('button', { name: '← Indietro', exact: true }).click();
    await page.getByTestId('routine-card-release-notes').click();
    const secret = page.getByTestId('routine-secret-devopsPat');
    await expect(secret).toHaveAttribute('type', 'password');
    await secret.fill('typed-in-e2e');
    await page.getByTestId('routine-secrets-save').click();
    await expect(page.getByTestId('routine-secrets')).not.toContainText('Credenziali da inserire');
    await expect(secret).toHaveValue('');
    await expect(page.getByTestId('routines-page')).not.toContainText('typed-in-e2e');
  } finally { await app.close(); }
});
