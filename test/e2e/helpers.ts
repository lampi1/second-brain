// E2E helpers: launch the built app (out/) with an isolated profile, find the app's own page (browser tabs are pages
// too), optionally in the demo (SB_DEMO=1, frozen = SB_DEMO_FREEZE=1) at a fixed window size and color scheme, wait
// until it is settled (data loaded, clock frozen, browser snapshots in), read what the UI reported to main for the
// browser views (globalThis.__sbDemo, demo only) and save screenshots in test-results/shots/. A spec may seed the
// fresh profile's settings (`config`, e.g. theme). The Orchestrator column is always open (ADR 0068); `orchestrator: true` waits for its chat.
// The demo's own open requests are set aside at start (the questions window would cover the page) unless `questions: true`.
import { _electron as electron, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
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
  userData = fs.realpathSync.native(userData);
  await exiting.get(userData); // the previous app on this profile is still ending
  const app = await electron.launch({
    // SB_E2E_ELECTRON_ARGS: extra Chromium switches for a machine without a GPU, e.g. a Linux container where the 3D
    // map needs software WebGL: "--use-angle=swiftshader --enable-unsafe-swiftshader"
    args: [...(process.env.SB_E2E_ELECTRON_ARGS ?? '').split(/\s+/).filter(a => /^--[\w-]+(=[\w.-]+)?$/.test(a)), '.'],
    cwd: path.resolve(import.meta.dirname, '..', '..'),
    // SB_HIDDEN: the app runs off screen and never takes focus (the user keeps working while tests run)
    env: { ...process.env, SB_USER_DATA: userData, SB_MCP_PORT: '0', SB_TEST: '1', SB_HIDDEN: '1', SB_LANG: 'it', ...env } as Record<string, string>,
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
    const win = BrowserWindow.getAllWindows().find(x => x.webContents.getURL().startsWith('file:') && !x.webContents.getURL().includes('#overlay'));
    // All test windows are hidden and frameless: setContentSize adds phantom frame pixels on Windows.
    win?.setSize(w!, h!);
  }, [width, height]);
}

/** The demo, settled: data loaded, (frozen) clock applied, browser snapshots shown. */
export async function launchDemo(opts: { freeze?: boolean; width?: number; height?: number; scheme?: 'dark' | 'light'; userData?: string; config?: Record<string, unknown>; orchestrator?: boolean; env?: Record<string, string>; questions?: boolean } = {}): Promise<Launched> {
  const { freeze = true, width = 1600, height = 1000, scheme = 'dark' } = opts;
  const userData = opts.userData ?? fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-'));
  // a fresh profile gets the settings the spec seeds; a reused one keeps its own
  const cfg = path.join(userData, 'config.json');
  if (opts.config && !fs.existsSync(cfg)) fs.writeFileSync(cfg, JSON.stringify(opts.config));
  const l = await launch({ SB_DEMO: '1', SB_DEMO_FREEZE: freeze ? '1' : '0', ...opts.env }, userData);
  await setSize(l.app, width, height);
  await l.page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  await expect(l.page.locator('[data-orchestrator-overlay]')).toBeVisible(); // the persistent Orchestrator column
  if (opts.orchestrator) await openOrchestrator(l.page);
  if (freeze) await expect(l.page.locator('html[data-clock="frozen"]')).toHaveCount(1);
  if (!opts.questions) await (freeze ? setQuestionsAside(l) : keepQuestionsAside(l.page));
  await l.page.mouse.move(2, 2);
  return l;
}

/** The questions window is always on (2026-10-22) and the demo starts with open requests: a test about something else
 *  sets them aside first with «Rispondi dopo», as the user would (each one stays in «Da rispondere»; Ctrl+J or the top
 *  bar's counter brings them back). `launchDemo({ questions: true })` keeps the window up. */
export async function setQuestionsAside({ app, page }: Pick<Launched, 'app' | 'page'>): Promise<void> {
  const open = await app.evaluate(() => (globalThis as unknown as { __sbDemo?: { pending(): number } }).__sbDemo?.pending() ?? 0);
  if (!open) return;
  const win = page.getByTestId('qwin');
  await expect(win).toBeVisible({ timeout: 15_000 });
  for (let i = 0; i < open && await win.count(); i++) await page.getByTestId('qwin-later').click();
  await expect(win).toHaveCount(0);
}

