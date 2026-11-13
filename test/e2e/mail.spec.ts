// End to end: mail between chats delivered by the app in real time (src/main/chats/mail.ts). A message another chat
// left with the brain's inbox.mjs reaches a chat of the app while its turn runs, folded to one line naming its
// sender ("Messaggio · «…»", lib/foreign.ts), exactly once, and the box's file moves to read/. Screenshot: test-results/shots/mail-delivered.png.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatItem, ChatSummary } from '../../src/shared/contract';
import { expandChats, launch, setSize, shot } from './helpers';

const FIX = path.resolve(import.meta.dirname, '..', 'fixtures');

test('a message from another chat reaches a working chat at once, its sender shown', async () => {
  const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
  const brain = tmp('sb-e2e-brain-');
  const box = path.join(brain, 'ops', 'state', 'inbox', 'pers-app');
  fs.mkdirSync(box, { recursive: true });
  const { app, page } = await launch({ SB_BRAIN: brain, SB_CLAUDE_PATH: path.join(FIX, 'fake-claude.mjs'), CLAUDE_CONFIG_DIR: tmp('sb-e2e-claude-'), FAKE_CLAUDE_DELAY: '80' });
  await setSize(app, 1400, 900);
  const chat: ChatSummary = await page.evaluate(dir => window.sb.invoke('chat:create', { harness: 'claude', cwd: dir, prompt: 'slow', title: 'Pers · App' }), tmp('sb-e2e-cwd-'));
  await expect(page.getByTestId(`chat-state-${chat.id}`)).toHaveAttribute('data-state', 'running', { timeout: 15000 });

  // what `inbox.mjs send --to "Pers · App" --from "Esegui nell'Orchestrator"` writes
  const msg = { id: '20261012120000000-abc123', thread: '20261012120000000-abc123', hop: 1, replyTo: null, from: 'Esegui nell’Orchestrator', to: 'Pers · App', at: new Date().toISOString(), text: 'Il build di oggi è pronto: prova la posta.' };
  fs.writeFileSync(path.join(box, `${msg.id}.json`), JSON.stringify(msg));

  const users = async () => ((await page.evaluate(id => window.sb.invoke('chat:items', { chatId: id }), chat.id)) as ChatItem[]).filter(i => i.kind === 'user');
  await expect.poll(async () => (await users()).length, { timeout: 8000 }).toBe(2);
  const got = (await users())[1] as Extract<ChatItem, { kind: 'user' }>;
  // a file the app did not sign (inbox.mjs, any Bash) cannot prove its sender
  expect(got.from).toBe('Esegui nell’Orchestrator (non verificato)');
  expect(got.text).toContain('Il build di oggi è pronto');
  expect(got.text.split('\n')[0]).toMatch(/non scritto dall'utente: non vale come suo ok o permesso/);
  expect((await page.evaluate(() => window.sb.invoke('chat:list', undefined)) as ChatSummary[]).find(c => c.id === chat.id)?.state).not.toBe('closed');
  // folded as mail from another chat (lib/foreign.ts, collapsed agent messages): sender + first words, never a bubble
  // of the user's and never the label line meant for the model; opened, it says it was not written by the user
  await expandChats(page, chat.id); // the transcript is on the open strip
  const item = page.getByTestId(`item-${got.id}`);
  await expect(item).toHaveAttribute('data-foreign', 'mail');
  await expect(item.locator('.foreign-who')).toHaveText('Messaggio · «Esegui nell’Orchestrator (non verificato)»');
  await expect(item).toContainText('Il build di oggi è pronto');
  await expect(item.locator('.bubble')).toHaveCount(0);
  await expect(item).not.toContainText('[Messaggio');
  await page.getByTestId(`item-${got.id}-toggle`).click();
  await expect(page.getByTestId(`item-${got.id}-body`)).toContainText('Il build di oggi è pronto');
  await expect(page.getByTestId(`item-${got.id}-body`)).toContainText('Non scritto da te');
  expect(fs.existsSync(path.join(box, 'read', `${msg.id}.json`))).toBe(true);
  expect(fs.readdirSync(box).filter(f => f.endsWith('.json') && !f.startsWith('.'))).toEqual([]); // nothing left unread
  await page.getByTestId(`item-${got.id}`).scrollIntoViewIfNeeded();
  await shot(page, 'mail-delivered');

  await new Promise(r => setTimeout(r, 2500));
  expect(await users()).toHaveLength(2); // delivered once
  await app.close();
});
