// Main-only runtime verification after effort backend integration; no real provider calls.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

test('effort remains honest and keyboard-operable in agent headers and focus', async () => {
  const { app, page } = await launchDemo();
  try {
    const chat = await page.evaluate(async () => (await window.sb.invoke('chat:list', undefined)).find(c => c.id === 'fix'));
    expect(chat).toBeDefined();
    await app.evaluate(({ BrowserWindow }, current) => {
      BrowserWindow.getAllWindows()[0]!.webContents.send('chat:updated', { ...current, effort: 'medium', effortStatus: { supported: true, requested: 'medium', submitted: 'medium', effective: null, pending: false, effectiveSource: 'unknown', sessionDefault: 'xhigh' } });
    }, chat);
    const badge = page.getByTestId('effort-fix').getByRole('button');
    await expect(badge).toHaveText('Attivo: non riportato');
    await badge.focus(); await page.keyboard.press('Enter');
    const pop = page.getByTestId('effort-pop-fix');
    await expect(pop).toBeVisible();
    await expect(pop.getByRole('menuitemradio').first()).toBeFocused();
    await pop.getByRole('menuitem', { name: 'Chiudi', exact: true }).click();
    await expect(badge).toBeFocused();
    await shot(page, 'effort-unknown-header');
    await page.setViewportSize({ width: 640, height: 720 });
    await expect(badge).toBeVisible();
    await shot(page, 'effort-small-header');
  } finally { await app.close(); }
});
