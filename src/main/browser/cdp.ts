// Chrome DevTools Protocol session of one agent tab (webContents.debugger): trusted input (Input.*), JavaScript dialogs
// (Page.javascriptDialogOpening / handleJavaScriptDialog), network capture (Network.*) and full-page screenshots.
// Cross-origin iframes run in their own renderer process: Target.setAutoAttach (flatten) gives each one a child
// session, where Network is enabled too (waitForDebuggerOnStart so no early request is missed; the frame is always
// resumed). If something detaches the debugger (e.g. DevTools opened on the tab) it re-attaches. Used by browser/tabs.ts.
import type { WebContents } from 'electron';
import { log, errText } from '../log';

export type CdpEvent = (method: string, params: Record<string, unknown>, sessionId: string) => void;

const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true };

export class TabCdp {
  private attached = false;
  private disposed = false;
  readonly children = new Map<string, { type: string; url: string }>();

  constructor(private readonly wc: WebContents, private readonly onEvent: CdpEvent, private readonly label: string, private readonly onDetached: () => void = () => {}) {}

  get isAttached(): boolean { return this.attached; }

  async attach(): Promise<void> {
    if (this.attached || this.disposed || this.wc.isDestroyed()) return;
    const dbg = this.wc.debugger;
    try {
      if (!dbg.isAttached()) dbg.attach('1.3');
    } catch (e) {
      log.warn('browser', 'CDP attach failed', { cause: errText(e), data: { tab: this.label }, hint: 'dialogs, network capture and trusted input will not work on this tab; close DevTools on it or reopen the tab' });
      return;
    }
    this.attached = true;
    dbg.removeListener('message', this.onMessage);
    dbg.removeListener('detach', this.onDetach);
    dbg.on('message', this.onMessage);
    dbg.on('detach', this.onDetach);
    const steps: Array<[string, Record<string, unknown>]> = [
      ['Page.enable', {}],
      ['Network.enable', { maxPostDataSize: 65536 }],
      ['Emulation.setFocusEmulationEnabled', { enabled: true }],
      ['Target.setAutoAttach', AUTO_ATTACH],
    ];
    for (const [m, p] of steps) {
      try { await dbg.sendCommand(m, p); } catch (e) { log.warn('browser', `CDP ${m} failed`, { cause: errText(e), data: { tab: this.label } }); }
    }
  }

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    if (!this.attached || this.wc.isDestroyed()) return Promise.reject(new Error('the tab is not under automation (CDP detached): close DevTools on it or open a new tab'));
    return this.wc.debugger.sendCommand(method, params, sessionId) as Promise<T>;
  }

  dispose(): void {
    this.disposed = true;
    this.attached = false;
    try { if (!this.wc.isDestroyed() && this.wc.debugger.isAttached()) this.wc.debugger.detach(); } catch { /* gone */ }
  }

  private onMessage = (_e: unknown, method: string, params: Record<string, unknown>, sessionId?: string): void => {
    if (method === 'Target.attachedToTarget') {
      const sid = String(params.sessionId ?? '');
      const info = (params.targetInfo ?? {}) as { type?: string; url?: string };
      this.children.set(sid, { type: String(info.type ?? ''), url: String(info.url ?? '') });
      void this.initChild(sid);
    } else if (method === 'Target.detachedFromTarget') {
      this.children.delete(String(params.sessionId ?? ''));
    }
    try { this.onEvent(method, params, sessionId ?? ''); } catch (e) { log.warn('browser', 'CDP event handler failed', { cause: errText(e), data: { method } }); }
  };

  private async initChild(sid: string): Promise<void> {
    const dbg = this.wc.debugger;
    try {
      await Promise.all([
        dbg.sendCommand('Network.enable', { maxPostDataSize: 65536 }, sid),
        dbg.sendCommand('Target.setAutoAttach', AUTO_ATTACH, sid),
      ]);
    } catch (e) {
      log.debug('browser', 'CDP child init failed', { data: { tab: this.label, cause: errText(e) } });
    } finally {
      await dbg.sendCommand('Runtime.runIfWaitingForDebugger', {}, sid).catch(() => {});
    }
  }

  private onDetach = (_e: unknown, reason: string): void => {
    this.attached = false;
    this.children.clear();
    try { this.onDetached(); } catch { /* best effort */ }
    if (this.disposed || this.wc.isDestroyed() || reason === 'target closed') return;
    log.warn('browser', 'CDP detached, re-attaching', { data: { tab: this.label, reason } });
    setTimeout(() => { void this.attach(); }, 500);
  };
}
