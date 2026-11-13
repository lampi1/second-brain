// The only bridge between the page and the main process: contextIsolation + sandbox on, no Node in the page.
// It exposes exactly the channels of the shared contract (an allow-list), nothing else: window.sb for the main
// contract, window.sbPhone for the phone bridge's channels only (ADR 0219, src/shared/contract/phone-ipc.ts).
import { contextBridge, ipcRenderer } from 'electron';
import { EVENT_CHANNELS, INVOKE_CHANNELS, type Bridge, type EventChannel, type InvokeChannel } from '../shared/contract';
import { PHONE_IPC } from '../shared/contract/phone';
import type { PhoneBridgeApi } from '../shared/contract/phone-ipc';

const invokeOk = new Set<string>(INVOKE_CHANNELS);
const eventOk = new Set<string>(EVENT_CHANNELS);

const bridge: Bridge = {
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

const listen = <T>(channel: string, fn: (payload: T) => void): (() => void) => {
  const listener = (_e: Electron.IpcRendererEvent, payload: T) => fn(payload);
  ipcRenderer.on(channel, listener);
  return () => { ipcRenderer.removeListener(channel, listener); };
};

// fixed channels only: the page cannot name another one
const phone: PhoneBridgeApi = {
  status: () => ipcRenderer.invoke(PHONE_IPC.status),
  setToken: token => ipcRenderer.invoke(PHONE_IPC.setToken, { token }),
  clearToken: () => ipcRenderer.invoke(PHONE_IPC.clearToken),
  startPairing: () => ipcRenderer.invoke(PHONE_IPC.startPairing),
  unpair: () => ipcRenderer.invoke(PHONE_IPC.unpair),
  update: patch => ipcRenderer.invoke(PHONE_IPC.update, patch),
  focusChanged: chatId => ipcRenderer.invoke(PHONE_IPC.focusChanged, { chatId }),
  decodeResult: result => ipcRenderer.invoke(PHONE_IPC.decodeResult, result),
  onChanged: fn => listen(PHONE_IPC.changed, fn),
  onDecodeRequest: fn => listen(PHONE_IPC.decodeRequest, fn),
};

contextBridge.exposeInMainWorld('sb', bridge);
contextBridge.exposeInMainWorld('sbPhone', phone);
