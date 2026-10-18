// E2E of A7b (AGENTS-DESIGN §4.7-4.8): a chat started by hand without choosing an Agent runs as Generale, so it is an
// agent run like any other, with its tags (here the skills and app it asked for). The real app with the fake Claude CLI,
// hidden (SB_HIDDEN).
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatSummary } from '../../src/shared/contract';
import { launch } from './helpers';

const FAKE = path.resolve(import.meta.dirname, '..', 'fixtures', 'fake-claude.mjs');

test('a manual chat with no agent is a Generale run in chat:list', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-claude-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-cwd-'));
  const { app, page } = await launch({ SB_CLAUDE_PATH: FAKE, CLAUDE_CONFIG_DIR: home });
  const chat: ChatSummary = await page.evaluate(dir => window.sb.invoke('chat:create', { harness: 'claude', cwd: dir, prompt: 'ciao', title: 'Generale', skills: ['review'], app: 'crm' }), cwd);
  expect(chat.agent).toMatchObject({ id: 'default-general', name: 'Generale', source: 'catalog' });
  const listed: ChatSummary = (await page.evaluate(() => window.sb.invoke('chat:list', undefined))).find((c: ChatSummary) => c.id === chat.id)!;
  expect(listed.agent?.id).toBe('default-general');
  expect(listed.run).toMatchObject({ agentId: 'default-general', startedBy: 'user', tags: { skills: ['review'], app: 'crm', repo: null } });
  expect(listed.run?.endedAt).toBeUndefined();
  await page.screenshot({ path: path.join(os.tmpdir(), 'sb-generale-run.png') });
  await app.close();
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(cwd, { recursive: true, force: true });
});
