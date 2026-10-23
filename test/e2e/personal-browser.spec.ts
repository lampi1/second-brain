// The personal Browser page (ADR 0133), end to end on the real app and a local fixture site: the start page, a tab
// opened from its search, back/forward, a bookmark and the bookmarks bar, a saved session reopened, the history, the
// key button lighting up on a sign-in page, and the privacy line: an agent's MCP endpoint never lists the personal
// tab, app_screenshot withholds the window while the page is on screen, and the tabs come back after a restart.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { closeSetup, launch, shot } from './helpers';
import { startSites, McpClient, type Sites } from './fixture-server';
import { PERSONAL_WORLD, fillScript, readScript } from '../../src/main/personal/page';

let app: ElectronApplication;
let page: Page;
let userData: string;
let sites: Sites;

/** The personal views main has put in the window, with their address. */
const shownViews = () => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:'));
  return (win?.contentView.children ?? []).flatMap(v => { const wc = (v as { webContents?: Electron.WebContents }).webContents; return wc && wc.session.getStoragePath()?.includes('personal') ? [wc.getURL()] : []; });
});

test.describe.serial('personal browser', () => {
  test.beforeAll(async () => {
    sites = await startSites();
    ({ app, page, userData } = await launch());
    await closeSetup(page);
  });
  test.afterAll(async () => { await app?.close(); await sites?.close(); });

  test('opens from the rail on its start page', async () => {
    await page.getByTestId('nav-browser').click();
    await expect(page.getByTestId('personal-browser')).toBeVisible();
    await expect(page.getByTestId('pb-start')).toBeVisible();
    await expect(page.getByTestId('pb-private')).toBeVisible();
    await shot(page, 'personal-browser-start');
  });

  test('a search box address opens a tab with the page drawn in the window', async () => {
    await page.getByTestId('pb-start-search').fill(`${sites.a}/index.html`);
    await page.getByTestId('pb-start-search').press('Enter');
    await expect(page.locator('[data-testid^="pb-tab-p"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="pb-view-"]')).toBeVisible();
    await expect.poll(shownViews).toEqual([`${sites.a}/index.html`]);
    await expect(page.getByTestId('pb-address')).toHaveValue(`${sites.a}/index.html`);
  });

  test('the star saves a bookmark, shown in the bar', async () => {
    await page.getByTestId('pb-star').click();
    await expect(page.getByTestId('pb-marks')).toBeVisible();
    await expect(page.getByTestId('pb-star')).toHaveClass(/pb-on/);
  });

  test('a sign-in page lights the key; back and forward work', async () => {
    await page.getByTestId('pb-address').fill(`${sites.a}/login`);
    await page.getByTestId('pb-address').press('Enter');
    await expect(page.getByTestId('pb-key')).toHaveClass(/pb-hint/);
    await expect.poll(shownViews).toEqual([`${sites.a}/login`]);   // the suggestions closed: the page is back on screen
    // the fill and read scripts on a real form, in their isolated world: the page sees the values, never the scripts
    const run = (code: string, world: number) => app.evaluate(({ webContents }, a) => {
      const wc = webContents.getAllWebContents().find(w => w.session.getStoragePath()?.includes('personal') && w.getURL().endsWith('/login'))!;
      return a.world ? wc.executeJavaScriptInIsolatedWorld(a.world, [{ code: a.code }]) : wc.executeJavaScript(a.code);
    }, { code, world });
    expect(await run(fillScript('user-at-example', 'pa"ss'), PERSONAL_WORLD)).toBe('both');
    expect(await run('[user.value, pass.value, typeof userBefore]', 0)).toEqual(['user-at-example', 'pa"ss', 'undefined']);
    expect(await run(readScript(), PERSONAL_WORLD)).toEqual({ user: 'user-at-example', password: 'pa"ss' });
    await expect(page.getByTestId('pb-back')).toBeEnabled();
    await page.getByTestId('pb-back').click();
    await expect(page.getByTestId('pb-address')).toHaveValue(`${sites.a}/index.html`);
    await expect(page.getByTestId('pb-forward')).toBeEnabled();
  });

  test('the panel saves a session and lists the history', async () => {
    await page.getByTestId('pb-panel').click();
    await expect(page.getByTestId('pb-side')).toBeVisible();
    await page.getByTestId('pb-side-sessions').click();
    await page.getByTestId('pb-session-name').fill('Lavoro');
    await page.getByTestId('pb-session-save').click();
    await expect(page.locator('[data-testid^="pb-session-s-"]')).toHaveCount(1);
    await page.getByTestId('pb-side-history').click();
    await expect(page.getByTestId('pb-side')).toContainText('Accesso');
    await page.getByTestId('pb-side-logins').click();
    await expect(page.getByTestId('pb-side')).toBeVisible();
    await shot(page, 'personal-browser-panel');
  });

  test('agents never see the personal tab nor its screenshot', async () => {
    const info = await page.evaluate(() => window.sb.invoke('app:info', undefined));
    const agent = new McpClient(info.mcpUrl);
    await agent.init();
    const list = await agent.ok('tabs_list');
    expect(list).not.toContain(sites.a);
    const appMcp = new McpClient(info.mcpUrl.replace(/\/mcp$/, '/mcp/app'));
    await appMcp.init();
    const shotText = await appMcp.ok('app_screenshot');
    expect(shotText).toContain('private');
    // the agents' own tabs list nothing of the user's browser either
    const tabs = await page.evaluate(() => window.sb.invoke('browser:list', undefined));
    expect(tabs.map(t => t.url)).not.toContain(`${sites.a}/index.html`);
  });

  test('another page takes the view out of the window; a new tab shows the start page', async () => {
    await page.getByTestId('nav-home').click();
    await expect.poll(shownViews).toEqual([]);
    await page.getByTestId('nav-browser').click();
    await expect.poll(shownViews).toHaveLength(1);
    await page.getByTestId('pb-new-tab').click();
    await expect(page.getByTestId('pb-start')).toBeVisible();
    await expect.poll(shownViews).toEqual([]);
  });

  test('after a restart the last tabs are offered again', async () => {
    await app.close();
    ({ app, page } = await launch({}, userData));
    await closeSetup(page);
    await page.getByTestId('nav-browser').click();
    await expect(page.getByTestId('pb-restore')).toBeVisible();
    await page.getByTestId('pb-restore').click();
    await expect(page.locator('[data-testid^="pb-tab-p"]')).toHaveCount(1);
    await expect(page.getByTestId('pb-marks')).toBeVisible();
  });
});
