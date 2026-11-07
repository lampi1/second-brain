// The phone bridge's IPC shapes (ADR 0219): each PHONE_IPC channel's argument and result, and the typed methods the
// preload exposes as window.sbPhone. Apart from src/shared/contract/phone.ts, which is the fixed interface shared by the
// bridge's parallel parts and is never edited. The phone channels are not in the main InvokeMap: main registers them
// with registerPhoneHandlers (src/main/ipc.ts), same sender check. Used by src/main/ipc-handlers/phone.ts,
// src/preload/index.ts and the renderer (components/PhoneSettings.tsx, lib/phone-voice.ts, lib/phone-focus.ts).
import { PHONE_IPC, type PhoneDecodeRequest, type PhoneDecodeResult, type PhoneSettingsPatch, type PhoneStatus } from './phone';

/** renderer → main (invoke): [argument, result]. The token goes only in, on setToken; no result ever carries it. */
export interface PhoneInvokeMap {
  [PHONE_IPC.status]: [void, PhoneStatus];
  [PHONE_IPC.setToken]: [{ token: string }, PhoneStatus];
  [PHONE_IPC.clearToken]: [void, PhoneStatus];
  [PHONE_IPC.startPairing]: [void, PhoneStatus];
  [PHONE_IPC.unpair]: [void, PhoneStatus];
  [PHONE_IPC.update]: [PhoneSettingsPatch, PhoneStatus];
  [PHONE_IPC.focusChanged]: [{ chatId: string | null }, void];
  [PHONE_IPC.decodeResult]: [PhoneDecodeResult, void];
}
export type PhoneInvokeChannel = keyof PhoneInvokeMap;

/** main → renderer. */
export interface PhoneEventMap {
  [PHONE_IPC.changed]: PhoneStatus;
  [PHONE_IPC.decodeRequest]: PhoneDecodeRequest;
}
export type PhoneEventChannel = keyof PhoneEventMap;

export const PHONE_INVOKE_CHANNELS = [
  PHONE_IPC.status, PHONE_IPC.setToken, PHONE_IPC.clearToken, PHONE_IPC.startPairing, PHONE_IPC.unpair, PHONE_IPC.update,
  PHONE_IPC.focusChanged, PHONE_IPC.decodeResult,
] as const satisfies readonly PhoneInvokeChannel[];
export const PHONE_EVENT_CHANNELS = [PHONE_IPC.changed, PHONE_IPC.decodeRequest] as const satisfies readonly PhoneEventChannel[];

// Compile error if a channel is added to a map but not to its runtime list.
const _phoneInvokeComplete: Exclude<PhoneInvokeChannel, (typeof PHONE_INVOKE_CHANNELS)[number]> extends never ? true : never = true;
const _phoneEventComplete: Exclude<PhoneEventChannel, (typeof PHONE_EVENT_CHANNELS)[number]> extends never ? true : never = true;
void _phoneInvokeComplete; void _phoneEventComplete;

/** What the preload exposes as window.sbPhone: one typed method per channel. */
export interface PhoneBridgeApi {
  status(): Promise<PhoneStatus>;
  setToken(token: string): Promise<PhoneStatus>;
  clearToken(): Promise<PhoneStatus>;
  startPairing(): Promise<PhoneStatus>;
  unpair(): Promise<PhoneStatus>;
  update(patch: PhoneSettingsPatch): Promise<PhoneStatus>;
  focusChanged(chatId: string | null): Promise<void>;
  decodeResult(result: PhoneDecodeResult): Promise<void>;
  onChanged(fn: (status: PhoneStatus) => void): () => void;
  onDecodeRequest(fn: (request: PhoneDecodeRequest) => void): () => void;
}
