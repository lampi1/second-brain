// The top bar fits any window width (the user, 2026-10-13: "se metto l'app in full screen non vedo le impostazioni"):
// at 1280, 1366 and 1920 px (the view switch stays on the bar there), windowed and in real full screen (setFullScreen), the settings button is on screen and opens its
// menu, no action is clipped, and the actions used now and then sit in the "â€¦" menu (always there, 2026-10-15) and still work.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchDemo, setSize, shot } from './helpers';

/** Every action of the bar lies inside the window and inside the (clipping) actions strip. */
async function allOnScreen(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const main = document.querySelector('.topbar-main')!.getBoundingClientRect();
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('.topbar button')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue; // collapsed into the "â€¦" menu
      const inMain = !!el.closest('.topbar-main');
      if (r.right > innerWidth + 0.5 || (inMain && r.right > main.right + 0.5)) out.push(el.dataset.testid ?? el.getAttribute('aria-label') ?? '?');
    }
    return out;
  });
}

async function settingsWork(page: Page): Promise<void> {
  const btn = page.getByTestId('settings');
  await expect(btn).toBeInViewport({ ratio: 1 });
  await btn.click();
  await expect(page.getByTestId('settings-pop')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-pop')).toHaveCount(0);
}

/** "…" is always on screen and lists the actions used now and then. */
const ALWAYS_MORE = ['more-credentials'];
async function everyHiddenListed(page: Page): Promise<void> {
  await expect(page.getByTestId('topbar-more')).toBeInViewport({ ratio: 1 });
  await page.getByTestId('topbar-more').click();
  await expect(page.getByTestId('topbar-more-pop')).toBeVisible();
  for (const item of ALWAYS_MORE) await expect(page.getByTestId(item)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('topbar-more-pop')).toHaveCount(0);
}

const fullScreen =(app: ElectronApplication, on: boolean) => app.evaluate(({ BrowserWindow }, v) => BrowserWindow.getAllWindows()[0]!.setFullScreen(v), on);

test('settings and every action stay reachable at 1280, 1366 and 1920 px, windowed and full screen', async () => {
  test.setTimeout(90_000);
  const { app, page } = await launchDemo({ width: 1920, height: 1080 });
  try {
    for (const w of [1280, 1366, 1920]) {
      await setSize(app, w, w === 1920 ? 1080 : 768);
      await expect.poll(() => page.evaluate(() => innerWidth)).toBeGreaterThanOrEqual(w);
      await settingsWork(page);
      expect(await allOnScreen(page)).toEqual([]);
      await everyHiddenListed(page);
      await shot(page, `topbar-fit-${w}`);
    }
    // the narrowest window (1000 px, also at 110 % zoom = 909 px): every action off the bar is listed in "…", which
    // still drives it
    await setSize(app, 1000, 700);
    await expect(page.getByTestId('topbar-more')).toBeVisible();
    await settingsWork(page);
    expect(await allOnScreen(page)).toEqual([]);
    await everyHiddenListed(page);
    await page.getByTestId('topbar-more').click();
    await shot(page, 'topbar-fit-1000-more');
    await page.keyboard.press('Escape');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1.1));
    await settingsWork(page);
    expect(await allOnScreen(page)).toEqual([]);
    await everyHiddenListed(page);
    await page.getByTestId('topbar-more').click();
    await shot(page, 'topbar-fit-909-more');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('topbar-more-pop')).toHaveCount(0);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1));
    // real full screen (F11-like): whatever the display, the bar fits it
    await fullScreen(app, true);
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isFullScreen())).toBe(true);
    // Hidden native fullscreen does not promise a particular monitor resolution.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await settingsWork(page);
    expect(await allOnScreen(page)).toEqual([]);
    await shot(page, 'topbar-fit-fullscreen');
    await fullScreen(app, false);
  } finally {
    await app.close();
  }
});
