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
import { ensureShortcuts, staleIcon, taskbarDetails } from '../../src/main/shortcuts';

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
    expect(ctx.write.mock.calls[0]).toEqual([path.join(dir, 'second-brain.lnk'), 'update', { target: 'x', icon: path.join(ctx.base, 'icon.ico'), iconIndex: 0 }]);
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
  it('a link still showing Electron (icon = electron.exe) gets the app icon', () => {
    ctx.release = '';
    const dir = path.join(ctx.base, 'desktop');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'second-brain.lnk'), 'link');
    const exe = path.join(ctx.base, 'electron.exe');
    fs.writeFileSync(exe, 'exe');
    ctx.read.mockReturnValueOnce({ target: 'x', icon: exe });
    ensureShortcuts();
    expect(ctx.write.mock.calls[0]).toEqual([path.join(dir, 'second-brain.lnk'), 'update', { target: 'x', icon: path.join(ctx.base, 'icon.ico'), iconIndex: 0 }]);
  });
  it('repairs the taskbar pin carrying our AppUserModelId, never another pin', () => {
    const pins = path.join(ctx.base, 'appData', 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar');
    fs.mkdirSync(pins, { recursive: true });
    for (const f of ['Electron.lnk', 'Other.lnk']) fs.writeFileSync(path.join(pins, f), 'pin');
    const exe = path.join(ctx.base, 'electron.exe');
    fs.writeFileSync(exe, 'exe');
    ctx.read.mockImplementation(f => ({ target: exe, icon: exe, appUserModelId: path.basename(f) === 'Electron.lnk' ? 'second-brain' : 'other' }));
    try { ensureShortcuts(); } finally { ctx.read.mockReset(); ctx.read.mockReturnValue({ target: 'x' }); }
    const updates = ctx.write.mock.calls.filter(c => c[1] === 'update');
    expect(updates.map(c => c[0])).toEqual([path.join(pins, 'Electron.lnk')]);
    expect(updates[0]![2]).toMatchObject({ icon: path.join(ctx.base, 'icon.ico'), appUserModelId: 'second-brain' });
  });
  it('gives the stable window our icon and the launcher as relaunch command; a dev run only the icon', () => {
    expect(taskbarDetails()).toMatchObject({ appId: 'second-brain', appIconPath: path.join(ctx.base, 'icon.ico'), relaunchDisplayName: 'second-brain' });
    expect(taskbarDetails()!.relaunchCommand).toContain(`"${path.join(ctx.base, 'launch.vbs')}"`);
    ctx.release = '';
    expect(taskbarDetails()).toEqual({ appId: 'second-brain', appIconPath: path.join(ctx.base, 'icon.ico'), appIconIndex: 0 });
  });
  it('writes nothing from an isolated stable/installer test', () => {
    process.env.SB_RELEASES_ROOT = path.join(ctx.base, 'isolated');
    ensureShortcuts();
    expect(ctx.write).not.toHaveBeenCalled();
  });
});

describe('staleIcon', () => {
  it('flags no icon, a missing file and Electron\'s exe; keeps a real icon', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-icon-'));
    try {
      const ico = path.join(dir, 'icon.ico'), exe = path.join(dir, 'Electron.EXE');
      fs.writeFileSync(ico, 'i'); fs.writeFileSync(exe, 'e');
      expect([staleIcon(undefined), staleIcon(''), staleIcon(path.join(dir, 'gone.ico')), staleIcon(exe), staleIcon(ico)]).toEqual([true, true, true, true, false]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
