import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Launches the built app (out/) with an isolated profile and test ports; returns the app and its window. */
export async function launch(env: Record<string, string> = {}): Promise<{ app: ElectronApplication; page: Page; userData: string }> {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-'));
  const app = await electron.launch({
    args: ['.'],
    cwd: path.resolve(import.meta.dirname, '..', '..'),
    env: { ...process.env, SB_USER_DATA: userData, SB_MCP_PORT: '0', SB_TEST: '1', ...env } as Record<string, string>,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page, userData };
}

export async function shot(page: Page, name: string): Promise<string> {
  const dir = path.resolve(import.meta.dirname, '..', '..', 'test-results', 'shots');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}
