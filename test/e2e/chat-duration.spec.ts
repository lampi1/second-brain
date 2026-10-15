// E2E of a chat's duration beside its cost (ChatTile.tsx): the real work time ("lavoro N min": starting or running,
// never the wait for the user's answer). The real app with the fake Claude CLI, hidden (SB_HIDDEN);
// screenshot test-results/shots/chat-duration.png.
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatSummary, PendingRequest } from '../../src/shared/contract';
import { launch, shot } from './helpers';

const FAKE = path.resolve(import.meta.dirname, '..', 'fixtures', 'fake-claude.mjs');

test('a chat shows its real work time (waits for the answer left out)', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-claude-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-cwd-'));
  const { app, page } = await launch({ SB_CLAUDE_PATH: FAKE, CLAUDE_CONFIG_DIR: home });
  const chat: ChatSummary = await page.evaluate(dir => window.sb.invoke('chat:create', { harness: 'claude', cwd: dir, prompt: 'ask me something', title: 'Durata' }), cwd);
  // the fake CLI's question needs a node process started: beside the parallel suite that start alone took 5.05 s
  // (2026-10-14), so the default 5 s poll lost the race; the wait is for the engine, not a timing under test
  await expect.poll(async () => (await page.evaluate(() => window.sb.invoke('chat:pending', undefined))).length, { timeout: 20_000 }).toBe(1);

  const work = page.getByTestId(`chat-work-${chat.id}`);
  await expect(work).toHaveText(/^lavoro (<1|\d+) min$/);
  // while it waits for the answer the work time stands still
  const listed = async () => (await page.evaluate(() => window.sb.invoke('chat:list', undefined)))[0]!;
  const waiting = await listed();
  expect(waiting.state).toBe('waiting');
  expect(waiting.workSince).toBeUndefined();
  expect(waiting.workMs).toBeGreaterThan(0);

  const pending: PendingRequest[] = await page.evaluate(() => window.sb.invoke('chat:pending', undefined));
  await page.evaluate(([id, rid]) => window.sb.invoke('chat:answer', { chatId: id, requestId: rid, answer: { kind: 'question', answers: { 'Che colore?': 'Blu' } } }), [chat.id, pending[0]!.id] as const);
  await expect.poll(async () => (await listed()).state).toBe('idle');
  expect((await listed()).workMs).toBeGreaterThan(waiting.workMs!);
  await expect(work).toHaveText(/^lavoro (<1|\d+) min$/);
  await shot(page, 'chat-duration');
  await app.close();
});
