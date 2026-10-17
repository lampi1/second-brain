// Promotion bypasses must fail before build/check/state writes. Staging and portable engine paths are constrained
// independently of the caller's environment; fake roots never touch the user's installation.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without types
import { assertReleaseId, assertStagingRoot, releaseEnginePath } from '../../scripts/release.mjs';

const roots: string[] = [];
const temp = () => { const p = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-gate-'))); roots.push(p); return p; };
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('stable release gates', () => {
  it.each(['--skip-check', '--allow-dirty'])('rejects %s even with an isolated root', flag => {
    const root = temp();
    const result = spawnSync(process.execPath, ['scripts/release.mjs', 'promote', flag], { cwd: path.resolve(import.meta.dirname, '../..'), encoding: 'utf8', env: { ...process.env, SB_RELEASES_ROOT: root, SB_NO_SYNC: '1', ELECTRON_RUN_AS_NODE: '1' } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('bypass flags are not supported');
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('stages only below disposable roots and refuses nonempty directories', () => {
    const root = temp();
    expect(() => assertStagingRoot(root)).not.toThrow();
    expect(() => assertStagingRoot(os.tmpdir())).toThrow();
    expect(() => assertStagingRoot(path.parse(root).root)).toThrow();
    fs.writeFileSync(path.join(root, 'current.json'), '{}');
    expect(() => assertStagingRoot(root)).toThrow(/empty/);
  });

  it('rejects a junction escaping the disposable root', () => {
    const root = temp();
    const target = temp();
    const link = path.join(root, 'link');
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => assertStagingRoot(path.join(link, 'child'))).toThrow(/symlink or junction/);
  });

  it('resolves a portable engine at its destination, preserving old absolute releases', () => {
    const root = temp();
    expect(releaseEnginePath({ claudeEngine: 'engines/claude/1.0.0/claude.exe' }, root)).toBe(path.join(root, 'engines', 'claude', '1.0.0', 'claude.exe'));
    expect(releaseEnginePath({ claudeEngine: path.join(root, 'old.exe') }, root)).toBe(path.join(root, 'old.exe'));
    expect(() => releaseEnginePath({ claudeEngine: '../outside.exe' }, root)).toThrow(/escapes/);
    expect(releaseEnginePath({ claudeEngine: null }, root)).toBeNull();
  });

  it.each(['../release', '..', 'C:/release', '', 'version & whoami'])('rejects unsafe release identifier %j', id => {
    expect(() => assertReleaseId(id)).toThrow();
  });
});
