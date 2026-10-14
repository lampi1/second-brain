// E2E of the app's self-healing (ADR 0026): the main window's renderer crashing or hanging reloads the page while the
// chats keep their state in main (health counts it for app_state), and an MCP port taken by another instance shows one
// banner instead of a line only in the log.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { AppHealth } from '../../src/shared/contract';
import { launchDemo, shot } from './helpers';

test.describe.configure({ timeout: 180_000 }); // a reload on a loaded box takes 10+ s

const health = async (page: Page): Promise<AppHealth> =>
  (await page.evaluate(() => (window.sb.invoke as (c: string, a: unknown) => Promise<{ health: AppHealth }>)('app:info', undefined))).health;

/** The main window (not the overlay layer), driven from the main process: Playwright's page dies with the renderer. */
const mainWin = (app: ElectronApplication, what: 'crash' | 'hang' | 'health' | 'tiles' | 'shot'): Promise<unknown> => app.evaluate(async ({ BrowserWindow }, w) => {
  const win = BrowserWindow.getAllWindows().find(x => !x.webContents.getURL().includes('#'));
  if (!win) throw new Error('main window not found');
  const wc = win.webContents;
  if (w === 'crash') { setTimeout(() => wc.forcefullyCrashRenderer(), 100); return null; } // after this evaluate returned
  if (w === 'hang') { win.emit('unresponsive'); return null; }
  if (w === 'health') return ((globalThis as Record<string, unknown>).__sbHealth as () => unknown)();
  if (wc.isCrashed() || wc.isLoading()) return null;
  if (w === 'tiles') return wc.executeJavaScript("document.querySelectorAll('[data-testid^=tile-chat-]').length");
  return (await wc.capturePage()).toPNG().toString('base64');
}, what);

const reloadedHealth = async (app: ElectronApplication): Promise<AppHealth> => {
  let h: AppHealth | null = null;
  await expect.poll(async () => { try { h = (await mainWin(app, 'health')) as AppHealth | null; return h?.renderer.reloads ?? -1; } catch (e) { return String(e).slice(0, 200); } }, { timeout: 60_000 }).toBe(1);
  return h!;
};

const saveShot = async (app: ElectronApplication, name: string): Promise<void> => {
  const b64 = (await mainWin(app, 'shot')) as string;
  const dir = path.resolve(import.meta.dirname, '..', '..', 'test-results', 'shots');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.png`), Buffer.from(b64, 'base64'));
};

test('a crashed main-window renderer reloads by itself; the chats are still there', async () => {
  const { app, page } = await launchDemo();
  const tiles = await page.locator('[data-testid^=tile-chat-]').count();
  expect(tiles).toBeGreaterThan(0);
  await mainWin(app, 'crash');
  const h = await reloadedHealth(app);
  expect(h.renderer).toMatchObject({ crashes: 1, hangs: 0, reloads: 1 });
  expect(h.renderer.last?.what).toBe('gone');
  await expect.poll(() => mainWin(app, 'tiles'), { timeout: 60_000 }).toBe(tiles);
  await saveShot(app, 'stability-renderer-reloaded');
  await app.close();
});

test('a hung main window is reloaded after the hang delay', async () => {
  const { app } = await launchDemo({ env: { SB_HANG_RELOAD_MS: '300' } });
  await mainWin(app, 'hang');
  const h = await reloadedHealth(app);
  expect(h.renderer).toMatchObject({ crashes: 0, hangs: 1, reloads: 1 });
  await app.close();
});

test('an MCP port taken by another instance shows one banner, closable', async () => {
  const blocker = net.createServer();
  await new Promise<void>(r => blocker.listen(0, '127.0.0.1', () => r()));
  const port = (blocker.address() as net.AddressInfo).port;
  try {
    const { app, page } = await launchDemo({ env: { SB_MCP_PORT: String(port) } });
    const banner = page.getByTestId('health-mcp');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(`Porta MCP ${port} occupata`);
    const h = await health(page);
    expect(h.mcp).toMatchObject({ wanted: port, fallback: true });
    expect(h.mcp.port).not.toBe(port);
    await expect(page.getByTestId('health-mcp')).toHaveCount(1);
    await shot(page, 'stability-mcp-banner');
    await page.getByTestId('health-mcp-close').click();
    await expect(banner).toHaveCount(0);
    await app.close();
  } finally { blocker.close(); }
});
