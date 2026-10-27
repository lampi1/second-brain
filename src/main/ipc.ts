// Typed IPC on the main side: one handler per invoke channel of the contract, events pushed to the app window.
// Every invoke is checked: it must come from the app's own page (our file:// renderer, top frame), never from a
// browser tab or an injected frame.
import { ipcMain, type WebContents, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INVOKE_CHANNELS, type EventChannel, type EventMap, type InvokeArg, type InvokeChannel, type InvokeResult } from '../shared/contract';
import { updateActivity } from './update/activity';
import { timedStep } from './perf';

type Handler<K extends InvokeChannel> = (arg: InvokeArg<K>, e: IpcMainInvokeEvent) => InvokeResult<K> | Promise<InvokeResult<K>>;
export type Handlers = { [K in InvokeChannel]: Handler<K> };

/** The exact file:// URL of our renderer page (out/renderer/index.html), set by window.ts. Any other file:// page —
 *  e.g. one reached through an injected link (UNC //host/x.html) — is never an app sender (review 2026-10-11). */
let appPage: string | null = null;
// compared as real file paths, not as URL strings: Chromium may report the same file with another spelling (8.3 short
// names like ABCDE~1, drive-letter case, percent-encoding) — the stable-copy test caught a strict string compare
// refusing the app's own page (2026-10-11)
const fileKey = (url: string): string | null => {
  try {
    if (!url.startsWith('file:')) return null;
    const p = fileURLToPath(url.split('#')[0]!.split('?')[0]!);
    let real = p;
    try { real = fs.realpathSync.native(p); } catch { /* not on disk */ }
    return path.resolve(real).toLowerCase();
  } catch { return null; }
};
export const setAppPage = (url: string): void => { appPage = fileKey(url); };
export const isAppPage = (url: string): boolean => !!appPage && fileKey(url) === appPage;

export function isAppSender(e: IpcMainInvokeEvent, app: WebContents | null): boolean {
  if (!app || e.sender !== app) return false;
  const url = e.senderFrame?.url ?? '';
  return e.senderFrame === e.sender.mainFrame && isAppPage(url);
}

/** A second page of ours allowed on a few channels only (the global request layer: overlay:* channels). */
export interface ExtraSender { contents: () => WebContents | null; channels: readonly InvokeChannel[] }

export function registerHandlers(handlers: Handlers, appContents: () => WebContents | null, extra?: ExtraSender): void {
  for (const ch of INVOKE_CHANNELS) {
    ipcMain.removeHandler(ch);
    ipcMain.handle(ch, async (e, arg) => {
      const ok = isAppSender(e, appContents()) || (!!extra && extra.channels.includes(ch) && isAppSender(e, extra.contents()));
      if (!ok) throw new Error('forbidden sender');
      const invoke = () => (handlers[ch] as Handler<typeof ch>)(arg as never, e);
      // the handler's synchronous part is one main-process step (perf.ts): a frozen window names the channel
      return timedStep(`ipc ${ch}`, () => updateActivity.tracks(ch) ? updateActivity.run(invoke) : invoke());
    });
  }
}

/** A main-side listener of every event sent to a window (the Log's journal, main/activity/wiring.ts). */
export type EmitTap = <K extends EventChannel>(channel: K, payload: EventMap[K]) => void;

export class Emitter {
  private readonly taps: EmitTap[] = [];
  constructor(private target: () => WebContents | null) {}
  /** Sees every event, before the window; a tap that throws never stops the event. */
  tap(fn: EmitTap): void { this.taps.push(fn); }
  emit<K extends EventChannel>(channel: K, payload: EventMap[K]): void { timedStep(`emit ${channel}`, () => this.send(channel, payload)); }
  private send<K extends EventChannel>(channel: K, payload: EventMap[K]): void {
    for (const fn of this.taps) try { fn(channel, payload); } catch { /* the log never breaks the app */ }
    if (channel === 'ui:command' && updateActivity.frozen) return;
    const wc = this.target();
    if (wc && !wc.isDestroyed()) wc.send(channel, payload);
  }
}
