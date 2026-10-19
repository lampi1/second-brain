// E2E of the Task alerts and "Apri chat" (ADR 0029), in the demo (tasks/demo.ts: no network, no tokens): the first
// "Aggiorna ora" is the baseline (no alert, no chime); the second brings a new mention, which shows a Task toast in
// the global layer and plays the chime once on arrival (counted on <html data-chimes>; a hidden run is muted); the page's head
// turns the sound off. "Apri chat" on a work item row starts a work chat "Shop · <title>" in one click (the row does not
// open) with a toast "Chat aperta: …", its engine, model and effort from the routing table (a bug: the bug-fix row); PRs
// and test plans have the same button. Screenshots in test-results/shots/.
import { expect, test } from '@playwright/test';
import { launchDemo, layerPage, shot, windowShot } from './helpers';

test('Task: a new mention alerts with a chime (never on the first read); Apri chat starts a chat from a record', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 1000 });
  try {
    await page.getByTestId('nav-task').click();
    const dv = page.getByTestId('brain-page-task');
    await dv.getByTestId('task-refresh').click();
    await expect(dv.getByTestId('task-news-mention:demo-1')).toBeVisible({ timeout: 30_000 });
    await expect(dv.getByTestId('task-refresh')).toBeEnabled();
    const layer = await layerPage(app);
    await page.waitForTimeout(1000);
    await expect(layer.getByTestId('ev-toast-task-alert')).toHaveCount(0);       // first read: the baseline
    expect(await page.evaluate(() => document.documentElement.dataset.chimes ?? '0')).toBe('0');

    await dv.getByTestId('task-refresh').click();
    await expect(dv.getByTestId('task-news-mention:demo-2')).toBeVisible({ timeout: 30_000 });
    await expect(layer.getByTestId('ev-toast-task-alert')).toContainText('Marco ti menziona: Promemoria SMS inviati due volte');
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.chimes ?? '0')).toBe('1');
    await windowShot(app, 'task-alert-toast');
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => document.documentElement.dataset.chimes)).toBe('1'); // once, not at every repaint

    // the sound can be turned off from the page's head
    const sound = dv.getByTestId('task-auto').getByRole('group', { name: 'Suono degli avvisi' });
    await expect(sound.getByRole('button', { name: 'Acceso' })).toHaveAttribute('aria-pressed', 'true');
    await sound.getByRole('button', { name: 'Spento' }).click();
    await expect(sound.getByRole('button', { name: 'Spento' })).toHaveAttribute('aria-pressed', 'true');

    // "Apri chat": every kind of record has it; one click on a work item row starts the chat, the row stays closed
    await expect(dv.getByTestId('task-chat-pr-812').first()).toBeVisible();
    await expect(dv.getByTestId('task-qa').getByTestId('task-chat-testplan-7000')).toBeVisible();
    const row = dv.getByTestId('task-assigned').getByTestId('task-item-4711');
    const btn = row.getByTestId('task-chat-workitem-4711');
    await btn.scrollIntoViewIfNeeded();
    await btn.hover();
    await shot(page, 'task-apri-chat');
    await btn.click();
    await expect(page.getByTestId('toasts')).toContainText('Chat aperta: Shop · Il totale del rimborso ignora lo sconto applicato');
    await expect(row).not.toHaveAttribute('open', '');
    const chats = await page.evaluate(() => window.sb.invoke('chat:list', undefined));
    const made = chats.find(c => c.title === 'Shop · Il totale del rimborso ignora lo sconto applicato');
    expect(made).toBeTruthy();
    // through the routing table (ADR 0032): a bug is bug-fix, the demo table's row says Opus, high effort, and the chat
    // carries the route for the ledger (before: the last "Nuova chat" choice, no route)
    expect(made).toMatchObject({ harness: 'claude', model: 'claude-opus-5-5', effort: 'high', route: { policy: 'routing', source: 'table', kind: 'bug-fix', area: 'Shop', version: 3 } });
    await shot(page, 'task-apri-chat-toast');
    await page.getByTestId('toasts').getByRole('button', { name: 'Vai alla chat' }).click();
    await expect(page.getByTestId(`chat-sub-${made!.id}`)).toContainText('Opus');
    await shot(page, 'task-apri-chat-routed');
  } finally {
    await app.close();
  }
});