/** The live demo (not frozen) keeps asking while a test about something else runs: every request the window shows is
 *  set aside with «Rispondi dopo» as soon as it shows, as a user busy elsewhere would (until the page reloads). */
export async function keepQuestionsAside(page: Page): Promise<void> {
  await page.evaluate(() => {
    const aside = () => document.querySelector<HTMLButtonElement>('[data-testid="qwin-later"]')?.click();
    new MutationObserver(aside).observe(document.body, { childList: true, subtree: true });
    aside();
  });
}

/** The Orchestrator column is always open (ADR 0068): waits until it shows its chat. */
export async function openOrchestrator(page: Page): Promise<void> {
  await expect(page.getByTestId('orchestrator-overlay')).toBeVisible();
  await expect(page.getByTestId('tile-orchestrator')).toBeVisible();
}

/** A fresh profile opens the first-run setup by itself (FirstInterview.tsx): closes it, as a user who skips it would. */
export async function closeSetup(page: Page): Promise<void> {
  const gate = page.getByTestId('first-interview');
  await expect(gate).toBeVisible({ timeout: 15000 });
  await page.keyboard.press('Escape');
  await expect(gate).toBeHidden();
}

/** Opens the strips of these chats in the Grindhouse (collapsed by default: their transcript and input are hidden). */
export async function expandChats(page: Page, ...ids: string[]): Promise<void> {
  for (const id of ids) {
    const toggle = page.getByTestId(`chat-expand-${id}`);
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  }
}

/** Expands the strips and opens their browsers beside them (folded until the strip's globe is pressed: ChatTile.tsx). */
export async function showBrowsers(page: Page, ...ids: string[]): Promise<void> {
  await expandChats(page, ...ids);
  for (const id of ids) {
    const globe = page.getByTestId(`chat-browser-${id}`);
    if ((await globe.getAttribute('aria-pressed')) !== 'true') await globe.click();
    await expect(globe).toHaveAttribute('aria-pressed', 'true');
  }
}

/** Picks `value` in a custom Select (components/Select.tsx: a trigger button and a portalled listbox, no native
 *  <select>, so no selectOption); its value is the trigger's data-value. */
export async function choose(select: Locator, value: string): Promise<void> {
  await select.click();
  const testid = await select.getAttribute('data-testid');
  await select.page().getByTestId(`${testid}-list`).locator(`[role="option"][data-value="${value}"]`).click();
  await expect(select).toHaveAttribute('data-value', value);
}

