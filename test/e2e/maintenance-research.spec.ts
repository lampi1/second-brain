// E2E of the maintenance with research (ADR 0132) on the frozen demo: the «Manutenzione» button in the top bar opens the
// dialog with the engine, model, effort and spending cap, the prompt shown and editable (Ripristina brings it back) and
// the fixed frame; «Avvia pulizia e ricerca» runs the free cleanup and opens the research chat, whose findings arrive
// as cards. In Memoria → «Idee dell'app» every idea or bug shows what it adds and removes and the issue as it will be
// opened; «Apri issue» hands one to the Orchestrator and marks it, «Apri tutte» the rest in one message. A research
// change in Proposte shows what it adds and removes. Screenshots: test-results/shots/maintenance-research-*.png.
import { expect, test } from '@playwright/test';
import { choose, launchDemo, shot } from './helpers';

test('Manutenzione con ricerca: dialog, prompt, cards, Idee dell’app with Apri issue and Apri tutte', async () => {
  test.setTimeout(150_000);
  const { app, page } = await launchDemo({ orchestrator: true, height: 1100 });
  try {
    await page.getByTestId('topbar-maint-run').click();
    const dlg = page.getByTestId('topbar-maint-dialog');
    await expect(dlg).toBeVisible();
    await expect(dlg.getByTestId('topbar-maint-start')).toHaveText('Avvia la pulizia');
    await dlg.getByTestId('mm-r-toggle').check();
    await expect(dlg.getByTestId('topbar-maint-start')).toHaveText('Avvia pulizia e ricerca');
    await expect(dlg.getByTestId('mm-r-engine')).toHaveAttribute('data-value', 'claude');
    await expect(dlg.getByTestId('mm-r-cap')).toHaveValue('5');
    // the prompt: shown, editable, Ripristina only once edited
    const prompt = dlg.getByTestId('mm-r-prompt');
    const original = await prompt.inputValue();
    expect(original.length).toBeGreaterThan(200);
    await expect(dlg.getByTestId('mm-r-reset')).toBeDisabled();
    await prompt.fill(`${original}\nGuarda soprattutto i costi.`);
    await expect(dlg.getByTestId('mm-r-reset')).toBeEnabled();
    await dlg.getByTestId('mm-r-frame-toggle').click();
    await expect(dlg.getByTestId('mm-r-frame')).toContainText('maintenance_propose');
    await page.mouse.move(2, 2);
    await shot(page, 'maintenance-research-setup-dark');
    // Cursor has no effort: the effort choice goes
    await choose(dlg.getByTestId('mm-r-engine'), 'cursor');
    await expect(dlg.getByTestId('mm-r-effort')).toHaveCount(0);
    await choose(dlg.getByTestId('mm-r-engine'), 'claude');
    await dlg.getByTestId('topbar-maint-start').click();
    await expect(dlg.getByTestId('mm-job-logs')).toBeVisible();
    const status = dlg.getByTestId('mm-r-status');
    await expect(status).toBeVisible();
    await expect(status.getByTestId('mm-r-cards')).toHaveText('2 card', { timeout: 15_000 });
    await shot(page, 'maintenance-research-run-dark');
    await dlg.getByTestId('mm-r-to-ideas').click();
    await expect(dlg).toHaveCount(0);

    // «Idee dell'app»
    const tab = page.getByTestId('app-ideas');
    await expect(tab).toBeVisible();
    const cards = tab.getByTestId('ai-card');
    expect(await cards.count()).toBeGreaterThanOrEqual(4);
    const first = cards.first();
    await first.getByTestId('ai-show').click();
    await expect(first.getByTestId('ai-body')).not.toBeEmpty();
    await shot(page, 'maintenance-research-ideas-dark');
    const before = await tab.getByTestId('ai-open').count();
    await first.getByTestId('ai-open').click();
    await expect(page.getByTestId('tile-orchestrator')).toContainText('GitHub issue');
    await page.getByTestId('nav-memoria').click();
    await page.getByTestId('mh-tab-app').click();
    await expect(tab.getByTestId('ai-asked')).toHaveCount(1);
    await expect(tab.getByTestId('ai-open')).toHaveCount(before - 1);
    await expect(tab.getByTestId('ai-open-all')).toContainText(String(before - 1));
    await tab.getByTestId('ai-open-all').click();
    await expect(page.getByTestId('tile-orchestrator')).toContainText(`these ${before - 1} GitHub issues`);
    await page.getByTestId('nav-memoria').click();
    await page.getByTestId('mh-tab-app').click();
    await expect(tab.getByTestId('ai-open')).toHaveCount(0);
    await expect(tab.getByTestId('ai-open-all')).toBeDisabled();
  } finally { await app.close(); }
});
