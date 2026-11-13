// E2E of the Task alerts and "Discuti" (ADR 0029), in the demo (tasks/demo.ts: no network, no tokens): the first
// "Aggiorna ora" is the baseline (no alert, no chime); the second brings a new mention, which shows a Task toast in
// the global layer and plays the chime once on arrival (counted on <html data-chimes>; a hidden run is muted); the page's head
// turns the sound off. "Discuti" on a work item in the detail pane puts a ready draft about the record in the
// Orchestrator's input, not sent, and creates no work chat (owner, 2026-10-19: the Orchestrator delegates); sent, the
// row shows "Discusso". PRs, test plans and test cases have the same button. Screenshots in test-results/shots/.
import { expect, test } from '@playwright/test';
import { launchDemo, layerPage, shot, windowShot } from './helpers';

test('Task: a new mention alerts with a chime (never on the first read); Discuti on a record drafts to the Orchestrator and opens no work chat', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 1000 });
  try {
    await page.getByTestId('nav-task').click();
    const dv = page.getByTestId('brain-page-task');
    await dv.getByTestId('task-refresh').click();
    await expect(dv.getByTestId('task-row-news:mention:demo-1')).toBeVisible({ timeout: 30_000 });
    await expect(dv.getByTestId('task-refresh')).toBeEnabled();
    const layer = await layerPage(app);
    await page.waitForTimeout(1000);
    await expect(layer.getByTestId('ev-toast-task-alert')).toHaveCount(0);       // first read: the baseline
    expect(await page.evaluate(() => document.documentElement.dataset.chimes ?? '0')).toBe('0');

    await dv.getByTestId('task-refresh').click();
    await expect(dv.getByTestId('task-row-news:mention:demo-2')).toBeVisible({ timeout: 30_000 });
    await expect(layer.getByTestId('ev-toast-task-alert')).toContainText('Marco ti menziona: Promemoria SMS inviati due volte');
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.chimes ?? '0')).toBe('1');
    await windowShot(app, 'task-alert-toast');
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => document.documentElement.dataset.chimes)).toBe('1'); // once, not at every repaint

    // the sound can be turned off in Settings → Notifiche, reached from the page's link (ADR 0101)
    await dv.getByTestId('task-settings-link').click();
    const sound = page.getByTestId('task-auto').getByRole('group', { name: 'Suono degli avvisi' });
    await expect(sound.getByRole('button', { name: 'Acceso' })).toHaveAttribute('aria-pressed', 'true');
    await sound.getByRole('button', { name: 'Spento' }).click();
    await expect(sound.getByRole('button', { name: 'Spento' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('nav-task').click();

    // "Discuti": every kind of record has it in the detail pane; one click on a work item drafts to the Orchestrator
    await dv.getByTestId('task-tab-prs').click();
    await dv.getByTestId('task-row-pr:812').click();
    await expect(dv.getByTestId('task-detail').getByTestId('task-discuss-pr-812').first()).toBeVisible();
    await dv.getByTestId('task-tab-qa').click();
    await dv.locator('[data-testid^="task-row-qa:"]').first().click();
    await expect(dv.getByTestId('task-detail').getByTestId('task-discuss-testplan-7000')).toBeVisible();
    await expect(dv.getByRole('button', { name: /^Apri chat$/ })).toHaveCount(0);
    await dv.getByTestId('task-tab-items').click();
    await dv.getByTestId('task-row-item:4711').click();
    const row = dv.getByTestId('task-detail').getByTestId('task-item-4711');
    const btn = row.getByTestId('task-discuss-workitem-4711');
    await expect(btn).toHaveText('Discuti');
    await btn.scrollIntoViewIfNeeded();
    await btn.hover();
    await shot(page, 'task-discuti');
    const before = (await page.evaluate(() => window.sb.invoke('chat:list', undefined))).map(c => c.id).sort();
    await btn.click();
    const input = page.getByTestId('orchestrator-input');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(/^Let's discuss this bug from Azure DevOps: «Il totale del rimborso ignora lo sconto applicato»\.\nLink: /);
    await expect(input).toHaveValue(/Area: Shop/);
    await expect(input).toHaveValue(/open a work chat yourself \(«Shop · Il totale del rimborso ignora lo sconto applicato»\)/);
    await expect(dv).toBeVisible(); // the page stays
    await expect(row.getByTestId('task-discuss-workitem-4711-mark')).toHaveCount(0); // not sent yet
    await shot(page, 'task-discuti-draft');
    // sent with Enter: the Orchestrator gets it; still no new chat (the Orchestrator decides and delegates)
    await page.keyboard.press('Enter');
    await expect(input).toHaveValue('');
    await expect(row.getByTestId('task-discuss-workitem-4711-mark')).toContainText('Discusso');
    await expect(page.getByTestId('orchestrator-overlay')).toContainText('Il totale del rimborso ignora lo sconto applicato');
    const after = (await page.evaluate(() => window.sb.invoke('chat:list', undefined))).map(c => c.id).sort();
    expect(after).toEqual(before);
    await shot(page, 'task-discuti-sent');
  } finally {
    await app.close();
  }
});
