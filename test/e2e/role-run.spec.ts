// A chat started with a role is a run of that role with its tags (here the skills and app it asked for); a chat
// started without one is a plain chat: the user's own permissions, no run. A launch skill must exist (pack/flows.ts
// refuses an unknown one by name), so a fixture brain (SB_BRAIN, never the user's) holds the `review` skill asked for.
// The real app with the fake Claude CLI, hidden (SB_HIDDEN).
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatSummary } from '../../src/shared/contract';
import { launch } from './helpers';

const FAKE = path.resolve(import.meta.dirname, '..', 'fixtures', 'fake-claude.mjs');

test('a chat started with a role is a run of that role; one without a role is plain', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-claude-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-cwd-'));
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-brain-'));
  fs.mkdirSync(path.join(brain, '.agents', 'skills', 'review'), { recursive: true });
  fs.writeFileSync(path.join(brain, '.agents', 'skills', 'review', 'SKILL.md'), '---\nname: review\ndescription: Reviews a diff for correctness.\n---\n# Review\n');
  const { app, page } = await launch({ SB_CLAUDE_PATH: FAKE, CLAUDE_CONFIG_DIR: home, SB_BRAIN: brain });
  try {
    const role: ChatSummary = await page.evaluate(dir => window.sb.invoke('chat:create', { harness: 'claude', cwd: dir, prompt: 'cerca gli usi', title: 'Ricerca', roleId: 'scout', skills: ['review'], app: 'crm' }), cwd);
    expect(role.agent).toMatchObject({ id: 'scout', name: 'Scout', source: 'catalog' });
    const plain: ChatSummary = await page.evaluate(dir => window.sb.invoke('chat:create', { harness: 'claude', cwd: dir, prompt: 'ciao', title: 'Libera' }), cwd);
    const listed: ChatSummary[] = await page.evaluate(() => window.sb.invoke('chat:list', undefined));
    const r = listed.find(c => c.id === role.id)!, p = listed.find(c => c.id === plain.id)!;
    expect(r.run).toMatchObject({ agentId: 'scout', startedBy: 'user', tags: { skills: ['review'], app: 'crm', repo: null } });
    expect(r.run?.endedAt).toBeUndefined();
    expect(p.agent?.source ?? 'plain').toBe('plain');
    expect(p.run).toBeUndefined();
  } finally {
    await app.close();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(brain, { recursive: true, force: true });
  }
});
