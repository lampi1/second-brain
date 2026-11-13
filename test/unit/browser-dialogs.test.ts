// Issue #102: a JavaScript dialog of an agent tab is never left blocking the page nor answered twice. Covers the pure
// helpers (browser/dialogs.ts), handle_dialog's fallback to the native callback when CDP cannot answer
// (browser/actions.ts), and the tab teardown / detach / navigation paths of browser/tabs.ts (called on a fake tab).
import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { isReady: () => true, commandLine: { getSwitchValue: () => '', appendSwitch: () => {} } }, BrowserWindow: class {}, WebContentsView: class {}, screen: {}, session: {} }));
import { onceDialogCallback, settleDialog, type DialogState } from '../../src/main/browser/dialogs';
import { BrowserActions } from '../../src/main/browser/actions';
import { BrowserTabs, type Tab } from '../../src/main/browser/tabs';

const open = () => ({ type: 'alert', message: 'FUNCTION: loadMenuCounters', defaultPrompt: '', url: 'https://app.test/', at: 1 });

describe('dialog helpers', () => {
  it('runs a wrapped callback at most once and swallows its throw', () => {
    const cb = vi.fn(() => { throw new Error('gone'); });
    const onError = vi.fn();
    const once = onceDialogCallback(cb, onError);
    once(false, ''); once(true, 'x');
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(false, '');
    expect(onError).toHaveBeenCalledOnce();
  });

  it('settles a pending dialog once: Cancel answered, dialog cleared, callback dropped', () => {
    const cb = vi.fn();
    const tab: DialogState = { dialog: open(), lastDialog: null, pendingDialogCb: cb };
    expect(settleDialog(tab, 'dismissed (automation detached)')).toEqual({ answered: true, cleared: true });
    expect(cb).toHaveBeenCalledWith(false, '');
    expect(tab.dialog).toBeNull();
    expect(tab.pendingDialogCb).toBeNull();
    expect(tab.lastDialog?.result).toBe('dismissed (automation detached)');
    expect(settleDialog(tab, 'again')).toEqual({ answered: false, cleared: false });
    expect(cb).toHaveBeenCalledOnce();
  });

  it('only drops the callback of a page that is gone', () => {
    const cb = vi.fn();
    const tab: DialogState = { dialog: open(), lastDialog: null, pendingDialogCb: cb };
    expect(settleDialog(tab, 'dismissed (tab closed)', { alive: false }).answered).toBe(false);
    expect(cb).not.toHaveBeenCalled();
    expect(tab.pendingDialogCb).toBeNull();
  });
});

function fakeTab(over: Partial<Record<string, unknown>> = {}) {
  let destroyed = false;
  const tab = {
    id: 't9', group: 'chat:c', owner: 'c', dialog: open(), dialogSeq: 1, lastDialog: null, pendingDialogCb: null,
    console: [], consoleSeq: 0, downloads: [], unloadBlockedAt: 0, closedByUser: null, env: 'e',
    net: { inflight: () => 0, failuresSince: () => [] },
    wc: { isDestroyed: () => destroyed, getURL: () => 'https://app.test/', getTitle: () => 'App', isLoading: () => false, mainFrame: {} },
    cdp: { isAttached: true, send: vi.fn(async () => { throw new Error('Not attached to an active page'); }) },
    ...over,
  } as unknown as Tab;
  return { tab, destroy: () => { destroyed = true; } };
}

/** The real BrowserTabs dialog methods on a fake `this` (the class needs Electron to be constructed). */
function fakeTabs() {
  const emitTabs = vi.fn();
  const self = Object.assign(Object.create(BrowserTabs.prototype), { routineAccess: () => null }) as BrowserTabs;
  Object.assign(self, { emitTabs, setLastAction: () => {}, tabsOf: () => [], activeOf: () => null, emulate: () => {} });
  return { tabs: self, emitTabs };
}

function actions(tabs: BrowserTabs) {
  const a = new BrowserActions(tabs);
  vi.spyOn(a, 'settle').mockResolvedValue();
  vi.spyOn(a, 'loginNotice').mockResolvedValue('');
  return a;
}

