// Typed IPC on the main side: one handler per invoke channel of the contract, events pushed to the app window.
// Every invoke is checked: it must come from the app's own page (our file:// renderer, top frame), never from a
// browser tab or an injected frame.
import { ipcMain, type WebContents, type IpcMainInvokeEvent } from 'electron';
import { INVOKE_CHANNELS, type EventChannel, type EventMap, type InvokeArg, type InvokeChannel, type InvokeResult } from '../shared/contract';

type Handler<K extends InvokeChannel> = (arg: InvokeArg<K>, e: IpcMainInvokeEvent) => InvokeResult<K> | Promise<InvokeResult<K>>;
export type Handlers = { [K in InvokeChannel]: Handler<K> };

export function isAppSender(e: IpcMainInvokeEvent, app: WebContents | null): boolean {
  if (!app || e.sender !== app) return false;
  const url = e.senderFrame?.url ?? '';
  return e.senderFrame === e.sender.mainFrame && url.startsWith('file://');
}

export function registerHandlers(handlers: Handlers, appContents: () => WebContents | null): void {
  for (const ch of INVOKE_CHANNELS) {
    ipcMain.removeHandler(ch);
    ipcMain.handle(ch, async (e, arg) => {
      if (!isAppSender(e, appContents())) throw new Error('forbidden sender');
      return (handlers[ch] as Handler<typeof ch>)(arg as never, e);
    });
  }
}

export class Emitter {
  constructor(private target: () => WebContents | null) {}
  emit<K extends EventChannel>(channel: K, payload: EventMap[K]): void {
    const wc = this.target();
    if (wc && !wc.isDestroyed()) wc.send(channel, payload);
  }
}