/** Wait until the browser placeholders on screen show their snapshot (so screenshots show the pages). */
export async function waitThumbs(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => {
    // only the ones in the window: a view scrolled out of it keeps its last snapshot until it comes back
    const ph = [...document.querySelectorAll<HTMLElement>('[data-testid^="browser-view-"], [data-testid^="thumb-"]')].filter(p => {
      const r = p.getBoundingClientRect();
      return r.bottom > 0 && r.top < innerHeight && r.width > 0;
    });
    // a tile's snapshot must be the one taken at the tile's own size (not an earlier one at another size)
    // none on screen (every strip collapsed) is fine too
    return ph.every(p => {
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

/** Opens detail pages whose sidebar entries depend on the user's role (ADR 0068). */
const GO_KEY = { home: 'h', agenti: 'a', task: 'o', dashboard: 'd', fatto: 'f', idee: 'i', costi: 'c', qualita: 'q', regole: 'l', memoria: 'y', classificatori: 'k', collegamenti: 'b', script: 't', log: 'n', confronto: 'm', skill: 's', impostazioni: 'p', guida: 'e', registrazioni: 'v' } as const;
export async function goPage(page: Page, id: keyof typeof GO_KEY): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('g');
  await page.keyboard.press(GO_KEY[id]);
}

/** Opens the roles overview with its shortcut G A: the Grindhouse shows only the strips (ADR 0068) and the sidebar shows
 *  "Agenti" only when the chosen profile lists it; Ctrl+K reaches it too. */
export async function openAgentOverview(page: Page): Promise<void> {
  await page.getByTestId('nav-home').click();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('g');
  await page.keyboard.press('a');
  await expect(page.getByTestId('agent-overview')).toBeVisible();
}

/** Opens one role's page (its editor, versions and progress) from its overview card: a click flips the card (#81),
 *  «Modifica il ruolo» on its back opens the page with the editor already open (#126). */
export async function openAgents(page: Page, role = 'scout'): Promise<void> {
  await openAgentOverview(page);
  await page.getByTestId(`catalog-flip-${role}`).click();
  await page.getByTestId(`catalog-open-${role}`).click();
  await expect(page.getByTestId('agent-studio')).toBeVisible();
}

/** Opens the brain's notes map: the Mappa page (G B) and its "Note del brain" view (ADR 0077; it was a Dashboard tab). */
export async function openNotesMap(page: Page): Promise<void> {
  await goPage(page, 'collegamenti');
  await expect(page.getByTestId('bm-map-page')).toBeVisible();
  await page.getByTestId('bm-map-page').getByRole('button', { name: /^(Note del brain|Brain notes)$/ }).click();
  await expect(page.getByTestId('dash-map')).toBeVisible();
}

/** Runs an action of the top bar's "…" menu (Credenziali: TopBar.tsx MoreButton). */
export async function moreAction(page: Page, item: 'more-credentials'): Promise<void> {
  await page.getByTestId('topbar-more').click();
  await page.getByTestId(item).click();
  await expect(page.getByTestId('topbar-more-pop')).toHaveCount(0);
}

export async function shot(page: Page, name: string): Promise<string> {
  const dir = path.resolve(import.meta.dirname, '..', '..', 'test-results', 'shots');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
  return file;
}

/** The global layer's page (main/overlay.ts: toasts only), once it exists. */
export async function layerPage(app: ElectronApplication): Promise<Page> {
  for (let i = 0; i < 100; i++) {
    const p = app.windows().find(w => w.url().includes('#overlay'));
    if (p) { await p.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' }); return p; }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('layer page not found');
}

export type LayerState = { attached: boolean; bounds: { x: number; y: number; width: number; height: number } | null; toasts: number };
export async function layerState(app: ElectronApplication): Promise<LayerState> {
  return app.evaluate(() => (globalThis as unknown as { __sbOverlay: { state(): LayerState } }).__sbOverlay.state());
}

/** A real Ctrl+W (sendInputEvent: only a real key reaches Electron's default menu, whose "Close" quits the app) on the
 *  app's window or its requests layer, then F13 as a sentinel. Key events go to a page one at a time, each after the
 *  page (and, if unhandled, the window menu) dealt with the one before: once F13 reaches the page, Ctrl+W was fully
 *  handled. A test waits for that, not for time. Returns how many times the main window started closing meanwhile. */
export async function ctrlWHandled(app: ElectronApplication, where: 'window' | 'layer'): Promise<number> {
  return app.evaluate(async ({ BrowserWindow, webContents }, where) => {
    const main = BrowserWindow.getAllWindows().find(x => x.webContents.getURL().startsWith('file:') && !x.webContents.getURL().includes('#overlay'))!;
    const wc = where === 'window' ? main.webContents : webContents.getAllWebContents().find(w => w.getURL().includes('#overlay'))!;
    let closes = 0;
    const closing = () => { closes++; };
    main.on('close', closing);
    await wc.executeJavaScript("void (window.__sbF13 = new Promise(r => addEventListener('keyup', e => { if (e.key === 'F13') r(1); }, true))); 1");
    if (where === 'layer') wc.focus();
    const keys = [['keyDown', 'W', ['control']], ['keyUp', 'W', ['control']], ['keyDown', 'F13', []], ['keyUp', 'F13', []]] as const;
    for (const [type, keyCode, modifiers] of keys) wc.sendInputEvent({ type, keyCode, modifiers: [...modifiers] });
    await wc.executeJavaScript('window.__sbF13');
    main.off('close', closing);
    return closes;
  }, where);
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

/** Closes the questions window by setting every request it shows aside («Rispondi dopo»), e.g. after a test reopened it. */
export async function closeQuestions(page: Page): Promise<void> {
  const win = page.getByTestId('qwin');
  for (let i = 0; i < 20 && await win.count(); i++) await page.getByTestId('qwin-later').click();
  await expect(win).toHaveCount(0);
}
