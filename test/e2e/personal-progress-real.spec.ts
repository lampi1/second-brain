// Retired milestones never return or accrue through normal real-profile actions. No real providers are used.
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatSummary } from '../../src/shared/contract';
import { launch, openAgents, shot } from './helpers';

const FAKE = path.resolve(import.meta.dirname, '..', 'fixtures', 'fake-claude.mjs');

test('retired personal milestones stay absent after a result, customization and setup', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-claude-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-cwd-'));
  // a profile past its first run (the "Collega la tua IA" gate was skipped), as a returning user's, with a brain folder
  // (a customized role keeps its skills in the brain: agents/pack/flows.ts root())
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-'));
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-brain-'));
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ brainRoot: brain }));
  fs.writeFileSync(path.join(userData, 'setup.json'), JSON.stringify({ version: 1, status: 'skipped', updatedAt: 1, preferences: { step: 0, work: '', goals: '', tools: '', style: 'balanced' } }));
  const { app, page } = await launch({ SB_CLAUDE_PATH: FAKE, CLAUDE_CONFIG_DIR: home }, userData);
  try {
    await page.evaluate(dir => window.sb.invoke('chat:create', { harness: 'claude', cwd: dir, prompt: 'hello', title: 'Traguardo' }), cwd);
    const listed = async (): Promise<ChatSummary> => (await page.evaluate(() => window.sb.invoke('chat:list', undefined)))[0]!;
    // the wait is for the fake engine's node process to start and answer, not a timing under test
    await expect.poll(async () => { const c = await listed(); return c.state === 'idle' && !!c.lastResult && !c.lastResult.isError; }, { timeout: 20_000 }).toBe(true);

    await openAgents(page);
    await expect(page.getByTestId('personal-progress')).toHaveCount(0);
    expect((await page.evaluate(() => window.sb.invoke('progress:get', undefined))).available).toBe(false);

    // These normal operations must no longer award personal milestones.
    await page.evaluate(async () => {
      const role = (await window.sb.invoke('agents:list', undefined)).profiles.find(p => p.id === 'scout')!;
      await window.sb.invoke('agents:save', { id: role.id, profile: { ...role, instructions: `${role.instructions}\nAlways cite the file.` } });
      const setup = await window.sb.invoke('setup:get', undefined);
      await window.sb.invoke('setup:save', { preferences: setup.preferences, status: 'completed' });
    });
    expect((await page.evaluate(() => window.sb.invoke('progress:get', undefined))).earned).toEqual([]);
    await shot(page, 'personal-progress-real');
  } finally { await app.close(); }
});
