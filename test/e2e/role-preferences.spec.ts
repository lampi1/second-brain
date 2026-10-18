// Main-only regression: explicit role preview/cancel/commit/undo and persistent preferences, no live harness.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';
test('role selection previews, cancels, persists and restores the previous choice', async () => {
  const { app, page } = await launchDemo();
  try {
    const setup = await page.evaluate(() => window.sb.invoke('setup:get', undefined));
    if (setup.status === 'new' || setup.status === 'draft') {
      await page.getByTestId('first-interview').getByRole('button', { name: 'Salta per ora', exact: true }).click();
    }
    await page.keyboard.press('Control+Comma');
    const role = page.getByTestId('role-preferences');
    await expect(role).toBeVisible();
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('sb.prefs.v1') ?? '{}').role);
    const before = await saved();
    await role.getByRole('button', { name: 'Ruolo', exact: true }).click();
    await page.locator('.ui-select-list [data-value="qa"]').click();
    await role.getByRole('button', { name: 'Anteprima', exact: true }).click();
    await expect(role.getByTestId('role-preview')).toContainText('Analisi');
    await shot(page, 'role-preview');
    await role.getByRole('button', { name: 'Annulla', exact: true }).click();
    await expect(role.getByRole('button', { name: 'Anteprima', exact: true })).toBeFocused();
    expect(await saved()).toEqual(before);
    await role.getByRole('button', { name: 'Anteprima', exact: true }).click();
    await role.getByRole('button', { name: 'Conferma ruolo', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(role.getByRole('button', { name: 'Anteprima', exact: true })).toBeFocused();
    await expect(role.getByRole('status')).toHaveText('Ruolo salvato.');
    expect(await saved()).toMatchObject({ presetId: 'qa', presetRevision: 1 });
    await role.getByRole('button', { name: 'Ripristina ruolo precedente', exact: true }).click();
    await expect(role.getByRole('button', { name: 'Anteprima', exact: true })).toBeFocused();
    await expect(role.getByRole('status')).toHaveText('Ruolo precedente ripristinato.');
    expect(await saved()).toEqual(before);
  } finally { await app.close(); }
});
