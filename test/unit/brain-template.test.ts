// brain-template/ (ADR 0061): the empty brain a new user starts from, edited in this repo. Its scripts run in the user's
// brain, not in the app, so the app's lint rules do not apply to them (eslint.config.js ignores the folder); this test
// keeps the check the old export did on them: every script still parses (`node --check`), and the installer and the
// README a new user opens are there. Personal data in the template is the publish guard's job (publish-guard.test.ts).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..', '..');
const tpl = path.join(root, 'brain-template');

function scripts(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? scripts(p) : /\.(mjs|cjs|js)$/.test(e.name) ? [p] : [];
  });
}

describe('brain-template', () => {
  it('has the installer and the guides a new user opens first', () => {
    for (const f of ['install.mjs', 'README.md', 'START-HERE.md', 'AGENTS.md', 'me.template.md']) expect(fs.existsSync(path.join(tpl, f)), f).toBe(true);
  });

  it('every script parses', async () => {
    const files = scripts(tpl);
    expect(files.length).toBeGreaterThan(10);
    // in parallel: one by one, 40+ node starts passed the timeout under the full unit suite's load
    const parses = (f: string) => new Promise<boolean>(resolve => {
      execFile(process.execPath, ['--check', f], { windowsHide: true }, err => resolve(!err));
    });
    const ok = await Promise.all(files.map(parses));
    const broken = files.filter((_, i) => !ok[i]).map(f => path.relative(root, f).replace(/\\/g, '/'));
    expect(broken).toEqual([]);
  }, 180_000);
});
