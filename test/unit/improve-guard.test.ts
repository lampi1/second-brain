// Regression: replacement refs must not hide the original private blob that Git would publish.
// Real Git and shipped scanner, scratch fixtures in the OS temp folder (never left in the repo tree); no remote, push, PR or running application.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { scanCommits } from '../../src/main/brain/guard';

it('scans original blobs even when refs/replace presents a safe replacement commit', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-replace-fixture-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Example'); git('config', 'user.email', 'user@example.com');
    git('config', 'core.hooksPath', path.join(root, 'no-hooks')); git('config', 'commit.gpgSign', 'false');
    fs.writeFileSync(path.join(root, 'file.txt'), 'safe'); git('add', 'file.txt'); git('commit', '-qm', 'Initial');
    const safe = git('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(root, 'file.txt'), 'PRIVATE-CUSTOMER-MARKER'); git('add', 'file.txt'); git('commit', '-qm', 'Change');
    const original = git('rev-parse', 'HEAD');
    git('replace', original, safe);
    expect(git('show', `${original}:file.txt`)).toBe('safe');
    const deny = path.join(root, 'deny.txt'); fs.writeFileSync(deny, 'PRIVATE-CUSTOMER-MARKER');
    const scan = path.resolve(import.meta.dirname, '../../tools/guard/scan.mjs');
    const result = await scanCommits(root, [original], { scan, deny }, { exe: process.execPath, env: process.env });
    expect(result.ok).toBe(false);
    expect('findings' in result && result.findings.some(f => f.rule === 'deny-list')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('PRIVATE-CUSTOMER-MARKER');
  } finally {
    if (!root.startsWith(path.join(os.tmpdir(), 'sb-replace-fixture-'))) throw new Error('Unexpected fixture root');
    fs.rmSync(root, { recursive: true, force: true });
  }
});
