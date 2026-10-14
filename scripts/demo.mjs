// `npm run demo`: builds the app and starts it in demo mode with fake chats, browser tabs and a synthetic brain
// (scripts/demo-brain.mjs): the whole UI with no Claude or Cursor CLI, no login, no tokens and no network. Its own
// profile in a temp folder, so it never touches a real instance's settings. Flags: --frozen (fixed clock and data, as
// in the screenshots), --hidden (off screen, for agents: see it through the app MCP `app_screenshot`).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoBrain } from './demo-brain.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const b = spawnSync(process.execPath, [path.join(root, 'scripts', 'build.mjs')], { stdio: 'inherit' });
if (b.status !== 0) process.exit(b.status ?? 1);

const electron = path.join(root, 'node_modules', 'electron', 'cli.js');
if (!fs.existsSync(path.join(root, 'node_modules', 'electron', 'dist'))) {
  console.error('Electron is not installed: run `npm run setup` first.');
  process.exit(1);
}
const env = {
  ...process.env, SB_DEMO: '1', SB_BRAIN: demoBrain(), SB_MCP_PORT: '0',
  SB_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'sb-demo-profile-')),
  ...(process.argv.includes('--frozen') ? { SB_DEMO_FREEZE: '1' } : {}),
  ...(process.argv.includes('--hidden') ? { SB_HIDDEN: '1' } : {}),
};
const child = spawn(process.execPath, [electron, '.'], { cwd: root, env, stdio: 'inherit' });
child.on('exit', code => process.exit(code ?? 0));
