// Proves (PR #12, hybrid search): when `git ls-files` fails on the brain folder (git refuses a repository owned by
// another account, "dubious ownership", or git is not on the PATH), brainFiles falls back to a plain folder walk that
// ignores .gitignore, so gitignored notes (the brain keeps secrets, state and outputs gitignored) are indexed and served
// to every chat by brain_search. The brain's own site fails closed in the same situation (no tracked files = nothing).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { brainFiles, Engine } from '../../../../src/main/search/hybrid/engine';
import { Store } from '../../../../src/main/search/hybrid/store';

const tmp: string[] = [];
const savedPath = process.env.PATH;
afterEach(() => {
  process.env.PATH = savedPath;
  for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function repo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pr12-ign-'));
  tmp.push(root);
  const git = (...a: string[]) => execFileSync('git', a, { cwd: root, stdio: 'ignore' });
  git('init', '-q', '.');
  fs.writeFileSync(path.join(root, '.gitignore'), 'private/\n');
  fs.mkdirSync(path.join(root, 'private'));
  fs.writeFileSync(path.join(root, 'private', 'keys.txt'), 'deploy token: abc123\n');
  fs.writeFileSync(path.join(root, 'now.md'), '- today\n');
  return root;
}

describe('brainFiles when git fails', () => {
  it('preserves an existing safe index when git becomes unavailable', async () => {
    const root = repo();
    const store = new Store(':memory:', null);
    try {
      const engine = new Engine(store);
      await engine.sync(root);
      expect(engine.status().docs).toBe(1);
      process.env.PATH = '';
      await expect(engine.sync(root)).rejects.toThrow();
      expect(engine.status().docs).toBe(1);
      expect((await engine.query('today')).map(h => h.path)).toEqual(['now.md']);
      expect(await engine.query('abc123')).toEqual([]);
    } finally { store.close(); }
  });

  it('sanity: with git working, a gitignored note is left out', async () => {
    const root = repo();
    expect(await brainFiles(root)).toEqual(['now.md']);
  });

  it('still leaves gitignored notes out when git ls-files fails', async () => {
    const root = repo();
    if (process.getuid?.() === 0) {
      // the realistic case: the folder belongs to another account, git exits 128 ("detected dubious ownership")
      execFileSync('chown', ['-R', '1000:1000', root]);
    } else {
      process.env.PATH = ''; // git not found
    }
    await expect(brainFiles(root), 'failed git inventory must never fall back to unfiltered files').rejects.toThrow();
  });
});
