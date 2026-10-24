// The Orchestrator's knowledge of the app (ADR 0149), in the real app over the app-control MCP: app_guide reads the
// rail, Memoria's tabs and the Settings sections from the UI as drawn; app_ui "outline" lists what is on screen with
// positions, chat strips by title and state only, and narrows a long page with a filter; a view change from an agent
// (window.__sbSetView, the path app_config "view" takes, and ui:command 'prefs') switches the theme; a patch with an
// unknown field changes nothing.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchDemo, shot } from './helpers';
import { McpClient } from './fixture-server';

let app: ElectronApplication, page: Page, mcp: McpClient;
test.beforeAll(async () => {
  ({ app, page } = await launchDemo());
  const info = await page.evaluate(() => window.sb.invoke('app:info', undefined));
  mcp = new McpClient(info.mcpUrl.replace(/\/mcp$/, '/mcp/app'));
  await mcp.init();
});
test.afterAll(async () => { await app?.close(); });

test('app_guide: the rail, Memoria tabs and Settings sections as the UI draws them', async () => {
  const index = await mcp.ok('app_guide');
  expect(index).toMatch(/Left rail now: .*\[memoria, G Y\]/);
  expect(index).toMatch(/Memoria tabs: /);
  expect(index).toMatch(/\[notifications\]/);
  const topic = await mcp.ok('app_guide', { topic: 'tema' });
  expect(topic).toContain('(theme)');
});

test('outline: controls with positions, chat strips by title only, a filter for one section', async () => {
  const home = await mcp.ok('app_ui', { action: 'outline' });
  expect(home).toMatch(/^page: home/);
  expect(home).toMatch(/chat strip «.+» \[\w+\]/);
  expect(home).toMatch(/button «.+» .*\(\d+,\d+ \d+×\d+\)/);
  await mcp.ok('app_ui', { action: 'page', value: 'impostazioni/notifications' });
  await expect(page.getByTestId('settings-page')).toBeVisible();
  const only = await mcp.ok('app_ui', { action: 'outline', value: 'notifiche notifications' });
  expect(only).toMatch(/^page: impostazioni/);
  expect(only.split('\n').length).toBeLessThan(60);
  await shot(page, 'app-guide-settings');
});

test('a view change from an agent applies valid fields only', async () => {
  type Sb = { __sbSetView: (j: string) => { ok: boolean; view: { theme: string } }; __sbView: () => { theme: string } };
  const refused = await page.evaluate(() => (window as unknown as Sb).__sbSetView(JSON.stringify({ theme: 'light', orchestratorSize: { w: 1, h: 1 } })));
  expect(refused.ok).toBe(false);
  expect(await page.evaluate(() => (window as unknown as Sb).__sbView().theme)).toBe('dark');
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(x => x.webContents.getURL().includes('index.html') && !x.webContents.getURL().includes('#overlay'));
    w?.webContents.send('ui:command', { action: 'prefs', value: JSON.stringify({ theme: 'light' }) });
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as Sb).__sbView().theme)).toBe('light');
  await shot(page, 'app-guide-light');
});
