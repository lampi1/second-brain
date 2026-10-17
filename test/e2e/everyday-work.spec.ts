// Everyday-work entry point: context and deliverable are available without opening developer controls.
// Written on the branch; run only on main as required by AGENTS.md. Screenshot uses the existing hidden demo helper.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

test('prepare ordinary work with optional context while technical settings remain collapsed', async () => {
  const { app, page } = await launchDemo();
  try {
    await page.keyboard.press('Control+N');
    const dialog = page.getByTestId('newchat');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('newchat-cwd')).not.toBeVisible();
    await expect(page.getByTestId('newchat-harness-claude')).not.toBeVisible();
    await page.getByTestId('newchat-work-path').selectOption('client');
    await page.getByTestId('newchat-prompt').fill('Prepara la riunione di domani');
    await page.getByTestId('newchat-work-context').locator('summary').click();
    await page.getByTestId('newchat-context').fill('Il cliente deve scegliere tra due offerte');
    await page.getByTestId('newchat-outcome').fill('Una scaletta con domande e prossimi passi');
    await expect(page.getByTestId('newchat-create')).toBeEnabled();
    await shot(page, 'everyday-work-context');
    await page.getByTestId('newchat-cancel').click();
    await expect(dialog).toHaveCount(0);
  } finally { await app.close(); }
});
