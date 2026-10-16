// End to end: Codex as the third chat engine (ADR 0060). The real app with SB_CODEX_PATH = the fake app-server
// (test/fixtures/fake-codex-app-server.mjs, run with Electron as Node): the user turns Codex on in Impostazioni →
// Motori, then a Codex chat answers a turn and asks one command approval that the user allows. No real CLI, no tokens.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatItem, ChatSummary, PendingRequest } from '../../src/shared/contract';
import { launch, shot } from './helpers';

const FAKE = path.resolve(import.meta.dirname, '..', 'fixtures', 'fake-codex-app-server.mjs');

test('Codex: turned on by the user, a chat answers a turn and asks a command approval', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-codex-cwd-'));
  const { app, page } = await launch({ SB_CODEX_PATH: FAKE, FAKE_CODEX_DELAY: '5' });
  try {
    // Codex ships off: only the user's click turns it on
    await page.getByTestId('settings').click();
    await page.getByTestId('settings-all').click();
    const eng = page.getByTestId('settings-page').getByTestId('st-group-engines');
    await eng.scrollIntoViewIfNeeded();
    const on = eng.getByTestId('st-engine-on-codex-switch');
    await expect(on).toHaveAttribute('aria-checked', 'false');
    await on.click();
    await expect.poll(async () => (await page.evaluate(() => window.sb.invoke('settings:get', undefined))).engineOn.codex).toBe(true);
    // the brain's rules per launch (ADR 0060): on for Codex, off for Claude, and the user can switch them
    await expect(eng.getByTestId('st-rules-codex-switch')).toHaveAttribute('aria-checked', 'true');
    const rulesClaude = eng.getByTestId('st-rules-claude-switch');
    await expect(rulesClaude).toHaveAttribute('aria-checked', 'false');
    await rulesClaude.click();
    await expect.poll(async () => (await page.evaluate(() => window.sb.invoke('settings:get', undefined))).launchRulesClaude).toBe(true);
    await rulesClaude.click();
    await expect.poll(async () => (await page.evaluate(() => window.sb.invoke('settings:get', undefined))).launchRulesClaude).toBe(false);
    await page.keyboard.press('Escape');

    const chat: ChatSummary = await page.evaluate(dir => window.sb.invoke('chat:create', { harness: 'codex', cwd: dir, prompt: 'ciao', title: 'Codex E2E' }), cwd);
    expect(chat).toMatchObject({ harness: 'codex', title: 'Codex E2E' });
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
  } finally {
    await app.close();
  }
});
