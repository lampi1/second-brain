// Impostazioni → Avanzate, the worktree pool of the delegated chats (WorktreeSettings.tsx, ADR 0227): the three
// limits (per repository, in total, disk cap in GB) with their defaults, the automatic cleanup off until the first «Pulisci ora», the space of each repository, the worktrees
// that hold work listed and never removed, «Pulisci ora» (the demo pool answers made-up repositories, demo-worktrees.ts);
// a changed limit is saved (settings:get). Screenshots in test-results/shots/worktree-settings-*.png.
import { expect, test } from '@playwright/test';
import { goPage, launchDemo, shot } from './helpers';

test('the worktree pool shows its limits, the space per repository and what it never removes', async () => {
  const { app, page } = await launchDemo();
  try {
    await goPage(page, 'impostazioni');
    await expect(page.getByTestId('settings-page')).toBeVisible();
    const box = page.getByTestId('st-worktrees');
    await box.scrollIntoViewIfNeeded();
    await expect(page.getByTestId('st-worktreePoolPerRepo')).toHaveValue('6');
    await expect(page.getByTestId('st-worktreePoolTotal')).toHaveValue('20');
    await expect(page.getByTestId('st-worktreeDiskCapGb')).toHaveValue('40');
    await expect(page.getByTestId('st-worktrees-repos')).toContainText('shop-api');
    await expect(page.getByTestId('st-worktrees-total')).toContainText('45.6 GB su 40 GB');
    await expect(page.getByTestId('st-worktrees-reported')).toContainText('commit non pubblicati');
    await expect(page.getByTestId('st-worktrees-reported')).toContainText('modifiche non committate');
    await expect(page.getByTestId('st-worktrees-auto')).toContainText('parte dopo il tuo primo «Pulisci ora»');
    await shot(page, 'worktree-settings-before');
    await page.getByTestId('st-worktrees-clean').click();
    await expect(page.getByTestId('st-worktrees-total')).toContainText('11.1 GB su 40 GB');
    await expect(page.getByTestId('st-worktrees-total')).toContainText('33 cancellate');
    await expect(page.getByTestId('st-worktrees-auto')).toHaveText('Pulizia automatica ogni 6 ore.');
    await expect(page.getByTestId('st-worktrees-reported')).toContainText('commit non pubblicati');
    await shot(page, 'worktree-settings-after');
    const field = page.getByTestId('st-worktreePoolPerRepo');
    await field.fill('3');
    await field.press('Enter');
    await expect.poll(async () => (await page.evaluate(() => window.sb.invoke('settings:get', undefined))).worktreePoolPerRepo).toBe(3);
  } finally { await app.close(); }
});
