// E2E of a second start of the app on the same profile (the desktop icon clicked while the app is open, or still
// quitting): it leaves at once with exit code 75, which the stable launcher (scripts/release.mjs) reads as "already
// open", never as a broken release (2026-10-12: 91967ec marked bad that way); a quitting app writes quitting.json, so
// the launcher waits for it instead of leaving it in front. The launcher side: test/unit/release-launch.test.ts.
import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { launchDemo } from './helpers';

const electronExe = createRequire(import.meta.url)('electron') as unknown as string;

test('a second start on the same profile exits with 75; a quitting app writes quitting.json', async () => {
  const { app, userData } = await launchDemo();
  // Match Playwright's test-only sandbox mode for both instances, including non-root Linux runners whose
  // kernel denies Chromium's user namespace. Production launch flags are not changed by this test.
  const sandbox = app.process().spawnargs.filter(arg => arg === '--no-sandbox');
  const pid = await app.evaluate(() => process.pid);
  const second = spawn(electronExe, [...sandbox, ...(process.env.SB_E2E_ELECTRON_ARGS ?? '').split(/\s+/).filter(Boolean), '.'], {
    cwd: path.resolve(import.meta.dirname, '..', '..'), stdio: ['ignore', 'ignore', 'pipe'], signal: AbortSignal.timeout(20_000),
    env: { ...process.env, SB_USER_DATA: userData, SB_MCP_PORT: '0', SB_TEST: '1', SB_HIDDEN: '1', SB_DEMO: '1' },
  });
  let stderr = '';
  second.stderr?.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-4000); });
  try {
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      second.once('error', reject);
      second.once('exit', (code, signal) => resolve({ code, signal }));
    });
    expect(result, stderr).toEqual({ code: 75, signal: null });
  } finally {
    if (second.exitCode === null && second.signalCode === null) second.kill('SIGKILL');
    await app.close();
  }
  expect(JSON.parse(fs.readFileSync(path.join(userData, 'quitting.json'), 'utf8'))).toMatchObject({ pid });
});
