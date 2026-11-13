// E2E of the scheduled routines (ADR 0280) on the frozen demo: «Pianificate» above the terminal packages on the
// Routine page, a routine made from an example with its rule in words and its next run, paused and resumed with the
// switch, and deleted with two clicks. No engine: nothing is handed to an Orchestrator here.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

test('Routine page: schedule a request from an example, pause it, delete it', async () => {
  const { app, page } = await launchDemo({ width: 1440, height: 900 });
  try {
    await page.getByTestId('nav-flussi').click();
    const box = page.getByTestId('schedules');
    await expect(box.getByTestId('schedules-empty')).toBeVisible();
    await shot(page, 'schedules-empty');

    // an example fills the form: daily at 08:00 by default
    await box.getByTestId('schedules-empty').getByRole('button').first().click();
    await expect(page.getByTestId('schedule-name')).toHaveValue('Giornale del mattino');
    await expect(page.getByTestId('schedule-prompt')).toHaveValue(/Aggiorna il giornale/);
    await shot(page, 'schedules-form');
    await page.getByTestId('schedule-save').click();

    const row = box.locator('.sch-list li').first();
    await expect(row).toContainText('Giornale del mattino');
    await expect(row).toContainText('ogni giorno alle');
    await expect(row.getByTestId('schedule-next')).toBeVisible();
    await shot(page, 'schedules-list');

    // the switch pauses it: no next run while paused
    await row.getByRole('switch').click();
    await expect(row).toContainText('in pausa');
    await expect(row.getByTestId('schedule-next')).toHaveCount(0);
    await row.getByRole('switch').click();
    await expect(row.getByTestId('schedule-next')).toBeVisible();

    // delete asks once more on the same button
    await row.getByRole('button', { name: 'Elimina', exact: true }).click();
    await row.getByRole('button', { name: 'Sì, elimina', exact: true }).click();
    await expect(box.getByTestId('schedules-empty')).toBeVisible();
    // the terminal packages are still below
    await expect(page.getByTestId('routines-page').getByTestId('routine-card-air-bugfix')).toBeVisible();
  } finally {
    await app.close();
  }
});
