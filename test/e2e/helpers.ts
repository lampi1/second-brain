// E2E helpers: launch the built app (out/) with an isolated profile, find the app's own page (browser tabs are pages
// too), optionally in the demo (SB_DEMO=1, frozen = SB_DEMO_FREEZE=1) at a fixed window size and color scheme, wait
// until it is settled (data loaded, clock frozen, browser snapshots in), read what the UI reported to main for the
// browser views (globalThis.__sbDemo, demo only) and save screenshots in test-results/shots/.
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface Launched { app: ElectronApplication; page: Page; userData: string }

/** Launches the built app (out/) with an isolated profile and test ports; returns the app and its window. */
export async function launch(env: Record<string, string> = {}, userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-'))): Promise<Launched> {
  const app = await electron.launch({
    args: ['.'],
    cwd: path.resolve(import.meta.dirname, '..', '..'),
    env: { ...process.env, SB_USER_DATA: userData, SB_MCP_PORT: '0', SB_TEST: '1', ...env } as Record<string, string>,
  });
  await app.firstWindow();
  let page: Page | undefined;
  for (let i = 0; i < 100 && !page; i++) {
    page = app.windows().find(w => w.url().startsWith('file:') && !w.url().includes('#overlay'));
    if (!page) await new Promise(r => setTimeout(r, 100));
  }
  if (!page) throw new Error('app window not found');
  await page.waitForLoadState('domcontentloaded');
  return { app, page, userData };
}

export async function setSize(app: ElectronApplication, width: number, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.setContentSize(w!, h!);
  }, [width, height]);
}

/** The demo, settled: data loaded, (frozen) clock applied, browser snapshots shown. */
export async function launchDemo(opts: { freeze?: boolean; width?: number; height?: number; scheme?: 'dark' | 'light'; userData?: string } = {}): Promise<Launched> {
  const { freeze = true, width = 1600, height = 1000, scheme = 'dark' } = opts;
  const l = await launch({ SB_DEMO: '1', SB_DEMO_FREEZE: freeze ? '1' : '0' }, opts.userData);
  await setSize(l.app, width, height);
  await l.page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  await expect(l.page.getByTestId('tile-regia')).toBeVisible();
  if (freeze) await expect(l.page.locator('html[data-clock="frozen"]')).toHaveCount(1);
  await l.page.mouse.move(2, 2);
  return l;
}

/** Wait until the browser placeholders on screen show their snapshot (so screenshots show the pages). */
export async function waitThumbs(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => {
    const ph = [...document.querySelectorAll<HTMLElement>('[data-testid^="browser-view-"], [data-testid^="thumb-"]')];
    // a tile's snapshot must be the one taken at the tile's own size (not an earlier one at another size)
    return ph.length > 0 && ph.every(p => {
      const img = p.querySelector('img');
      if (!img || !img.complete || img.naturalWidth === 0) return false;
      return !p.dataset.testid?.startsWith('browser-view-') || Math.abs(img.naturalWidth - p.clientWidth * devicePixelRatio) <= 3;
    });
  }), { timeout: 10_000 }).toBe(true);
}

export type Layout = { tabId: string; rect: { x: number; y: number; width: number; height: number } | null }[];
export async function demoLayout(app: ElectronApplication): Promise<Layout> {
  return app.evaluate(() => (globalThis as unknown as { __sbDemo: { layout(): Layout } }).__sbDemo.layout());
}

export async function shot(page: Page, name: string): Promise<string> {
  const dir = path.resolve(import.meta.dirname, '..', '..', 'test-results', 'shots');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
  return file;
}

/** The global request layer's page (main/overlay.ts), once it exists. */
export async function layerPage(app: ElectronApplication): Promise<Page> {
  for (let i = 0; i < 100; i++) {
    const p = app.windows().find(w => w.url().includes('#overlay'));
    if (p) { await p.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' }); return p; }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('layer page not found');
}

export type LayerState = { attached: boolean; bounds: { x: number; y: number; width: number; height: number } | null; cards: number; toasts: number };
export async function layerState(app: ElectronApplication): Promise<LayerState> {
  return app.evaluate(() => (globalThis as unknown as { __sbOverlay: { state(): LayerState } }).__sbOverlay.state());
}

/** A screenshot of the whole window as Windows composes it (app page + browser views + the layer on top). */
export async function windowShot(app: ElectronApplication, name: string): Promise<string> {
  const b64 = await app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
    const win = BrowserWindow.getAllWindows()[0]!;
    win.focus();
    const [w, h] = win.getContentSize();
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: w!, height: h! } });
    const src = sources.find(s => s.id === win.getMediaSourceId()) ?? sources.find(s => s.name === 'second-brain');
    return src ? src.thumbnail.toPNG().toString('base64') : '';
  });
  const dir = path.resolve(import.meta.dirname, '..', '..', 'test-results', 'shots');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  if (b64) fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  return file;
}

/** Visual baseline options: tolerant to sub-pixel font rendering, strict on layout. */
export const VISUAL = { maxDiffPixelRatio: 0.015, animations: 'disabled' as const, caret: 'hide' as const, timeout: 15_000 };
