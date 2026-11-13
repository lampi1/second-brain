// The request layer (overlay.ts) has its own session: its deny-all permission handler must never replace the app
// window's on the shared default session, which grants the microphone (window.ts micAllowed). Before the fix the layer
// shared the default session and every getUserMedia was refused by the app (owner, 2026-10-24).
import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

type Handler = (wc: unknown, perm: string, cb: (ok: boolean) => void, details?: unknown) => void;
const sessions = vi.hoisted(() => new Map<string, { handler: Handler | null; setPermissionRequestHandler(h: Handler): void }>());
const sessionFor = vi.hoisted(() => (name: string) => {
  let s = sessions.get(name);
  if (!s) { const ss = { handler: null as Handler | null, setPermissionRequestHandler(h: Handler) { ss.handler = h; } }; s = ss; sessions.set(name, s); }
  return s;
});
vi.mock('electron', () => ({ WebContentsView: class {
  webContents: unknown;
  constructor(opts: { webPreferences?: { partition?: string } }) {
    this.webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn(), session: sessionFor(opts.webPreferences?.partition ?? 'default'), loadURL: vi.fn(async () => {}), isFocused: () => false, isDestroyed: () => false });
  }
  setBackgroundColor() {} setBounds() {}
} }));
vi.mock('../../src/main/ipc', () => ({ Emitter: class { emit() {} } }));
vi.mock('../../src/main/keyguard', () => ({ swallowCloseKey: () => {} }));
import { OverlayLayer } from '../../src/main/overlay';

it('starting the layer leaves the app window\'s microphone grant on the default session', () => {
  const windowHandler: Handler = (_wc, perm, cb) => cb(perm === 'media');
  sessionFor('default').setPermissionRequestHandler(windowHandler);
  const win = Object.assign(new EventEmitter(), { isDestroyed: () => false, getContentSize: () => [1280, 800], contentView: { children: [], addChildView: () => {}, removeChildView: () => {} }, webContents: { focus: () => {} } }) as unknown as BrowserWindow;
  const layer = new OverlayLayer(() => win, '/out');
  layer.start();
  expect(sessions.get('default')!.handler).toBe(windowHandler);
  let granted: boolean | null = null;
  sessions.get('default')!.handler!(null, 'media', ok => { granted = ok; }, { mediaTypes: ['audio'] });
  expect(granted).toBe(true);
  // the layer's own session refuses everything
  const own = [...sessions.entries()].find(([k]) => k !== 'default')?.[1];
  expect(own?.handler).toBeTruthy();
  own!.handler!(null, 'media', ok => { granted = ok; });
  expect(granted).toBe(false);
  layer.stop();
});
