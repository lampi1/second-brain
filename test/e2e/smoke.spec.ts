// Smoke e2e: the app boots, the preload bridge answers and the renderer stays sandboxed (no Node in the page).
import { test, expect } from '@playwright/test';
import { launch, shot } from './helpers';

test('the app boots, the bridge answers and the renderer is sandboxed', async () => {
  const { app, page } = await launch();
  await expect(page.getByTestId('app')).toBeVisible();
  // the brand shows only its mark: name and version are its label and tooltip (ADR 0020)
  await expect(page.getByTestId('app-version')).toHaveAttribute('aria-label', /^second-brain v\d+\.\d+\.\d+/);
  await expect(page.getByTestId('app-version')).toHaveAttribute('data-tip', /second-brain · v\d+\.\d+\.\d+/);
  // no Node in the page, only the allow-listed bridge
  expect(await page.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe('undefined');
  // invoke and on only: pathForFile (the agent pack's drag-drop import) left with the pack (ADR 0125)
  expect(await page.evaluate(() => Object.keys(window.sb).sort().join(','))).toBe('invoke,on');
  await expect(page.evaluate(() => (window.sb.invoke as (c: string, a: unknown) => Promise<unknown>)('evil:channel', null))).rejects.toThrow(/not allowed/);
  await shot(page, 'smoke');
  await app.close();
});
