// E2E helpers: launch the built app (out/) with an isolated profile, find the app's own page (browser tabs are pages
// too), optionally in the demo (SB_DEMO=1, frozen = SB_DEMO_FREEZE=1) at a fixed window size and color scheme, wait
// until it is settled (data loaded, clock frozen, browser snapshots in), read what the UI reported to main for the
// browser views (globalThis.__sbDemo, demo only) and save screenshots in test-results/shots/. A spec may seed the
// fresh profile's settings (`config`, e.g. questionsModal). The Regia starts reduced to its top-bar button (ADR 0021); `regia: true` opens its overlay.
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface Launched { app: ElectronApplication; page: Page; userData: string }

// Electron's own teardown after app.exit takes 3-20 s on a loaded Windows box (measured 2026-10-13: a bare Electron
// app the same), time no test checks. close() therefore returns once the app has finished its own quit (its log's
// "exit" line, written synchronously after the shutdown, the storage flush included) and the process ends in the
// background; a relaunch on the same profile waits for it first (single-instance lock, files). ADR 0042.
const exiting = new Map<string, Promise<void>>();
const exitLines = (userData: string): number => {
  const dir = path.join(userData, 'logs');
  try {
    return fs.readdirSync(dir).reduce((n, f) => n + (fs.readFileSync(path.join(dir, f), 'utf8').match(/"scope":"app","msg":"exit"/g)?.length ?? 0), 0);
  } catch { return 0; }
};

function fastClose(app: ElectronApplication, userData: string): void {
  const close = app.close.bind(app);
  let closing: Promise<void> | null = null;
  app.close = () => closing ??= (async () => {
    const proc = app.process();
    if (proc.exitCode !== null || proc.signalCode !== null) return close();
    const before = exitLines(userData);
    const gone = close();
    const settled: Promise<void> = gone.catch(() => {}).finally(() => { if (exiting.get(userData) === settled) exiting.delete(userData); });
    exiting.set(userData, settled);
    let quit = false;
    const logged = (async () => { while (!quit && exitLines(userData) <= before) await new Promise(r => setTimeout(r, 50)); })();
    try { await Promise.race([gone, logged]); } finally { quit = true; }
  })();
}

/** Launches the built app (out/) with an isolated profile and test ports; returns the app and its window. */
export async function launch(env: Record<string, string> = {}, userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-'))): Promise<Launched> {
  await exiting.get(userData); // the previous app on this profile is still ending
  const app = await electron.launch({
    args: ['.'],
    cwd: path.resolve(import.meta.dirname, '..', '..'),
    // SB_HIDDEN: the app runs off screen and never takes focus (the user keeps working while tests run)
    env: { ...process.env, SB_USER_DATA: userData, SB_MCP_PORT: '0', SB_TEST: '1', SB_HIDDEN: '1', ...env } as Record<string, string>,
  });
  fastClose(app, userData);
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
export async function launchDemo(opts: { freeze?: boolean; width?: number; height?: number; scheme?: 'dark' | 'light'; userData?: string; config?: Record<string, unknown>; regia?: boolean; env?: Record<string, string> } = {}): Promise<Launched> {
  const { freeze = true, width = 1600, height = 1000, scheme = 'dark' } = opts;
  const userData = opts.userData ?? fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-'));
  // a fresh profile gets the settings the spec seeds; a reused one keeps its own
  const cfg = path.join(userData, 'config.json');
  if (opts.config && !fs.existsSync(cfg)) fs.writeFileSync(cfg, JSON.stringify(opts.config));
  const l = await launch({ SB_DEMO: '1', SB_DEMO_FREEZE: freeze ? '1' : '0', ...opts.env }, userData);
  await setSize(l.app, width, height);
  await l.page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  await expect(l.page.locator('[data-regia-overlay]')).toBeVisible(); // the Regia widget: collapsed or, as left, expanded
  if (opts.regia) await openRegia(l.page);
  if (freeze) await expect(l.page.locator('html[data-clock="frozen"]')).toHaveCount(1);
  await l.page.mouse.move(2, 2);
  return l;
}

/** Expands the Regia widget (its collapsed bar, bottom-right) unless it is expanded already. */
export async function openRegia(page: Page): Promise<void> {
  if (!(await page.getByTestId('regia-overlay').isVisible())) await page.getByTestId('regia-pill').click();
  await expect(page.getByTestId('tile-regia')).toBeVisible();
}

/** Collapses the Regia widget to its bar unless it is collapsed already. */
export async function closeRegia(page: Page): Promise<void> {
  if (await page.getByTestId('regia-overlay').isVisible()) await page.getByTestId('regia-collapse').click();
  await expect(page.getByTestId('regia-pill')).toBeVisible();
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
    const [w, h] = win.getContentSize();
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: w!, height: h! } });
    // by name only when it is the one window so named: with the suite in parallel another app's window has the name too
    const named = sources.filter(s => s.name === 'second-brain');
    const src = sources.find(s => s.id === win.getMediaSourceId()) ?? (named.length === 1 ? named[0] : undefined);
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
