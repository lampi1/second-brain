// Closing a browser tile like a chat, end to end in the real app (fake Claude CLI, local fixture site):
// - the ✕ in the tile header hides it at once with a 6-second "Annulla" toast; Annulla brings it back; when the toast
//   expires the tab is really closed;
// - the agent that drove it gets "The user closed tab …" at its next call (by id, or without tabId when it was its
//   active tab), naming its open tabs, and never acts silently on another tab; after tabs_select it works again;
// - Ctrl+W on a selected browser tile closes it, and so does Ctrl+W typed inside the page (forwarded by main).
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BrowserTab, ChatSummary } from '../../src/shared/contract';
import { demoLayout, launch, launchDemo, shot, waitThumbs } from './helpers';
import { startSites, McpClient, type Sites } from './fixture-server';

const FAKE = path.resolve(import.meta.dirname, '..', 'fixtures', 'fake-claude.mjs');

let app: ElectronApplication;
let page: Page;
let sites: Sites;
let chat: ChatSummary;
let agent: McpClient;

const tabsOfChat = async (): Promise<BrowserTab[]> => (await page.evaluate(() => window.sb.invoke('browser:list', undefined))).filter(t => t.ownerChatId === chat.id);

test.describe.serial('closing a browser tile', () => {
  test.beforeAll(async () => {
    sites = await startSites();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-claude-'));
    const logFile = path.join(home, 'fake.jsonl');
    ({ app, page } = await launch({ SB_CLAUDE_PATH: FAKE, CLAUDE_CONFIG_DIR: home, FAKE_CLAUDE_LOG: logFile }));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-cwd-'));
    chat = await page.evaluate(dir => window.sb.invoke('chat:create', { harness: 'claude', cwd: dir, prompt: 'ciao', title: 'Prova · Chiudi browser' }), cwd);
    await expect.poll(async () => (await page.evaluate(() => window.sb.invoke('chat:list', undefined)))[0]?.state, { timeout: 20_000 }).toBe('idle');
    const start = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as { argv?: string[] }).find(l => l.argv?.includes('--mcp-config'))!;
    const cfg = JSON.parse(start.argv![start.argv!.indexOf('--mcp-config') + 1]!) as { mcpServers: Record<string, { url: string }> };
    agent = new McpClient(cfg.mcpServers['second-brain']!.url);
    await agent.init();
  });

  test.afterAll(async () => {
    await app?.close();
    await sites?.close();
  });

  test('✕ hides the tile with Annulla; the agent then gets a clear error on that tab, never another tab', async () => {
    await agent.ok('tabs_create', { url: `${sites.a}/` });
    await agent.ok('tabs_create', { url: `${sites.a}/app` });
    await expect.poll(async () => (await tabsOfChat()).length).toBe(2);
    const [first, second] = await tabsOfChat();
    await agent.ok('tabs_select', { tabId: first!.id });             // the tab the user will close is the agent's active one

    const tile = page.getByTestId(`tile-browser-${first!.id}`);
    await expect(tile).toBeVisible();
    await expect(page.getByTestId(`browser-x-${first!.id}`)).toHaveAttribute('aria-label', /Chiudi scheda/);
    await shot(page, 'browser-close-before');
    await page.getByTestId(`browser-x-${first!.id}`).click();
    await expect(tile).toBeHidden();
    const toast = page.getByTestId('toast').filter({ hasText: 'Chiusa la scheda' });
    await expect(toast).toBeVisible();
    await shot(page, 'browser-close-toast');
    await toast.getByTestId('toast-action').click();
    await expect(tile).toBeVisible();
    expect((await tabsOfChat()).map(t => t.id)).toContain(first!.id);  // Annulla: the tab was never closed

    await page.waitForTimeout(600);                                     // past the ✕ double-click guard
    await page.getByTestId(`browser-x-${first!.id}`).click();
    await expect(tile).toBeHidden();
    await expect.poll(async () => (await tabsOfChat()).map(t => t.id), { timeout: 10_000 }).toEqual([second!.id]);
    await shot(page, 'browser-close-after');

    const noId = await agent.call('get_page_text');
    expect(noId.isError).toBe(true);
    expect(noId.text).toContain(`The user closed tab ${first!.id}`);
    expect(noId.text).toContain(`Your open tabs: ${second!.id}`);
    const byId = await agent.call('get_page_text', { tabId: first!.id });
    expect(byId.isError).toBe(true);
    expect(byId.text).toContain(`The user closed tab ${first!.id}`);
    const nav = await agent.call('navigate', { url: `${sites.a}/` });  // never reopens the closed page by itself
    expect(nav.isError).toBe(true);
    expect(nav.text).toContain(`The user closed tab ${first!.id}`);
    expect((await tabsOfChat()).length).toBe(1);
    await agent.ok('tabs_select', { tabId: second!.id });
    expect(await agent.ok('get_page_text')).not.toContain('The user closed');
  });

  test('Ctrl+W on a selected browser tile closes it; Ctrl+W inside the page too', async () => {
    const [only] = await tabsOfChat();
    await page.getByTestId(`browser-url-${only!.id}`).locator('xpath=ancestor::header').click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('Control+w');
    await expect(page.getByTestId(`tile-browser-${only!.id}`)).toBeHidden();
    await page.getByTestId('toast').filter({ hasText: 'Chiusa la scheda' }).getByTestId('toast-action').click();
    await expect(page.getByTestId(`tile-browser-${only!.id}`)).toBeVisible();

    // an agent's own Ctrl+W (CDP input) never closes its tab as if the user did
    await agent.ok('key', { keys: 'ctrl+w' });
    await page.waitForTimeout(800);
    await expect(page.getByTestId(`tile-browser-${only!.id}`)).toBeVisible();

    // the keyboard inside the page (a native view the UI cannot see): main forwards the user's Ctrl+W to the UI
    const sent = await app.evaluate(({ webContents }, url) => {
      const wc = webContents.getAllWebContents().find(w => w.getURL() === url);
      wc?.sendInputEvent({ type: 'keyDown', keyCode: 'W', modifiers: ['control'] });
      return !!wc;
    }, only!.url);
    expect(sent).toBe(true);
    await expect(page.getByTestId(`tile-browser-${only!.id}`)).toBeHidden();
    await expect.poll(async () => (await tabsOfChat()).length, { timeout: 10_000 }).toBe(0);
    const r = await agent.call('get_page_text');
    expect(r.isError).toBe(true);
    expect(r.text).toContain(`The user closed tab ${only!.id}`);
    expect(r.text).toContain('You have no open tab now: call tabs_create');
  });
});

// the demo (fake chats and tabs, frozen clock): the ✕ sits at the right end of the browser tile's header, as on a chat
// tile; once closed the native view leaves the layout, so no page stays drawn over the grid
test('demo: the ✕ closes a browser tile and its native view leaves the layout', async () => {
  const { app: demo, page: p } = await launchDemo();
  try {
    await waitThumbs(p);
    const tile = p.locator('[data-testid^="tile-browser-"]').first();
    const tabId = (await tile.getAttribute('data-tab-id'))!;
    await expect.poll(async () => (await demoLayout(demo)).find(v => v.tabId === tabId)?.rect ?? null).not.toBeNull();
    await shot(p, 'browser-close-demo-before');
    await p.getByTestId(`browser-x-${tabId}`).click();
    await expect(p.getByTestId(`tile-browser-${tabId}`)).toHaveCount(0);
    await expect.poll(async () => (await demoLayout(demo)).find(v => v.tabId === tabId)?.rect ?? null).toBeNull();
    await shot(p, 'browser-close-demo-after');
    await expect.poll(async () => (await p.evaluate(() => window.sb.invoke('browser:list', undefined))).some(t => t.id === tabId), { timeout: 10_000 }).toBe(false);
  } finally { await demo.close(); }
});
