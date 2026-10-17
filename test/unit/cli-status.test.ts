// CLI status preserves an unknown Claude login when a CLI emits unsupported/malformed auth output. The only process
// started is this temporary Node test double, never the user's engine or credentials.
import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cursorPath, engineStatus } from '../../src/main/cli';

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const p of roots.splice(0)) fs.rmSync(p, { recursive: true, force: true }); });

it.each([
  ['{}', null], ['null', null], ['not JSON', null], ['{"loggedIn":"false"}', null], ['{"loggedIn":false}', false], ['{"loggedIn":true}', true],
])('keeps the actual app login status tri-state for %s', async (auth, expected) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-cli-status-')); roots.push(root);
  const fake = path.join(root, 'fake.mjs');
  fs.writeFileSync(fake, 'console.log(process.argv.includes("--version") ? "1.2.3" : process.env.FAKE_AUTH);');
  vi.stubEnv('SB_CLAUDE_PATH', fake); vi.stubEnv('SB_DEMO', ''); vi.stubEnv('FAKE_AUTH', String(auth));
  expect(await engineStatus('claude')).toMatchObject({ found: true, path: fake, loggedIn: expected });
});

it.skipIf(process.platform !== 'win32')('finds the Cursor status/login launcher without LOCALAPPDATA or PATH', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-cursor-status-')); roots.push(root);
  const install = path.join(root, 'AppData', 'Local', 'cursor-agent'), version = path.join(install, 'versions', '2026.7.1-abcdef');
  fs.mkdirSync(version, { recursive: true });
  for (const name of ['node.exe', 'index.js']) fs.writeFileSync(path.join(version, name), '');
  const shim = path.join(install, 'agent.cmd'); fs.writeFileSync(shim, '');
  vi.stubEnv('SB_CURSOR_PATH', undefined); vi.stubEnv('LOCALAPPDATA', undefined); vi.stubEnv('USERPROFILE', root); vi.stubEnv('PATH', '');
  expect(cursorPath()).toBe(shim);
});
