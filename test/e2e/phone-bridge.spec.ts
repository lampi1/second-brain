// E2E of the Telegram phone bridge wired into main (src/main/phone/wiring.ts, index.ts; ADR 0219) against a fake Telegram
// server on 127.0.0.1 (test/unit/phone/fakes.ts) handed to the dev instance with SB_PHONE_TEST_API; the real
// api.telegram.org is never called. The fake Claude engine plays the Orchestrator. Covers: the token saved from
// Impostazioni → Telefono's API, pairing with the 6-digit code, a phone text reaching the Orchestrator as the user's
// message (📱), its reply coming back through the filter, and a simple Sì/No question answered with the phone's button.
// Screenshot: test-results/shots/phone-bridge.png (Impostazioni → Telefono, paired and running).
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatItem, PendingRequest } from '../../src/shared/contract';
import { callbackUpdate, startFakeTelegram, textUpdate, TOKEN, type FakeTelegram } from '../unit/phone/fakes';
import { closeSetup, launch, setSize, shot } from './helpers';

const FIX = path.resolve(import.meta.dirname, '..', 'fixtures');

let tg: FakeTelegram;
test.beforeEach(async () => { tg = await startFakeTelegram(); });
test.afterEach(async () => { await tg.close(); });

test('the phone pairs, talks to the Orchestrator and answers a Sì/No question with its button', async () => {
  const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
  const { app, page } = await launch({ SB_PHONE_TEST_API: tg.base, SB_CLAUDE_PATH: path.join(FIX, 'fake-claude.mjs'), CLAUDE_CONFIG_DIR: tmp('sb-e2e-claude-') });
  await setSize(app, 1400, 900);
  await closeSetup(page);
  const orch = await page.evaluate(() => window.sb.invoke('orchestrator:ensure', { harness: 'claude' }));
  const texts = () => tg.sent().map(c => String(c.body.text ?? ''));

  // token and pairing, as the Settings page does
  await page.evaluate(t => window.sbPhone!.setToken(t), TOKEN);
  const pairing = await page.evaluate(() => window.sbPhone!.startPairing());
  const code = pairing.pairing!.code;
  await expect.poll(() => tg.calls.some(c => c.method === 'getUpdates'), { timeout: 15000 }).toBe(true);
  tg.push(textUpdate(`/start ${code}`));
  await expect.poll(async () => (await page.evaluate(() => window.sbPhone!.status())).paired, { timeout: 15000 }).toBe(true);

  // a phone text is the user's message in the Orchestrator; its reply comes back to the phone
  const before = texts().length;
  tg.push(textUpdate('A che punto siamo?'));
  const items = () => page.evaluate(id => window.sb.invoke('chat:items', { chatId: id }), orch.id) as Promise<ChatItem[]>;
  await expect.poll(async () => (await items()).some(i => i.kind === 'user' && i.via === 'phone' && i.text.includes('A che punto siamo?')), { timeout: 15000 }).toBe(true);
  await expect.poll(() => texts().slice(before).some(t => t.includes('Ciao dal motore')), { timeout: 20000 }).toBe(true);

  // a simple Sì/No question arrives with buttons; the phone's button answers it
  tg.push(textUpdate('asksn'));
  await expect.poll(() => tg.sent().some(c => !!(c.body.reply_markup as { inline_keyboard?: unknown } | undefined)?.inline_keyboard), { timeout: 20000 }).toBe(true);
  const q = tg.sent().find(c => (c.body.reply_markup as { inline_keyboard?: unknown } | undefined)?.inline_keyboard)!;
  const kb = (q.body.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] }).inline_keyboard.flat();
  const yes = kb.find(b => b.text.startsWith('Sì'))!;
  const messageId = 100 + tg.sent().indexOf(q);
  tg.push(callbackUpdate(yes.callback_data, messageId));
  const pending = () => page.evaluate(() => window.sb.invoke('chat:pending', undefined)) as Promise<PendingRequest[]>;
  await expect.poll(async () => (await pending()).filter(p => p.chatId === orch.id).length, { timeout: 15000 }).toBe(0);
  await expect.poll(async () => (await items()).some(i => i.kind === 'assistant' && i.text.includes('Hai scelto')), { timeout: 15000 }).toBe(true);
  // the real Telegram was never called
  expect(tg.urls.every(u => !u.includes('api.telegram.org'))).toBe(true);

  await page.keyboard.press('Control+,');
  await expect(page.getByTestId('settings-page')).toBeVisible();
  await page.getByTestId('st-nav-phone').click();
  await expect(page.getByTestId('st-phone-state-line')).toHaveAttribute('data-state', 'running');
  await expect(page.getByTestId('st-phone-token-saved')).toBeVisible();
  await expect(page.getByTestId('st-phone-unpair')).toBeVisible();
  await page.mouse.move(2, 2);
  await shot(page, 'phone-bridge');
  await app.close();
});
