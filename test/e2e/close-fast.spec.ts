// E2E of the quick close (demo): the ✕ in a chat tile's header and Ctrl+W on the selected chat close it at once with
// the usual "Chiusa «…» · Annulla" (6 s); Annulla brings it back. The Regia has no ✕ and Ctrl+W never closes it;
// a double click or a held Ctrl+W closes one chat; a maximized chat leaves that view and comes back maximized with Annulla; Ctrl+W under a dialog or in the requests
// layer never closes the app window (Electron's default menu would).
// Screenshots in test-results/shots/close-fast-*.
import { expect, test } from '@playwright/test';
import { ctrlWHandled, launchDemo, shot } from './helpers';

test('the ✕ and Ctrl+W close a chat with Annulla; never the Regia, never the window', async () => {
  const { app, page } = await launchDemo({ regia: true });
  await expect(page.getByTestId('tile-chat-fix')).toBeVisible();
  await expect(page.getByTestId('chat-x-fix')).toBeVisible();
  await expect(page.getByTestId('tile-regia').locator('[data-testid^="chat-x-"]')).toHaveCount(0);
  await shot(page, 'close-fast-1-x');

  // ✕: gone at once, Annulla brings it back
  await page.getByTestId('chat-x-fix').click();
  await expect(page.getByTestId('tile-chat-fix')).toHaveCount(0);
  const toast = page.getByTestId('toast').filter({ hasText: 'Chiusa «Fix totale ordine»' });
  await expect(toast).toBeVisible();
  await shot(page, 'close-fast-2-closed');
  await toast.getByTestId('toast-action').click();
  await expect(page.getByTestId('tile-chat-fix')).toBeVisible();

  // a double click on the ✕ closes one chat: the next tile's ✕, which slides under the pointer, ignores the second click;
  // right after Annulla, so a ✕ soon after a close counts (no time window swallows it)
  const tiles = page.locator('[data-testid^="tile-chat-"]');
  const n = await tiles.count();
  await page.getByTestId('chat-x-fix').dblclick();
  await expect(page.getByTestId('tile-chat-fix')).toHaveCount(0);
  await page.waitForTimeout(300);
  await expect(tiles).toHaveCount(n - 1);
  await page.getByTestId('toast').filter({ hasText: 'Chiusa «Fix totale ordine»' }).getByTestId('toast-action').click();
  await expect(tiles).toHaveCount(n);

  // ✕ on a maximized chat: it leaves the maximized view too; Annulla brings it back maximized
  await page.getByTestId('chat-max-fix').click();
  await page.getByTestId('chat-x-fix').click();
  await expect(page.getByTestId('tile-chat-fix')).toHaveCount(0);
  await page.getByTestId('toast').filter({ hasText: 'Chiusa «Fix totale ordine»' }).getByTestId('toast-action').click();
  await expect(page.getByTestId('chat-max-fix')).toHaveAttribute('aria-label', /Ripristina/);
  await page.getByTestId('chat-max-fix').click();

  // Ctrl+W on the selected chat, held down (auto-repeat) then pressed again while it is closing: one close, no other
  // toast that would push "Annulla" out
  await page.getByTestId('tile-chat-fix').locator('.th-title').click();
  await page.keyboard.down('Control');
  for (let i = 0; i < 4; i++) await page.keyboard.down('w');
  await page.keyboard.up('w');
  await page.keyboard.up('Control');
  await expect(page.getByTestId('tile-chat-fix')).toHaveCount(0);
  await page.keyboard.press('Control+W');
  await expect(page.getByTestId('toast').filter({ hasText: 'Chiusa «Fix totale ordine»' })).toHaveCount(1);
  await expect(page.getByTestId('toast').filter({ hasText: 'Seleziona prima una chat' })).toHaveCount(0);
  await page.getByTestId('toast').filter({ hasText: 'Chiusa «Fix totale ordine»' }).getByTestId('toast-action').click();
  await expect(page.getByTestId('tile-chat-fix')).toBeVisible();

  // a brain page in front: Ctrl+W does not close the chat selected behind it
  await page.getByTestId('tile-chat-fix').locator('.th-title').click();
  await page.keyboard.press('Control+Comma');
  const refused = page.getByTestId('toast').filter({ hasText: 'Seleziona prima una chat' });
  const before = await refused.count();
  await page.keyboard.press('Control+W');
  await expect(refused).toHaveCount(before + 1);
  await page.keyboard.press('Control+1');
  await expect(page.getByTestId('tile-chat-fix')).toBeVisible();
  await expect(page.getByTestId('toast').filter({ hasText: 'Chiusa «Fix totale ordine»' })).toHaveCount(0);

  // the Regia: Ctrl+W only explains
  await page.getByTestId('tile-regia').locator('h3').first().click();
  await page.keyboard.press('Control+W');
  await expect(page.getByTestId('toast').filter({ hasText: 'L’Orchestrator non si chiude con Ctrl+W' })).toBeVisible();
  await expect(page.getByTestId('tile-regia')).toBeVisible();

  // under a dialog: nothing closes, the window stays. A real key event (sendInputEvent), not page.keyboard: only a real
  // one reaches Electron's default menu, whose Ctrl+W ("Close") would close the window and quit the app
  await page.keyboard.press('Control+N');
  await expect(page.getByTestId('newchat-cancel')).toBeVisible();
  expect(await ctrlWHandled(app, 'window')).toBe(0);
  await expect(page.getByTestId('newchat-cancel')).toBeVisible();
  await expect(page.getByTestId('tile-chat-fix')).toBeAttached();
  await page.keyboard.press('Escape');

  // the requests layer (its own view over the window) focused: Ctrl+W stays there
  await expect.poll(() => app.evaluate(({ webContents }) => webContents.getAllWebContents().some(w => w.getURL().includes('#overlay')))).toBe(true);
  expect(await ctrlWHandled(app, 'layer')).toBe(0);
  await expect(page.getByTestId('tile-regia')).toBeVisible();
  await app.close();
});
