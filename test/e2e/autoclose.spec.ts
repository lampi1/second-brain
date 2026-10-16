// E2E of the auto-close (frozen demo): a finished work chat stays a tile for the delay (default 2 minutes, time to read
// the final answer), a touch on its tile restarts the wait, then it leaves the grid by itself with a short
// "Chiusa: <titolo> · Riapri" notice; no "Finite oggi" dock or column (the user, 2026-10-13): closed chats are found
// with Ctrl+K and reopened with their history; the Regia never closes; the delay is set in Impostazioni (0 = never).
// Screenshots in test-results/shots/autoclose-*.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchDemo, shot } from './helpers';

type Demo = { finish(chatId: string, agoMs: number, isError?: boolean): void };
const finish = (app: ElectronApplication, chatId: string, agoMs: number, isError = false) =>
  app.evaluate((_e, [id, ago, err]) => (globalThis as unknown as { __sbDemo: Demo }).__sbDemo.finish(id, ago, err), [chatId, agoMs, isError] as const);
const MIN = 60_000;
// what the renderer's auto-close check saw last per chat (components/AutoCloser.tsx): a test waits for the check on a
// new result instead of a fixed pause
const seen = (page: Page, chatId: string) => page.evaluate(id =>
  (globalThis as unknown as { __sbAutoClose: { seen: Record<string, { at: number; due: boolean }> } }).__sbAutoClose.seen[id] ?? null, chatId);
/** Finishes the chat and waits for the auto-close check on that result; returns whether that check closed it. */
async function finishChecked(app: ElectronApplication, page: Page, chatId: string, agoMs: number, isError = false): Promise<boolean> {
  const before = (await seen(page, chatId))?.at;
  await finish(app, chatId, agoMs, isError);
  await expect.poll(async () => (await seen(page, chatId))?.at).not.toBe(before);
  return (await seen(page, chatId))!.due;
}

test('finished chats close by themselves after the grace period, Ctrl+K finds and reopens them', async () => {
  const { app, page } = await launchDemo();
  await expect(page.getByTestId('tile-chat-fix')).toBeVisible();
  // the demo's old finished chats start closed: none on the grid, the palette has them
  await expect(page.getByTestId('tile-chat-review')).toHaveCount(0);
  for (const id of ['review', 'note', 'report']) await page.evaluate(chatId => window.sb.invoke('chat:reopen', { chatId }), id);
  await expect(page.getByTestId('folded-dock')).toHaveCount(0);
  await shot(page, 'autoclose-1-before');

  // a turn that ended 1 minute ago stays (delay 2 min); one ended with an error never closes
  expect(await finishChecked(app, page, 'fix', MIN)).toBe(false);
  expect(await finishChecked(app, page, 'mappa', 10 * MIN, true)).toBe(false);
  await expect(page.getByTestId('tile-chat-fix')).toBeVisible();
  await expect(page.getByTestId('tile-chat-mappa')).toBeVisible();

  await finish(app, 'fix', 3 * MIN);
  await expect(page.getByTestId('tile-chat-fix')).toHaveCount(0);
  await expect(page.getByTestId('toast').filter({ hasText: 'Chiusa: Fix totale ordine' })).toBeVisible();
  await expect(page.getByTestId('toast').getByRole('button', { name: 'Riapri' })).toBeVisible();
  await expect(page.getByTestId('regia-pill')).toBeVisible(); // the Regia never closes
  await shot(page, 'autoclose-2-closed');

  // the user touched it (reading the final answer): the wait starts again from the touch (then selects another tile,
  // so only the touch holds it)
  await page.getByTestId('tile-chat-review').click();
  await page.getByTestId('tile-chat-sms').click();
  expect(await finishChecked(app, page, 'review', 10 * MIN)).toBe(false);
  await expect(page.getByTestId('tile-chat-review')).toBeVisible();

  // the search bar lists the closed one with its title and reopens it with its history
  await page.keyboard.press('Control+K');
  await page.getByTestId('palette-input').fill('fix totale');
  const item = page.getByTestId('palette-item-closed:fix');
  await expect(item).toContainText('Fix totale ordine');
  await expect(item).toContainText('Invio la riapre');
  await shot(page, 'autoclose-3-palette');
  await item.click();
  await expect(page.getByTestId('tile-chat-fix')).toBeVisible();
  await expect(page.getByTestId('tile-chat-fix')).toContainText('Ho trovato la causa');

  // Corsie: two columns, the finished chat leaves "Al lavoro" by itself
  await page.keyboard.press('Control+Shift+V');
  await expect(page.getByTestId('view-corsie')).toBeVisible();
  await expect(page.getByTestId('col-done')).toHaveCount(0);
  await expect(page.getByTestId('col-working')).toContainText('Note personali');
  await finish(app, 'note', 3 * MIN);
  await expect(page.getByTestId('col-working')).not.toContainText('Note personali');
  await shot(page, 'autoclose-4-corsie');

  // the delay lives in Impostazioni; "Mai" stops it
  await page.getByTestId('settings').click();
  await page.getByTestId('settings-all').click();
  await expect(page.getByTestId('st-autoclose-choice-2')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('st-autoclose-choice-0').click();
  await expect(page.getByTestId('st-autoclose-choice-0')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('st-autoclose').scrollIntoViewIfNeeded();
  await shot(page, 'autoclose-5-settings');
  expect((await page.evaluate(() => window.sb.invoke('settings:get', undefined))).autoCloseMin).toBe(0);
  expect(await finishChecked(app, page, 'report', 30 * MIN)).toBe(false);
  expect((await page.evaluate(() => window.sb.invoke('chat:list', undefined))).find(c => c.id === 'report')?.closedAt).toBeFalsy();
  await app.close();
});
