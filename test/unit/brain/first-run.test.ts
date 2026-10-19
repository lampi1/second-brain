// Regression: boot a real BrainService with no selected brain or external monitors: setup stays new.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ Notification: {}, shell: {} }));
vi.mock('../../../src/main/brain/cursor-ledger', () => ({ installHook: vi.fn(), cursorToday: vi.fn() }));
vi.mock('../../../src/main/brain/usage', () => ({ claudeConfigFile: () => null, UsageMonitor: class { start() {} stop() {} } }));
import { createBrain } from '../../../src/main/brain';
import { Emitter } from '../../../src/main/ipc';
import { SetupService } from '../../../src/main/agents/setup';

it('does not adopt any brain on a normal fresh startup, so setup remains new', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'first-run-'));
  const brain = await createBrain({ userData, env: { SB_HIDDEN: '1' }, emitter: new Emitter(() => null), window: () => null });
  try {
    expect(brain.settings().brainRoot).toBeNull();
    expect(new SetupService(userData, !!brain.settings().brainRoot).get().status).toBe('new');
  } finally { await brain.shutdown(); fs.rmSync(userData, { recursive: true, force: true }); }
});
