// E2E of the cold-start queue (main/chats/admission.ts, ADR 0221) with the fake Claude engine and a forced load
// (SB_LOAD_FORCE="99,40": CPU 99%, RAM 40% free, over the 95% emergency brake). A chat whose turn the last quit cut
// resumes by itself (the app's own message, not the user's): with the brake on that resume waits, its tile
// (ChatTile.tsx) shows "In coda · CPU 99%"
// and "Avvia ora", the top bar (TopBar.tsx) counts it; "Avvia ora" starts it at once. Its three settings are technical
// (docs/settings-surface.md): not on the Impostazioni page (SettingsPage.tsx), kept at their values. A work chat waits ahead of a chat on the app that was queued first (the user,
// 2026-10-14). Screenshots: test-results/shots/admission-1-queued.png, -2-started.png, -3-settings.png, -4-work-first.png,
// -5-slots-full.png (SB_COLD_SLOTS=1 on a calm machine: the second resume waits for the first one's slot).
import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatItem } from '../../src/shared/contract';
import { launch, setSize, shot } from './helpers';

const FIX = path.resolve(import.meta.dirname, '..', 'fixtures');

test('a resume after a restart waits while the machine is busy; "Avvia ora" starts it', async () => {
  const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
  const userData = tmp('sb-e2e-');
  const cwd = tmp('sb-e2e-cwd-');
  const id = 'c_queued0001';
  // a chat whose turn was running when the app stopped: the next start resumes it by itself
  fs.writeFileSync(path.join(userData, 'chats.json'), JSON.stringify({ version: 2, chats: [{
    id, harness: 'claude', cwd, sessionId: crypto.randomUUID(), title: 'Lavoro interrotto', model: null, effort: null, permissionMode: null,
    isOrchestrator: false, createdAt: Date.now() - 60_000, working: true,
  }] }));
  const { app, page } = await launch({
    SB_CLAUDE_PATH: path.join(FIX, 'fake-claude.mjs'), CLAUDE_CONFIG_DIR: tmp('sb-e2e-claude-'), SB_LOAD_FORCE: '99,40',
  }, userData);
  await setSize(app, 1400, 900);

  const bar = page.getByTestId(`chat-queued-${id}`);
  await expect(bar).toBeVisible({ timeout: 15000 });
  await expect(bar).toContainText('In coda · CPU 99% · la prossima');
  await expect(page.getByTestId('topbar-queue')).toContainText('1');
  await expect(page.getByTestId(`chat-state-${id}`)).toHaveText('in coda'); // never "finito"
  const users = async () => ((await page.evaluate(c => window.sb.invoke('chat:items', { chatId: c }), id)) as ChatItem[]).filter(i => i.kind === 'user');
  expect(await users()).toEqual([]); // nothing sent: the resume waits
  await page.mouse.move(2, 2);
  await shot(page, 'admission-1-queued');

  await page.getByTestId(`chat-admit-${id}`).click();
  await expect(bar).toHaveCount(0);
  await expect(page.getByTestId('topbar-queue')).toHaveCount(0);
  await expect.poll(async () => (await users()).length, { timeout: 15000 }).toBe(1);
  await expect(page.getByTestId(`chat-state-${id}`)).toHaveAttribute('data-state', 'idle', { timeout: 15000 });
  await shot(page, 'admission-2-started');

  await page.keyboard.press('Control+,');
  await expect(page.getByTestId('settings-page')).toBeVisible();
  await expect(page.locator('[data-testid^="st-load-queue"]')).toHaveCount(0);
  expect(await page.evaluate(async () => window.sb.invoke('settings:get', undefined))).toMatchObject({ loadQueue: true, loadQueueCpu: 95, loadQueueRam: 10 });
  await shot(page, 'admission-3-settings');
  await app.close();
});

test("a work chat's resume waits ahead of a chat on the app queued before it", async () => {
  const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
  const userData = tmp('sb-e2e-');
  const cwd = tmp('sb-e2e-cwd-');
  const cut = (id: string, title: string) => ({
    id, harness: 'claude', cwd, sessionId: crypto.randomUUID(), title, model: null, effort: null, permissionMode: null,
    isOrchestrator: false, createdAt: Date.now() - 60_000, working: true,
  });
  // the app's chat comes first in the file, so its resume asks the queue first
  fs.writeFileSync(path.join(userData, 'chats.json'), JSON.stringify({ version: 2, chats: [cut('c_appchat01', 'App · coda'), cut('c_workchat1', 'Shop · sprint')] }));
  const { app, page } = await launch({
    SB_CLAUDE_PATH: path.join(FIX, 'fake-claude.mjs'), CLAUDE_CONFIG_DIR: tmp('sb-e2e-claude-'), SB_LOAD_FORCE: '99,40',
  }, userData);
  await setSize(app, 1400, 900);
  await expect(page.getByTestId('chat-queued-c_workchat1')).toContainText('la prossima', { timeout: 15000 });
  await expect(page.getByTestId('chat-queued-c_appchat01')).toContainText('2ª in fila');
  await expect(page.getByTestId('topbar-queue')).toContainText('2');
  await page.mouse.move(2, 2);
  await shot(page, 'admission-4-work-first');
  await app.close();
});

test('on a calm machine a cold start waits only for a free slot (SB_COLD_SLOTS=1)', async () => {
  const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
  const userData = tmp('sb-e2e-');
  const cwd = tmp('sb-e2e-cwd-');
  const cut = (id: string, title: string) => ({
    id, harness: 'claude', cwd, sessionId: crypto.randomUUID(), title, model: null, effort: null, permissionMode: null,
    isOrchestrator: false, createdAt: Date.now() - 60_000, working: true,
  });
  fs.writeFileSync(path.join(userData, 'chats.json'), JSON.stringify({ version: 2, chats: [cut('c_slotfirst', 'Shop · primo'), cut('c_slotsecnd', 'Shop · secondo')] }));
  // the first engine never answers its start-up, so it keeps its one slot; the load is under the brake
  const { app, page } = await launch({
    SB_CLAUDE_PATH: path.join(FIX, 'fake-claude.mjs'), CLAUDE_CONFIG_DIR: tmp('sb-e2e-claude-'), SB_LOAD_FORCE: '50,40',
    SB_COLD_SLOTS: '1', FAKE_CLAUDE_INIT_DELAY: '600000',
  }, userData);
  await setSize(app, 1400, 900);
  const bar = page.getByTestId('chat-queued-c_slotsecnd');
  await expect(bar).toContainText('In coda · 1/1 avvii a freddo pieni · la prossima', { timeout: 15000 });
  await expect(page.getByTestId('chat-queued-c_slotfirst')).toHaveCount(0);
  await page.mouse.move(2, 2);
  await shot(page, 'admission-5-slots-full');
  await app.close();
});
