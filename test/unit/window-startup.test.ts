// Bootstrap regression: recovery IPC must exist before the sandboxed page starts requesting its checkpoint.
import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';

const windows = vi.hoisted(() => ({ all: [] as Array<InstanceType<typeof EventEmitter> & { loadFile: ReturnType<typeof vi.fn>; webContents: EventEmitter }> }));
vi.mock('electron', () => ({
  BrowserWindow: class extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler: vi.fn(), session: { setPermissionRequestHandler: vi.fn() },
      setAudioMuted: vi.fn(), focus: vi.fn(),
    });
    loadFile = vi.fn(async () => undefined);
    constructor() { super(); windows.all.push(this); }
    isDestroyed() { return false; }
    show() { /* no native window in unit tests */ }
    showInactive() { /* no native window in unit tests */ }
  },
  screen: { getAllDisplays: () => [{ bounds: { x: 0, width: 1600 } }] },
  shell: { openExternal: vi.fn() },
}));
vi.mock('../../src/main/ipc', () => ({ isAppPage: () => true, setAppPage: vi.fn() }));
vi.mock('../../src/main/keyguard', () => ({ swallowCloseKey: vi.fn() }));
vi.mock('../../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/main/health', () => ({ recordRenderer: vi.fn() }));

import { createWindow } from '../../src/main/window';

it('can install window protection while keeping renderer recovery dormant until backend registration', async () => {
  const win = createWindow('/app/out', false);
  const fake = windows.all.at(-1)!;
  expect(fake.webContents.listenerCount('will-navigate')).toBe(1);
  expect(fake.webContents.listenerCount('will-redirect')).toBe(1);
  expect(fake.webContents.listenerCount('render-process-gone')).toBe(1);
  expect(fake.loadFile).not.toHaveBeenCalled();
  // Bootstrap owns the first navigation after registerHandlers has completed.
  await win.loadFile('/app/out/renderer/index.html');
  expect(fake.loadFile).toHaveBeenCalledTimes(1);
});

it('preserves immediate loading for existing callers', () => {
  createWindow('/app/out');
  expect(windows.all.at(-1)!.loadFile).toHaveBeenCalledTimes(1);
});
