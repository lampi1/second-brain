// Chat ↔ browser pairs on the demo (two chats drive a browser each): the chat tile and its browser tile share one
// accent (class paired, same data-pair, different from the other pair), the browser says "di: <chat>" and a click
// there goes to the chat, hovering one tile lights up the other; in the agents column, focus mode, dark and light. Screenshots in test-results/shots/pairs-*.png.
import { expect, test, type Page } from '@playwright/test';
import { showBrowsers, launchDemo, shot, waitThumbs } from './helpers';

const pairOf = (page: Page, testid: string) => page.getByTestId(testid).getAttribute('data-pair');

async function expectPaired(page: Page, chat: string, tab: string): Promise<string> {
  await expect(page.getByTestId(`tile-chat-${chat}`)).toHaveClass(/\bpaired\b/);
  await expect(page.getByTestId(`tile-browser-${tab}`)).toHaveClass(/\bpaired\b/);
  const p = await pairOf(page, `tile-chat-${chat}`);
  expect(p).not.toBeNull();
  expect(await pairOf(page, `tile-browser-${tab}`)).toBe(p);
  return p!;
}

test('a chat and its browser share a color, light up together and link to each other, in the column and in focus mode', async () => {
  const { app, page } = await launchDemo();
  await showBrowsers(page, 'qa', 'sms'); // a strip's browser shows once opened beside the open strip
  await waitThumbs(page);

  // the agents column
  const qa = await expectPaired(page, 'qa', 'tab-qa');
  const sms = await expectPaired(page, 'sms', 'tab-sms');
  expect(qa).not.toBe(sms);
  await expect(page.getByTestId('tile-chat-fix')).not.toHaveClass(/\bpaired\b/);       // no browser, no color
  const qaTitle = (await page.getByTestId('tile-chat-qa').locator('.th-title').textContent()) ?? '';
  expect(qaTitle).not.toBe('');
  await expect(page.getByTestId('browser-owner-tab-qa')).toHaveText(qaTitle);
  await expect(page.getByTestId('tile-browser-tab-qa').locator('.drv')).toContainText('di:');

  await page.getByTestId('tile-chat-qa').locator('.tile-head').hover();
  await expect(page.getByTestId('tile-browser-tab-qa')).toHaveClass(/\bpair-hot\b/);
  await expect(page.getByTestId('tile-chat-qa')).toHaveClass(/\bpair-hot\b/);
  await expect(page.getByTestId('tile-browser-tab-sms')).not.toHaveClass(/\bpair-hot\b/);
  await shot(page, 'pairs-agents-hover-dark');
  await page.getByTestId('tile-browser-tab-sms').locator('.tile-head').hover();
  await expect(page.getByTestId('tile-chat-sms')).toHaveClass(/\bpair-hot\b/);
  await expect(page.getByTestId('tile-chat-qa')).not.toHaveClass(/\bpair-hot\b/);

  // the chat name on the browser goes to its chat
  await page.getByTestId('browser-owner-tab-sms').click();
  await expect(page.getByTestId('tile-chat-sms')).toHaveClass(/\bfocused\b/);

  await page.evaluate(() => window.sb.invoke('settings:set', { theme: 'light' }));
  await expect(page.locator('html[data-theme="light"]')).toHaveCount(1);
  await page.mouse.move(2, 2);
  await shot(page, 'pairs-agents-light');
  await page.evaluate(() => window.sb.invoke('settings:set', { theme: 'dark' }));
  await expect(page.locator('html[data-theme="dark"]')).toHaveCount(1);

  // focus mode on the chat: its browser beside it, same color
  await page.getByTestId('tile-chat-qa').locator('.tile-head').click();
  await page.keyboard.press('Control+Shift+F');
  await expect(page.getByTestId('focus-view')).toBeVisible();
  expect(await expectPaired(page, 'qa', 'tab-qa')).toBe(qa);
  await shot(page, 'pairs-focus-dark');
  await page.getByTestId('focus-exit').click();
  await app.close();
});
