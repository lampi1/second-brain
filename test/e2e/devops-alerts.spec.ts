// E2E of the DevOps alerts and "Apri chat" (ADR 0029), in the demo (devops/demo.ts: no network, no tokens): the first
// "Aggiorna ora" is the baseline (no alert, no chime); the second brings a new mention, which shows a DevOps toast in
// the global layer and plays the chime once on arrival (counted on <html data-chimes>; a hidden run is muted); the page's head
// turns the sound off. "Apri chat" on a work item row starts a work chat "Shop · <title>" in one click (the row does not
// open) with a toast "Chat aperta: …"; PRs and test plans have the same button. Screenshots in test-results/shots/.
import { expect, test } from '@playwright/test';
import { launchDemo, layerPage, shot, windowShot } from './helpers';

test('DevOps: a new mention alerts with a chime (never on the first read); Apri chat starts a chat from a record', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 1000 });
  try {
    await page.getByTestId('nav-devops').click();
    const dv = page.getByTestId('brain-page-devops');
    await dv.getByTestId('devops-refresh').click();
    await expect(dv.getByTestId('devops-news-mention:demo-1')).toBeVisible({ timeout: 30_000 });
    await expect(dv.getByTestId('devops-refresh')).toBeEnabled();
    const layer = await layerPage(app);
    await page.waitForTimeout(1000);
    await expect(layer.getByTestId('ev-toast-devops-alert')).toHaveCount(0);       // first read: the baseline
    expect(await page.evaluate(() => document.documentElement.dataset.chimes ?? '0')).toBe('0');

    await dv.getByTestId('devops-refresh').click();
    await expect(dv.getByTestId('devops-news-mention:demo-2')).toBeVisible({ timeout: 30_000 });
    await expect(layer.getByTestId('ev-toast-devops-alert')).toContainText('Marco ti menziona: Promemoria SMS inviati due volte');
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.chimes ?? '0')).toBe('1');
    await windowShot(app, 'devops-alert-toast');
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => document.documentElement.dataset.chimes)).toBe('1'); // once, not at every repaint

    // the sound can be turned off from the page's head
    const sound = dv.getByTestId('devops-auto').getByRole('group', { name: 'Suono degli avvisi' });
    await expect(sound.getByRole('button', { name: 'Acceso' })).toHaveAttribute('aria-pressed', 'true');
    await sound.getByRole('button', { name: 'Spento' }).click();
    await expect(sound.getByRole('button', { name: 'Spento' })).toHaveAttribute('aria-pressed', 'true');

    // "Apri chat": every kind of record has it; one click on a work item row starts the chat, the row stays closed
    await expect(dv.getByTestId('devops-chat-pr-812').first()).toBeVisible();
    await expect(dv.getByTestId('devops-qa').getByTestId('devops-chat-testplan-7000')).toBeVisible();
    const row = dv.getByTestId('devops-assigned').getByTestId('devops-item-4711');
    const btn = row.getByTestId('devops-chat-workitem-4711');
    await btn.scrollIntoViewIfNeeded();
    await btn.hover();
    await shot(page, 'devops-apri-chat');
    await btn.click();
    await expect(page.getByTestId('toasts')).toContainText('Chat aperta: Shop · Il totale del rimborso ignora lo sconto applicato');
    await expect(row).not.toHaveAttribute('open', '');
    const chats = await page.evaluate(() => window.sb.invoke('chat:list', undefined));
    const made = chats.find(c => c.title === 'Shop · Il totale del rimborso ignora lo sconto applicato');
    expect(made).toBeTruthy();
    await shot(page, 'devops-apri-chat-toast');
  } finally {
    await app.close();
  }
});
