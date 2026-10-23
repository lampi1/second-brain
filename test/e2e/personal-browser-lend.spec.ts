// «Affida a un agente» (ADR 0133), end to end: the real app with the fake Claude CLI and a local fixture site. The user
// gives one personal tab to a chat: the chat's own MCP endpoint lists and reads it, the Browser page shows who has it;
// «Riprendi» brings the same page back (alive, same address) and the agent's tools no longer reach it.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatSummary } from '@shared/contract';
import { closeSetup, keepQuestionsAside, launch, shot } from './helpers';
import { startSites, McpClient, type Sites } from './fixture-server';

const FAKE = path.resolve(import.meta.dirname, '..', 'fixtures', 'fake-claude.mjs');
let app: ElectronApplication;
let page: Page;
let sites: Sites;
let chat: ChatSummary;
let agent: McpClient;
let logFile: string;

const personalViews = () => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:'));
  return (win?.contentView.children ?? []).flatMap(v => { const wc = (v as { webContents?: Electron.WebContents }).webContents; return wc && wc.session.getStoragePath()?.includes('personal') ? [wc.getURL()] : []; });
});

test.describe.serial('personal browser: a tab given to an agent', () => {
  test.beforeAll(async () => {
    sites = await startSites();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-claude-'));
    logFile = path.join(home, 'fake.jsonl');
    ({ app, page } = await launch({ SB_CLAUDE_PATH: FAKE, CLAUDE_CONFIG_DIR: home, FAKE_CLAUDE_LOG: logFile }));
    await closeSetup(page).catch(() => {});
    await keepQuestionsAside(page);                                 // the fake CLI asks a question on each turn
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-cwd-'));
    chat = await page.evaluate(dir => window.sb.invoke('chat:create', { harness: 'claude', cwd: dir, prompt: 'ciao', title: 'Prova · Browser personale' }), cwd);
    await expect.poll(async () => (await page.evaluate(() => window.sb.invoke('chat:list', undefined))).find(c => c.id === chat.id)?.state, { timeout: 20_000 }).toBe('idle');
    const start = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as { argv?: string[] }).find(l => l.argv?.includes('--mcp-config'))!;
    const cfg = JSON.parse(start.argv![start.argv!.indexOf('--mcp-config') + 1]!) as { mcpServers: Record<string, { url: string }> };
    agent = new McpClient(cfg.mcpServers['second-brain']!.url);
    await agent.init();
  });
  test.afterAll(async () => { await app?.close(); await sites?.close(); });

  test('before: the agent sees none of the personal tabs', async () => {
    await page.getByTestId('nav-browser').click();
    await page.getByTestId('pb-start-search').fill(`${sites.a}/index.html`);
    await page.getByTestId('pb-start-search').press('Enter');
    await expect.poll(personalViews).toEqual([`${sites.a}/index.html`]);
    expect(await agent.ok('tabs_list')).not.toContain(sites.a);
  });

  test('«Affida a un agente» gives the tab to the chat, which is told', async () => {
    await page.getByTestId('pb-lend').click();
    await expect(page.getByTestId('pb-lendbar')).toBeVisible();
    await shot(page, 'personal-browser-lend');
    await page.getByTestId(`pb-lend-chat-${chat.id}`).click();
    await page.getByTestId('pb-lend-note').fill('Leggi il titolo');
    await page.getByTestId('pb-lend-go').click();
    await expect(page.getByTestId('pb-lent')).toBeVisible();
    await expect(page.getByTestId('pb-lent')).toContainText('Prova · Browser personale');
    await expect.poll(personalViews).toEqual([]);                  // drawn under the agent's strip now, not here
    await expect.poll(() => agent.ok('tabs_list')).toContain(`${sites.a}/index.html`);
    expect(await agent.ok('read_page')).toContain('Fixture QA');
    await expect.poll(async () => JSON.stringify(await page.evaluate(id => window.sb.invoke('chat:items', { chatId: id }), chat.id)), { timeout: 20_000 }).toContain('personal browser');
    await shot(page, 'personal-browser-lent');
    // a tab the agent opens from it is signed in as the user too: it goes when the user takes the tab back
    await agent.ok('javascript', { code: `window.open(${JSON.stringify(`${sites.a}/index.html?popup=1`)}); 'ok'` });
    await expect.poll(() => agent.ok('tabs_list')).toContain('popup=1');
  });

  test('«Riprendi» brings the same page back; the agent no longer reaches it', async () => {
    await page.getByTestId('pb-reclaim').click();
    await expect(page.getByTestId('pb-lent')).toBeHidden();
    await expect.poll(personalViews).toEqual([`${sites.a}/index.html`]);
    await expect.poll(() => agent.ok('tabs_list')).not.toContain(sites.a);   // its popup closed too
    await expect(page.getByTestId('pb-back')).toBeVisible();
  });
});
