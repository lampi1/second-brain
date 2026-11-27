// The Orchestrator's knowledge of the app (ADR 0149), in the real app over the app-control MCP: app_guide reads the
// rail, Memoria's tabs and the Settings sections from the UI as drawn; app_ui "outline" lists what is on screen with
// positions, chat strips by title and state only, and narrows a long page with a filter; a view change from an agent
// (window.__sbSetView, the path app_config "view" takes, and ui:command 'prefs') switches the density; a patch with an
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
  // the rail holds Grindhouse; the other pages sit in the ☰ menu, read as its groups (ADR 0366)
  expect(index).toMatch(/Left rail now: top: Grindhouse \[home, G H\]/);
  expect(index).toMatch(/☰ [^:|]+: [^|]*\[memoria, G Y\]/);
  expect(index).toMatch(/Memoria tabs: /);
  expect(index).toMatch(/\[notifications\]/);
  const topic = await mcp.ok('app_guide', { topic: 'lingua' });
  expect(topic).toContain('(language)');
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
  type Sb = { __sbSetView: (j: string) => { ok: boolean; view: { density: string } }; __sbView: () => { density: string } };
  const refused = await page.evaluate(() => (window as unknown as Sb).__sbSetView(JSON.stringify({ density: 'compact', orchestratorSize: { w: 1, h: 1 } })));
  expect(refused.ok).toBe(false);
  expect(await page.evaluate(() => (window as unknown as Sb).__sbView().density)).toBe('comfortable');
  // no theme any more: the app is dark only (ADR 0366), so the field is refused like any unknown one
  expect((await page.evaluate(() => (window as unknown as Sb).__sbSetView(JSON.stringify({ theme: 'light' })))).ok).toBe(false);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(x => x.webContents.getURL().includes('index.html') && !x.webContents.getURL().includes('#overlay'));
    w?.webContents.send('ui:command', { action: 'prefs', value: JSON.stringify({ density: 'compact' }) });
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as Sb).__sbView().density)).toBe('compact');
  await shot(page, 'app-guide-compact');
  await page.evaluate(() => (window as unknown as Sb).__sbSetView(JSON.stringify({ density: 'comfortable' })));
});
