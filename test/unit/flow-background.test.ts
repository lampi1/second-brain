// Close-to-tray is opt-in, recoverable and subordinate to explicit quit and hidden test mode.
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
vi.mock('electron', () => ({ Menu: { buildFromTemplate: (rows: unknown) => rows }, Tray: class {} }));
import { createFlowBackground } from '../../src/main/flows/background';
function setup(hidden = false) {
  const w = new EventEmitter();
  let visible = true, enabled = false;
  const methods = { isDestroyed: () => false, isMinimized: () => false, isVisible: () => visible,
    show: vi.fn(() => { visible = true; }), hide: vi.fn(() => { visible = false; }), focus: vi.fn(), restore: vi.fn() };
  Object.assign(w, methods);
  const tray = { setToolTip: vi.fn(), setContextMenu: vi.fn(), on: vi.fn(), destroy: vi.fn() };
  const createTray = vi.fn(() => tray), quit = vi.fn();
  const host = createFlowBackground({ window: w as unknown as BrowserWindow, icon: '/icon.png', enabled: () => enabled, createTray, quit, hidden });
  const close = () => { const event = { preventDefault: vi.fn() }; w.emit('close', event); return event; };
  return { host, w, methods, tray, createTray, close, quit, enable: (value: boolean) => { enabled = value; host.sync(); } };
}
describe('flow background host', () => {
  it('normal close quits; explicit background close hides and provides a way back', () => {
    const s = setup(); expect(s.close().preventDefault).not.toHaveBeenCalled();
    s.enable(true); expect(s.createTray).toHaveBeenCalledTimes(1);
    expect(s.close().preventDefault).toHaveBeenCalledOnce(); expect(s.methods.hide).toHaveBeenCalledOnce();
    s.host.show(); expect(s.methods.show).toHaveBeenCalledOnce(); expect(s.methods.focus).toHaveBeenCalledOnce();
    s.host.beforeQuit(); expect(s.close().preventDefault).not.toHaveBeenCalled(); s.host.stop(); expect(s.tray.destroy).toHaveBeenCalledOnce();
  });
  it('disabling background brings a hidden window back and destroys the tray', () => {
    const s = setup(); s.enable(true); s.close(); s.enable(false);
    expect(s.methods.show).toHaveBeenCalledOnce(); expect(s.tray.destroy).toHaveBeenCalledOnce(); s.host.stop();
  });
  it('hidden tests never display or retain a tray', () => {
    const s = setup(true); s.enable(true); s.close(); s.host.show();
    expect(s.createTray).not.toHaveBeenCalled(); expect(s.methods.hide).not.toHaveBeenCalled(); expect(s.methods.show).not.toHaveBeenCalled(); s.host.stop();
  });
  it('system shutdown takes precedence over background preference', () => {
    const s = setup(); s.enable(true); s.w.emit('query-session-end'); expect(s.close().preventDefault).not.toHaveBeenCalled(); s.host.stop();
  });
});
