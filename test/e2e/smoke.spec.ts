import { test, expect } from '@playwright/test';
import { launch, shot } from './helpers';

test('the app boots, the bridge answers and the renderer is sandboxed', async () => {
  const { app, page } = await launch();
  await expect(page.getByTestId('app')).toBeVisible();
  await expect(page.locator('.topbar')).toContainText('second-brain');
  await expect(page.locator('.topbar')).toContainText(/v\d+\.\d+\.\d+/);
  // no Node in the page, only the allow-listed bridge
  expect(await page.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe('undefined');
  expect(await page.evaluate(() => Object.keys(window.sb).sort().join(','))).toBe('invoke,on');
  await expect(page.evaluate(() => (window.sb.invoke as (c: string, a: unknown) => Promise<unknown>)('evil:channel', null))).rejects.toThrow(/not allowed/);
  await shot(page, 'smoke');
  await app.close();
});
