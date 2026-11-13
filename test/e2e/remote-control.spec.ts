// E2E of «Controllo remoto» on the Orchestrator's head (RemoteControl.tsx, chats/manager-remote.ts, ADR 0229): the
// phone button turns Claude Code Remote Control on in the Orchestrator's own engine (the fake Claude CLI answers
// remote_control like 2.1.283), the line under the head shows the claude.ai link with «Copia link» and «Spegni», a
// message typed on the phone shows in the chat as the phone's, and «Spegni» turns it off. No real claude.ai.
// Screenshot: test-results/shots/remote-control.png (the line on, connected, with the link).
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatItem } from '../../src/shared/contract';
import { closeSetup, launch, setSize, shot } from './helpers';

const FIX = path.resolve(import.meta.dirname, '..', 'fixtures');

test('«Controllo remoto» shows the claude.ai link, the phone\'s message, and turns off', async () => {
  const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
  const log = path.join(tmp('sb-e2e-rc-'), 'fake.log');
  const { app, page } = await launch({ SB_CLAUDE_PATH: path.join(FIX, 'fake-claude.mjs'), CLAUDE_CONFIG_DIR: tmp('sb-e2e-claude-'), FAKE_CLAUDE_LOG: log, FAKE_CLAUDE_RC_PHONE: 'scrivo dal telefono' });
  await setSize(app, 1400, 900);
  await closeSetup(page);
  const orch = await page.evaluate(() => window.sb.invoke('orchestrator:ensure', { harness: 'claude' }));
  const column = page.getByTestId('orchestrator-overlay');
  const button = column.getByTestId('orchestrator-remote');
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(column.getByTestId('remote-line')).toHaveCount(0);

  await button.click();
  const line = column.getByTestId('remote-line');
  await expect(line).toHaveAttribute('data-status', 'connected', { timeout: 20_000 });
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(line.getByTestId('remote-url')).toHaveText(/^https:\/\/claude\.ai\/code\/session_cse_fake\d+$/);
  await expect(line.getByTestId('remote-copy')).toBeVisible();
  await expect(line.getByTestId('remote-off')).toBeEnabled();
  // the engine got the request on its own stdin: the Orchestrator's title as the session name
  const requests = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as { control?: string; request?: Record<string, unknown> });
  expect(requests.find(r => r.control === 'remote_control')?.request).toMatchObject({ subtype: 'remote_control', enabled: true });

  // a message typed on the phone shows as the phone's
  const items = () => page.evaluate(id => window.sb.invoke('chat:items', { chatId: id }), orch.id) as Promise<ChatItem[]>;
  await expect.poll(async () => (await items()).some(i => i.kind === 'user' && i.via === 'phone' && i.text === 'scrivo dal telefono'), { timeout: 20_000 }).toBe(true);
  await page.mouse.move(2, 2);
  await shot(page, 'remote-control');

  await line.getByTestId('remote-off').click();
  await expect(column.getByTestId('remote-line')).toHaveCount(0);
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  const summary = (await page.evaluate(() => window.sb.invoke('chat:list', undefined))).find(c => c.id === orch.id);
  expect(summary?.remoteControl).toEqual({ on: false, url: null, bridgeSessionId: null, status: 'off' });
  await app.close();
});
