// End to end: "Invia subito" on a queued message, with the real chat UI and the fake engines (Claude stream-json,
// Cursor ACP). A long turn runs, two messages wait in the queue, the second one is sent now: the turn is interrupted,
// that message runs next, the other one follows; every message reaches the engine exactly once, in that order.
// Screenshots: test-results/shots/send-now-<engine>-queue.png (the chips) and -done.png (after both turns). Also Enter
// again on an empty input = "Invia subito" on the last queued message (send-now-double-enter-queue.png).
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatItem, ChatSummary } from '../../src/shared/contract';
import { launch, setSize, shot } from './helpers';

const FIX = path.resolve(import.meta.dirname, '..', 'fixtures');

for (const engine of ['claude', 'cursor'] as const) {
  test(`${engine}: "Invia subito" interrupts the turn, sends that message, then the rest of the queue in order`, async () => {
    const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
    const cwd = tmp('sb-e2e-cwd-');
    const fakes = {
      SB_CLAUDE_PATH: path.join(FIX, 'fake-claude.mjs'), CLAUDE_CONFIG_DIR: tmp('sb-e2e-claude-'), FAKE_CLAUDE_DELAY: '60',
      SB_CURSOR_PATH: path.join(FIX, 'fake-cursor-acp.mjs'), FAKE_CURSOR_DELAY: '60', CURSOR_CONFIG_DIR: tmp('sb-e2e-cursor-user-'),
    };
    const { app, page } = await launch(fakes);
    await setSize(app, 1400, 900);
    const chat: ChatSummary = await page.evaluate(([h, dir]) => window.sb.invoke('chat:create', { harness: h, cwd: dir, prompt: 'slow', title: 'Coda' }), [engine, cwd] as const);
    const input = page.getByTestId(`chat-input-${chat.id}`);
    await expect(page.getByTestId(`chat-state-${chat.id}`)).toHaveAttribute('data-state', 'running', { timeout: 15000 });

    await input.fill('primo in coda');
    await input.press('Enter');
    await input.fill('secondo, mandalo subito');
    await input.press('Enter');
    await expect(page.getByTestId(`chat-input-${chat.id}-queued-0`)).toContainText('primo in coda');
    await expect(page.getByTestId(`chat-input-${chat.id}-queued-1`)).toContainText('secondo, mandalo subito');
    await expect(page.getByTestId(`chat-input-${chat.id}-sendnow-1`)).toBeVisible();
    await page.getByTestId(`chat-input-${chat.id}-sendnow-1`).hover();
    await shot(page, `send-now-${engine}-queue`);

    await page.getByTestId(`chat-input-${chat.id}-sendnow-1`).click();
    const users = async () => ((await page.evaluate(id => window.sb.invoke('chat:items', { chatId: id }), chat.id)) as ChatItem[])
      .filter(i => i.kind === 'user').map(i => (i as { text: string }).text);
    // the chosen one goes right after the interrupt, the other waits for that turn to end
    await expect.poll(users, { timeout: 20000 }).toEqual(['slow', 'secondo, mandalo subito', 'primo in coda']);
    await expect(page.getByTestId(`chat-input-${chat.id}-queued-0`)).toHaveCount(0);
    await expect(page.getByTestId(`chat-state-${chat.id}`)).toHaveAttribute('data-state', 'idle', { timeout: 15000 });
    const items = (await page.evaluate(id => window.sb.invoke('chat:items', { chatId: id }), chat.id)) as ChatItem[];
    const results = items.filter(i => i.kind === 'result').map(i => { const r = i as { isError: boolean; interrupted?: boolean }; return [r.isError, !!r.interrupted]; });
    // the interrupted turn (the user's own: no error, 12/10), then one turn per queued message
    expect(results).toEqual([[false, true], [false, false], [false, false]]);
    await expect(page.getByText('Turno interrotto da te').first()).toBeVisible();
    await expect(page.getByText('Interrotto da te: riparto col tuo messaggio.').first()).toBeVisible();
    await expect(page.getByText('Turno finito con errore')).toHaveCount(0);
    expect(await users()).toEqual(['slow', 'secondo, mandalo subito', 'primo in coda']); // nothing sent twice
    await shot(page, `send-now-${engine}-done`);
    await app.close();
  });
}

test('claude: Enter again on an empty input sends the last queued message now ("doppio invio")', async () => {
  const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
  const cwd = tmp('sb-e2e-cwd-');
  const { app, page } = await launch({ SB_CLAUDE_PATH: path.join(FIX, 'fake-claude.mjs'), CLAUDE_CONFIG_DIR: tmp('sb-e2e-claude-'), FAKE_CLAUDE_DELAY: '60' });
  await setSize(app, 1400, 900);
  const chat: ChatSummary = await page.evaluate(dir => window.sb.invoke('chat:create', { harness: 'claude', cwd: dir, prompt: 'slow', title: 'Coda' }), cwd);
  const input = page.getByTestId(`chat-input-${chat.id}`);
  await expect(page.getByTestId(`chat-state-${chat.id}`)).toHaveAttribute('data-state', 'running', { timeout: 15000 });
  await input.fill('primo in coda');
  await input.press('Enter');
  await input.fill('secondo, doppio invio');
  await input.press('Enter');
  await expect(page.getByTestId(`chat-input-${chat.id}-queued-1`)).toContainText('secondo, doppio invio');
  await expect(input).toHaveAttribute('placeholder', /Invio di nuovo/);
  await shot(page, 'send-now-double-enter-queue');
  await input.press('Enter'); // the input is empty: the last queued one goes now
  const users = async () => ((await page.evaluate(id => window.sb.invoke('chat:items', { chatId: id }), chat.id)) as ChatItem[])
    .filter(i => i.kind === 'user').map(i => (i as { text: string }).text);
  await expect.poll(users, { timeout: 20000 }).toEqual(['slow', 'secondo, doppio invio', 'primo in coda']);
  await expect(page.getByTestId(`chat-state-${chat.id}`)).toHaveAttribute('data-state', 'idle', { timeout: 15000 });
  // Enter on an empty input with nothing queued sends nothing
  await input.press('Enter');
  await page.waitForTimeout(300);
  expect(await users()).toEqual(['slow', 'secondo, doppio invio', 'primo in coda']);
  await app.close();
});
