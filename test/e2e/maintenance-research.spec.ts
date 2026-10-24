// E2E of the one-click «Manutenzione» (ADR 0132, 0153) on the frozen demo: one click on the top bar's button and nothing
// else (no dialog): it says it started, breathes while the invisible research works (its chat never shows as a strip
// or in the sidebar), and ends in the celebrate notice with what it made and «Apri Memoria». In Proposte an idea or a
// bug about the app is a card «Apro su GitHub la issue …?» with the issue as it will be opened; approving it opens it
// (the demo records the page instead of reaching GitHub) and the card leaves. Screenshots:
// test-results/shots/maintenance-one-click-*.png.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

test('Manutenzione: one click, invisible research, end notice, issue cards in Proposte', async () => {
  test.setTimeout(150_000);
  const { app, page } = await launchDemo({ orchestrator: true, height: 1100 });
  try {
    const btn = page.getByTestId('topbar-maint-run');
    await btn.click();
    await expect(page.getByTestId('topbar-maint-dialog')).toHaveCount(0);
    await expect(page.getByTestId('toast').filter({ hasText: 'Manutenzione avviata' })).toBeVisible();
    // the end notice: celebrate, with chips and «Apri Memoria»
    const notice = page.locator('.notif.tone-celebrate');
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(notice).toContainText('Manutenzione finita');
    await expect(notice.locator('.notif-chip').first()).toBeVisible();
    await expect(page.getByTestId('topbar-maint')).toHaveAttribute('data-state', 'done');
    await page.mouse.move(2, 2);
    await shot(page, 'maintenance-one-click-done-dark');
    // the research chat stayed out of sight
    await expect(page.getByTestId('sidebar').getByText('Manutenzione', { exact: true })).toHaveCount(0);
    await notice.getByTestId('toast-action').click();

    // Proposte: the issue cards
    const deck = page.getByTestId('proposals-deck');
    await expect(deck).toBeVisible();
    await deck.getByTestId('pd-chip-issue').click();
    await expect(deck).toContainText('Apro su GitHub la issue');
    await expect(deck).toContainText('La issue, come sarà aperta');
    await page.mouse.move(2, 2);
    await shot(page, 'maintenance-one-click-issue-dark');
    const before = await deck.getByTestId('pd-chip-issue').innerText();
    await deck.getByTestId('pd-approve').click();
    await expect.poll(() => deck.getByTestId('pd-chip-issue').innerText().catch(() => ''), { timeout: 20_000 }).not.toBe(before);
    // the hero shows the last one
    await page.getByTestId('mh-tab-proposte').click();
    await expect(page.getByTestId('bm-maint-now-last')).toContainText('Ultima');
  } finally { await app.close(); }
});
