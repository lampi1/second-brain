// Bootstrap regression: recovery IPC must exist before the sandboxed page starts requesting its checkpoint.
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it, vi } from 'vitest';

const windows = vi.hoisted(() => ({ all: [] as Array<InstanceType<typeof EventEmitter> & { loadURL: ReturnType<typeof vi.fn>; webContents: EventEmitter }> }));
vi.mock('electron', () => ({
  BrowserWindow: class extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler: vi.fn(), session: { setPermissionRequestHandler: vi.fn() },
      setAudioMuted: vi.fn(), focus: vi.fn(),
    });
    loadURL = vi.fn(async () => undefined);
    constructor() { super(); windows.all.push(this); }
    isDestroyed() { return false; }
    show = vi.fn();
    showInactive = vi.fn();
    maximize = vi.fn();
  },
  screen: { getAllDisplays: () => [{ bounds: { x: 0, width: 1600 } }] },
  shell: { openExternal: vi.fn() },
}));
vi.mock('../../src/main/ipc', () => ({ isAppPage: () => true, setAppPage: vi.fn() }));
vi.mock('../../src/main/keyguard', () => ({ swallowCloseKey: vi.fn() }));
vi.mock('../../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/main/health', () => ({ recordRenderer: vi.fn() }));

import { createWindow, splashQuery } from '../../src/main/window';

it('maximizes visible startup but preserves hidden QA geometry', () => {
  vi.stubEnv('SB_HIDDEN', '0');
  const visible = createWindow('/app/out', false);
  visible.emit('ready-to-show');
  expect(visible.maximize).toHaveBeenCalledOnce();
  expect(visible.show).toHaveBeenCalledOnce();
  vi.stubEnv('SB_HIDDEN', '1');
  const hidden = createWindow('/app/out', false);
  hidden.emit('ready-to-show');
  expect(hidden.maximize).not.toHaveBeenCalled();
  expect(hidden.show).not.toHaveBeenCalled();
  expect(hidden.showInactive).toHaveBeenCalledOnce();
  vi.unstubAllEnvs();
});

it('can install window protection while keeping renderer recovery dormant until backend registration', async () => {
  const win = createWindow('/app/out', false);
  const fake = windows.all.at(-1)!;
  expect(fake.webContents.listenerCount('will-navigate')).toBe(1);
  expect(fake.webContents.listenerCount('will-redirect')).toBe(1);
  expect(fake.webContents.listenerCount('render-process-gone')).toBe(1);
  expect(fake.loadURL).not.toHaveBeenCalled();
  // Bootstrap owns the first navigation after registerHandlers has completed.
  await win.loadURL(pathToFileURL(path.resolve('/app/out/renderer/index.html')).href);
  expect(fake.loadURL).toHaveBeenCalledTimes(1);
});

it('loads the exact encoded renderer URL from paths with spaces, percent escapes and ampersands', () => {
  vi.stubEnv('SB_SPLASH', '0');
  const out = path.resolve('/app/out space & percent%23');
  createWindow(out);
  expect(windows.all.at(-1)!.loadURL).toHaveBeenCalledExactlyOnceWith(pathToFileURL(path.join(out, 'renderer/index.html')).href);
  expect(new URL(windows.all.at(-1)!.loadURL.mock.calls[0]![0]).pathname).toContain('percent%2523');
  vi.unstubAllEnvs();
});

it('asks the opening splash only for a person opening the app', () => {
  expect(splashQuery({})).toBe('?splash=1');
  for (const env of [{ SB_HIDDEN: '1' }, { SB_TEST: '1' }, { SB_DEMO_FREEZE: '1' }, { SB_SPLASH: '0' }]) expect(splashQuery(env)).toBe('');
  // its own e2e forces it inside a hidden test run
  expect(splashQuery({ SB_HIDDEN: '1', SB_TEST: '1', SB_SPLASH: '1' })).toBe('?splash=1');
  expect(splashQuery({ SB_HIDDEN: '1', SB_SPLASH: 'hold' })).toBe('?splash=hold');
  expect(splashQuery({ SB_SPLASH: '<x>' })).toBe('?splash=1');
});
