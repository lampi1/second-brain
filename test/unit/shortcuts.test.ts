// Stable shell integration uses the durable root icon. Dev/staged copies must not modify real desktop/menu links,
// except the icon of an existing link whose icon file is gone (a blank page on the taskbar).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ base: '', release: '1.0.0-test', write: vi.fn((_link: string, _operation: string, _details: Electron.ShortcutDetails) => true), read: vi.fn((_link: string): Electron.ShortcutDetails => ({ target: 'x' })) }));
vi.mock('electron', () => ({ app: { getPath: (name: string) => path.join(ctx.base, name) }, shell: { writeShortcutLink: ctx.write, readShortcutLink: ctx.read } }));
vi.mock('../../src/main/platform', () => ({ sharedDir: () => ctx.base, linuxDesktopEntry: vi.fn(), macCommandFile: vi.fn() }));
vi.mock('../../src/main/release', () => ({ releaseId: () => ctx.release || null }));
vi.mock('../../src/main/log', () => ({ log: { warn: vi.fn(), info: vi.fn() } }));
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
  it('a dev run points an existing link with a missing icon at the durable icon, and only that', () => {
    ctx.release = '';
    const dir = path.join(ctx.base, 'desktop');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'second-brain.lnk'), 'link');
    ctx.read.mockReturnValueOnce({ target: 'x', icon: path.join(ctx.base, 'gone', 'icon.ico') });
    ensureShortcuts();
    expect(ctx.write).toHaveBeenCalledTimes(1);
    expect(ctx.write.mock.calls[0]).toEqual([path.join(dir, 'second-brain.lnk'), 'update', { icon: path.join(ctx.base, 'icon.ico'), iconIndex: 0 }]);
  });
  it('copies the built icon to the shared dir when it is missing', () => {
    fs.rmSync(path.join(ctx.base, 'icon.ico'));
    const out = path.join(ctx.base, 'out');
    fs.mkdirSync(out);
    fs.writeFileSync(path.join(out, 'icon.ico'), 'built icon');
    ensureShortcuts(out);
    expect(fs.readFileSync(path.join(ctx.base, 'icon.ico'), 'utf8')).toBe('built icon');
    for (const call of ctx.write.mock.calls) expect(call[2].icon).toBe(path.join(ctx.base, 'icon.ico'));
  });
  it('writes nothing from an isolated stable/installer test', () => {
    process.env.SB_RELEASES_ROOT = path.join(ctx.base, 'isolated');
    ensureShortcuts();
    expect(ctx.write).not.toHaveBeenCalled();
  });
});
