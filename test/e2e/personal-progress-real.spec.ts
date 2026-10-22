// Personal milestones in the real profile (Brother, 18/10: milestones must be earnable): "Confermo" on a chat that
// ended a turn with a result, a customized Agent and the first completed setup each earn theirs. The real app with the
// fake Claude CLI, hidden (SB_HIDDEN); the demo stays read-only (personal-progress.spec.ts). Screenshot
// test-results/shots/personal-progress-real.png.
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatSummary } from '../../src/shared/contract';
import { launch, openAgents, shot } from './helpers';

const FAKE = path.resolve(import.meta.dirname, '..', 'fixtures', 'fake-claude.mjs');

test('the real profile awards its milestones: "Confermo" on a finished result, a customized role, a completed setup', async () => {
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
    const progress = page.getByTestId('personal-progress');
    await expect(progress).toBeVisible();
    await expect(progress.getByRole('button', { name: 'Nascondi', exact: true })).toBeEnabled();
    const confirm = progress.getByRole('button', { name: 'Confermo: ho ottenuto un risultato utile' });
    await expect(confirm).toBeVisible();
    await confirm.click();
    await expect(progress).toContainText('1 di 3 traguardi');
    await expect(confirm).toHaveCount(0);

    // the other two are earned where they happen: a customized role and the first completed setup
    await page.evaluate(async () => {
      const role = (await window.sb.invoke('agents:list', undefined)).profiles.find(p => p.id === 'scout')!;
      await window.sb.invoke('agents:save', { id: role.id, profile: { ...role, instructions: `${role.instructions}\nAlways cite the file.` } });
      const setup = await window.sb.invoke('setup:get', undefined);
      await window.sb.invoke('setup:save', { preferences: setup.preferences, status: 'completed' });
    });
    await expect(progress).toContainText('3 di 3 traguardi');
    await shot(page, 'personal-progress-real');
  } finally { await app.close(); }
});
