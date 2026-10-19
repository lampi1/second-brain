// Warning UI on a real hidden Electron demo. Backend reservation/race/time behavior is covered with fake-clock
// unit and manager integration tests. Inject only a typed status fixture; never wait real minutes or close a live agent.
// Run on main only, after the shared event/adapter integration. Screenshot is a required future runtime check.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

test('a real backend deadline is visible with an accessible keep-open action, and stays below a modal', async () => {
  const { app, page } = await launchDemo();
  try {
    await app.evaluate(({ BrowserWindow }) => {
      const now = performance.timeOrigin + performance.now();
      BrowserWindow.getAllWindows()[0]!.webContents.send('chat:autoCloseStatus', [{ chatId: 'fix', deadline: now + 119_000, warningStartedAt: now, clockAt: now, generation: 7, keptOpen: false, reason: null }]);
    });
    const warning = page.getByTestId('autoclose-warnings');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('Chiusura automatica tra');
    await expect(warning.getByRole('button', { name: 'Resta aperto', exact: true })).toBeVisible();
    await expect(page.getByTestId('tile-chat-fix')).toBeVisible();
    await shot(page, 'autoclose-real-deadline');
    await page.keyboard.press('Control+N');
    await expect(page.getByTestId('newchat')).toBeVisible();
    await expect(warning).not.toBeVisible();
    await page.getByTestId('newchat-cancel').click();
    await expect(warning).toBeVisible();
  } finally { await app.close(); }
});

// #86 (ADR 0084): a held work chat says what it waits for, on its strip, from the status main sends.
test('a held work chat shows what it waits for on its strip', async () => {
  const { app, page } = await launchDemo();
  try {
    await expect(page.getByTestId('tile-chat-fix')).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => {
      const now = performance.timeOrigin + performance.now();
      BrowserWindow.getAllWindows()[0]!.webContents.send('chat:autoCloseStatus', [{ chatId: 'fix', deadline: null, warningStartedAt: null, clockAt: now, generation: 3, keptOpen: false, reason: 'In attesa dell’utente', waitingFor: 'user' }]);
    });
    const label = page.getByTestId('autoclose-waiting-fix');
    await expect(label).toBeVisible();
    await expect(label).toHaveText('In attesa dell’utente');
    await expect(page.getByTestId('autoclose-warnings')).toHaveCount(0);
    await shot(page, 'autoclose-waiting-label');
  } finally { await app.close(); }
});
