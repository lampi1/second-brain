// E2E gallery of the dialogs on the shared base (components/ui.tsx Modal, 2026-10-22): a confirmation (size s, «Ferma
// tutto»), a dialog (size m, the keyboard shortcuts) and a side panel (the Log's
// detail), in dark and light, so the one look (head with title and subtitle, the body, the footer with the primary
// action on the right) is seen whole. Each one also closes with Esc. Screenshots: test-results/shots/modal-<name>-<theme>.png.
import { expect, test } from '@playwright/test';
import { goPage, launchDemo, shot } from './helpers';

for (const scheme of ['dark', 'light'] as const) {
  test(`dialogs share one base · ${scheme}`, async () => {
    test.setTimeout(120_000);
    const { app, page } = await launchDemo({ scheme, config: { theme: scheme }, orchestrator: true, height: 1000 });
    try {
      // a confirmation: title, its text, Annulla and the primary action on the right
      await page.getByTestId('topbar-stopall').click();
      const confirm = page.getByTestId('confirm');
      await expect(confirm).toBeVisible();
      await expect(confirm.locator('.modal-head h2')).toContainText('Fermare 2 chat');
      const foot = confirm.locator('.modal-foot .btn');
      await expect(foot.last()).toHaveAttribute('data-testid', 'confirm-ok');
      await page.mouse.move(2, 2);
      await shot(page, `modal-confirm-${scheme}`);
      await page.keyboard.press('Escape');
      await expect(confirm).toHaveCount(0);

      // a dialog: the keyboard shortcuts, with a close button in its head
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('Control+/');
      const keys = page.getByTestId('shortcuts');
      await expect(keys).toBeVisible();
      await expect(keys.getByTestId('shortcuts-close-x')).toBeVisible();
      await shot(page, `modal-shortcuts-${scheme}`);
      await keys.getByTestId('shortcuts-close-x').click();
      await expect(keys).toHaveCount(0);

      // a side panel: the Log's detail, down the right edge
      await goPage(page, 'log');
      const log = page.getByTestId('log-page');
      await log.getByTestId('lg-task').first().getByTestId('lg-step-work').first().click();
      const detail = page.getByTestId('lg-detail');
      await expect(detail).toBeVisible();
      await expect(detail).toHaveClass(/modal-side/);
      await page.mouse.move(2, 2);
      await shot(page, `modal-log-detail-${scheme}`);
      await page.keyboard.press('Escape');
      await expect(detail).toHaveCount(0);
    } finally {
      await app.close();
    }
  });
}
