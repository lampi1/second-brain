// End to end: Codex as the third chat engine (ADR 0060). The real app with SB_CODEX_PATH = the fake app-server
// (test/fixtures/fake-codex-app-server.mjs, run with Electron as Node): on a profile where the user had turned Codex
// off, they turn it on again in Impostazioni → Account e strumenti (the brain's rules per launch, ADR 0060, keep their
// values with no switch on the page), then a Codex chat answers a turn and asks one command approval that the user
// allows. No real CLI, no tokens.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatItem, ChatSummary, PendingRequest } from '../../src/shared/contract';
import { closeSetup, expandChats, launch, shot } from './helpers';

const FAKE = path.resolve(import.meta.dirname, '..', 'fixtures', 'fake-codex-app-server.mjs');

test('Codex: turned on by the user, a chat answers a turn and asks a command approval', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-codex-cwd-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-'));
  // Codex is on by default on a fresh install; this user had switched it off
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ engineOn: { codex: false } }));
  const { app, page } = await launch({ SB_CODEX_PATH: FAKE, FAKE_CODEX_DELAY: '5' }, userData);
  try {
    await closeSetup(page);
    const get = () => page.evaluate(() => window.sb.invoke('settings:get', undefined));
    expect((await get()).engineOn.codex).toBe(false);
    // only the user's click turns it on
    await page.getByTestId('settings').click();
    await page.getByTestId('settings-all').click();
    const codex = page.getByTestId('settings-page').getByTestId('st-tool-codex');
    await codex.scrollIntoViewIfNeeded();
    await expect(codex.locator('.st-state')).toHaveText('Disattivato');
    await codex.getByRole('button', { name: 'Configura', exact: true }).click();
    await codex.getByRole('button', { name: 'Attiva', exact: true }).click();
    await expect.poll(async () => (await get()).engineOn.codex).toBe(true);
    // the brain's rules per launch (ADR 0060): on for Codex, off for Claude, no longer switched from this page
    await expect(page.locator('[data-testid^="st-rules-"]')).toHaveCount(0);
    expect(await get()).toMatchObject({ launchRulesCodex: true, launchRulesClaude: false });
    await page.getByTestId('nav-home').click();

    const chat: ChatSummary = await page.evaluate(dir => window.sb.invoke('chat:create', { harness: 'codex', cwd: dir, prompt: 'ciao', title: 'Codex E2E' }), cwd);
    expect(chat).toMatchObject({ harness: 'codex', title: 'Codex E2E' });
    await expandChats(page, chat.id); // its strip, open: the requests show under it
    const items = (): Promise<ChatItem[]> => page.evaluate(id => window.sb.invoke('chat:items', { chatId: id }), chat.id);
    await expect.poll(async () => (await items()).some(i => i.kind === 'assistant' && i.text === 'Ciao da Codex'), { timeout: 30_000 }).toBe(true);
    await expect.poll(async () => (await page.evaluate(() => window.sb.invoke('chat:list', undefined))).find(c => c.id === chat.id)?.state, { timeout: 30_000 }).toBe('idle');

    // a command approval becomes a permission panel; the user's yes runs it
    await page.evaluate(id => window.sb.invoke('chat:send', { chatId: id, text: 'perm' }), chat.id);
    await expect.poll(async () => (await page.evaluate(() => window.sb.invoke('chat:pending', undefined))).filter(p => p.chatId === chat.id).length, { timeout: 30_000 }).toBe(1);
    const pending: PendingRequest[] = await page.evaluate(() => window.sb.invoke('chat:pending', undefined));
    const p = pending.find(x => x.chatId === chat.id)!;
    expect(p.type).toBe('permission');
    await shot(page, 'codex-permission');
    await page.evaluate(([id, rid]) => window.sb.invoke('chat:answer', { chatId: id, requestId: rid, answer: { kind: 'permission', allow: true } }), [chat.id, p.id] as const);
    await expect.poll(async () => (await items()).some(i => i.kind === 'assistant' && /Comando eseguito/.test(i.text)), { timeout: 30_000 }).toBe(true);
    await shot(page, 'codex-chat');

    // MCP confirmations use the same visible panel, with arguments and no persistent consent option.
    await page.evaluate(id => window.sb.invoke('chat:send', { chatId: id, text: 'elicitation' }), chat.id);
    await expect.poll(async () => (await page.evaluate(() => window.sb.invoke('chat:pending', undefined))).find(p => p.chatId === chat.id)?.noAlways, { timeout: 30_000 }).toBe(true);
    const mcp = (await page.evaluate(() => window.sb.invoke('chat:pending', undefined))).find(p => p.chatId === chat.id)!;
    expect(mcp.tool).toBe('mcp__second_brain_app__app_chats');
    expect(mcp.detail).toContain('Intervallo: 2h');
    const panel = page.getByTestId(`request-${chat.id}-${mcp.id}`);
    await expect(panel.getByTestId(`request-${chat.id}-${mcp.id}-explain`)).toHaveText('second brain app: app chats');
    await panel.getByTestId(`request-${chat.id}-${mcp.id}-raw-toggle`).click();
    await expect(panel.getByTestId(`request-${chat.id}-${mcp.id}-raw`)).toContainText(mcp.title);
    await expect(panel.getByTestId(`request-${chat.id}-${mcp.id}-raw`)).toContainText('Intervallo: 2h');
    await shot(page, 'codex-mcp-confirmation');
    await page.evaluate(([id, rid]) => window.sb.invoke('chat:answer', { chatId: id, requestId: rid, answer: { kind: 'permission', allow: false } }), [chat.id, mcp.id] as const);
    await expect.poll(async () => (await items()).some(i => i.kind === 'assistant' && i.text === 'MCP: decline'), { timeout: 30_000 }).toBe(true);
  } finally {
    await app.close();
  }
});
