// Token-free live format check against an installed Claude CLI. Registered only where that external CLI exists.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { emitPack } from '../../src/main/agents/pack/emit';
import { readZip, writeZip } from '../../src/main/agents/pack/zip';

const available = spawnSync('claude', ['--version'], { windowsHide: true, timeout: 15000 }).status === 0;
if (available) it('loads an unzipped pack through claude plugin validate --strict', () => {
  const hash = 'a'.repeat(64);
  const files = emitPack({ format: 1, packId: 'reviewer-0123456789abcdef', revision: 1, contentHash: hash,
    agent: { id: 'reviewer', name: 'Reviewer', role: 'Review changes', category: 'development', instructionsFile: 'agents/reviewer.md',
      manifest: {}, engine: 'claude', model: null, effort: 'high', tools: { allow: ['read'] }, permissionCeiling: 'default' },
    icon: { symbol: 'eye', tone: 'blue' }, skills: [{ name: 'reviewer', ownership: 'owned', hash }],
    createdAt: '2026-10-18T00:00:00Z', exportedAt: '2026-10-18T00:00:00Z', appVersion: '0.1.0' }, 'Review changes.',
  new Map([['skills/reviewer/SKILL.md', Buffer.from('---\nname: reviewer\ndescription: Review changes\n---\nReview changes.\n')]]));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pack-live-'));
  try {
    for (const [name, data] of readZip(writeZip(files))) { const dest = path.join(root, name); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, data); }
    const result = spawnSync('claude', ['plugin', 'validate', '--strict', root], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}, 40000);
