// The only bridge between the page and the main process: contextIsolation + sandbox on, no Node in the page.
// It exposes exactly the channels of the shared contract (an allow-list), nothing else.
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { EVENT_CHANNELS, INVOKE_CHANNELS, type Bridge, type EventChannel, type InvokeChannel } from '../shared/contract';

const invokeOk = new Set<string>(INVOKE_CHANNELS);
const eventOk = new Set<string>(EVENT_CHANNELS);

const bridge: Bridge = {
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  invoke(channel: InvokeChannel, arg: unknown) {
    if (!invokeOk.has(channel)) return Promise.reject(new Error(`channel not allowed: ${channel}`));
    return ipcRenderer.invoke(channel, arg);
  },
  on(channel: EventChannel, fn: (payload: never) => void) {
    if (!eventOk.has(channel)) throw new Error(`event not allowed: ${channel}`);
    const listener = (_e: Electron.IpcRendererEvent, ...args: unknown[]) => fn(args[0] as never);
    ipcRenderer.on(channel, listener);
    return () => { ipcRenderer.removeListener(channel, listener); };
  },
} as Bridge;

contextBridge.exposeInMainWorld('sb', bridge);