describe('handle_dialog fallback', () => {
  it('answers through the native callback when CDP says "Not attached to an active page"', async () => {
    const cb = vi.fn();
    const { tab } = fakeTab({ pendingDialogCb: onceDialogCallback(cb) });
    const { tabs, emitTabs } = fakeTabs();
    const out = await actions(tabs).handleDialog(tab, true);
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(true, '');
    expect(tab.dialog).toBeNull();
    expect(tab.pendingDialogCb).toBeNull();
    expect(tab.lastDialog?.result).toBe('accepted');
    expect(emitTabs).toHaveBeenCalled();
    expect(out).toMatch(/^Accepted the alert .*answered directly/);
  });

  it('passes the prompt text and falls back when CDP is not attached at all', async () => {
    const cb = vi.fn();
    const send = vi.fn();
    const { tab } = fakeTab({ dialog: { ...open(), type: 'prompt' }, pendingDialogCb: cb, cdp: { isAttached: false, send } });
    await actions(fakeTabs().tabs).handleDialog(tab, true, 'hello');
    expect(send).not.toHaveBeenCalled();
    expect(cb).toHaveBeenCalledWith(true, 'hello');
  });

  it('answered by CDP: the native callback is spent and never runs later (teardown)', async () => {
    const cb = vi.fn();
    const send = vi.fn(async () => { tab.dialog = null; return {}; });
    const { tab } = fakeTab({ pendingDialogCb: cb, cdp: { isAttached: true, send } });
    const { tabs } = fakeTabs();
    expect(await actions(tabs).handleDialog(tab, false)).toMatch(/^Dismissed the alert/);
    expect(send).toHaveBeenCalledWith('Page.handleJavaScriptDialog', { accept: false });
    expect(tab.pendingDialogCb).toBeNull();
    (tabs as unknown as { onDetached(t: Tab): void }).onDetached(tab);
    expect(cb).not.toHaveBeenCalled();
  });

  it('a dialog Chromium no longer shows is cleared instead of blocking the agent', async () => {
    const { tab } = fakeTab({ cdp: { isAttached: true, send: vi.fn(async () => { throw new Error('No dialog is showing'); }) } });
    const out = await actions(fakeTabs().tabs).handleDialog(tab, true);
    expect(tab.dialog).toBeNull();
    expect(out).toMatch(/no longer showing/);
  });

  it('neither CDP nor a callback: a useful error, not the raw CDP text alone', async () => {
    const { tab } = fakeTab();
    await expect(actions(fakeTabs().tabs).handleDialog(tab, true)).rejects.toThrow(/Could not answer the dialog \(Not attached to an active page\)\. Reload the page/);
  });
});

describe('tab teardown, detach and navigation settle a pending dialog', () => {
  type Priv = { onDetached(t: Tab): void; dropDialog(t: Tab, r: string): boolean };

  it('CDP detach answers Cancel once and clears the dialog', () => {
    const cb = vi.fn();
    const { tab } = fakeTab({ pendingDialogCb: onceDialogCallback(cb) });
    const { tabs, emitTabs } = fakeTabs();
    vi.useFakeTimers();
    (tabs as unknown as Priv).onDetached(tab);
    (tabs as unknown as Priv).onDetached(tab);
    vi.useRealTimers();
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(false, '');
    expect(tab.dialog).toBeNull();
    expect(tab.lastDialog?.result).toBe('dismissed (automation detached)');
    expect(emitTabs).toHaveBeenCalledOnce();
  });

  it('a destroyed page only drops the callback', () => {
    const cb = vi.fn();
    const { tab, destroy } = fakeTab({ pendingDialogCb: cb });
    destroy();
    expect((fakeTabs().tabs as unknown as Priv).dropDialog(tab, 'dismissed (tab closed)')).toBe(true);
    expect(cb).not.toHaveBeenCalled();
    expect(tab.pendingDialogCb).toBeNull();
    expect(tab.dialog).toBeNull();
  });

  it('nothing pending: nothing to settle', () => {
    const { tab } = fakeTab({ dialog: null });
    expect((fakeTabs().tabs as unknown as Priv).dropDialog(tab, 'dismissed (page navigated)')).toBe(false);
  });
});
