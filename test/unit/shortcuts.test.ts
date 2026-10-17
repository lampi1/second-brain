// Stable shell integration uses the durable root icon. Dev/staged copies must not modify real desktop/menu links.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ base: '', release: '1.0.0-test', write: vi.fn((_link: string, _operation: string, _details: Electron.ShortcutDetails) => true) }));
vi.mock('electron', () => ({ app: { getPath: (name: string) => path.join(ctx.base, name) }, shell: { writeShortcutLink: ctx.write } }));
vi.mock('../../src/main/platform', () => ({ sharedDir: () => ctx.base, linuxDesktopEntry: vi.fn(), macCommandFile: vi.fn() }));
vi.mock('../../src/main/release', () => ({ releaseId: () => ctx.release || null }));
vi.mock('../../src/main/log', () => ({ log: { warn: vi.fn() } }));
import { ensureShortcuts } from '../../src/main/shortcuts';

const saved = process.env.SB_RELEASES_ROOT;
beforeEach(() => {
  ctx.base = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-shortcuts-'));
  ctx.release = '1.0.0-test';
  ctx.write.mockClear();
  delete process.env.SB_RELEASES_ROOT;
  fs.writeFileSync(path.join(ctx.base, 'launch.vbs'), 'launcher');
  fs.writeFileSync(path.join(ctx.base, 'icon.ico'), 'durable icon');
});
afterEach(() => {
  if (saved === undefined) delete process.env.SB_RELEASES_ROOT; else process.env.SB_RELEASES_ROOT = saved;
  fs.rmSync(ctx.base, { recursive: true, force: true });
});

describe.skipIf(process.platform !== 'win32')('stable shortcuts', () => {
  it('creates both links with an icon outside release directories', () => {
    ensureShortcuts();
    expect(ctx.write).toHaveBeenCalledTimes(2);
    for (const call of ctx.write.mock.calls) expect(call[2]).toMatchObject({ icon: path.join(ctx.base, 'icon.ico'), cwd: ctx.base, appUserModelId: 'second-brain', args: `"${path.join(ctx.base, 'launch.vbs')}"` });
  });
  it('writes nothing from a dev checkout', () => {
    ctx.release = '';
    ensureShortcuts();
    expect(ctx.write).not.toHaveBeenCalled();
  });
  it('writes nothing from an isolated stable/installer test', () => {
    process.env.SB_RELEASES_ROOT = path.join(ctx.base, 'isolated');
    ensureShortcuts();
    expect(ctx.write).not.toHaveBeenCalled();
  });
});
