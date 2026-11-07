// The page's side of the phone bridge (ADR 0219): window.sbPhone (the preload's typed methods), the live status for
// Impostazioni → Telefono, and the Focus signal: whenever the chat in Focus changes (store/ui.ts focusMode), main hears
// it on focus:changed, so the bridge sends to the phone only what Focus would let through on the PC. Used by
// components/PhoneSettings.tsx, lib/phone-voice.ts and main.tsx (startPhone).
import type { PhoneStatus } from '@shared/contract/phone';
import type { PhoneBridgeApi } from '@shared/contract/phone-ipc';
import { createStore } from '../store/createStore';
import { ui } from '../store/ui';

declare global { interface Window { sbPhone?: PhoneBridgeApi } }

/** null in a page without the preload (tests, previews). */
export const phoneApi = (): PhoneBridgeApi | null => (typeof window !== 'undefined' && window.sbPhone) || null;

export const phoneStatus = createStore<PhoneStatus | null>(null);

/** Sends the Focus chat (or null) to main each time it changes, the first value included. */
export function watchFocus(read: () => string | null, subscribe: (fn: () => void) => () => void, send: (chatId: string | null) => void): () => void {
  let last: string | null | undefined;
  const check = () => { const now = read(); if (now !== last) { last = now; send(now); } };
  check();
  return subscribe(check);
}

/** The pairing code's time left as m:ss (0:00 once expired). */
export function pairLeft(expiresAt: number, now: number): string {
  const s = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** What the Telefono associato row shows: the live code, 'Codice scaduto' once it ran out, paired or not; its button
 *  (Dissocia, Associa telefono, Nuovo codice after an expired code); no pairing button in a dev instance. */
export function pairView(s: Pick<PhoneStatus, 'state' | 'paired' | 'pairing'>, now: number): { line: 'code' | 'expired' | 'paired' | 'none'; button: 'unpair' | 'start' | 'new' | null } {
  const expired = !!s.pairing && s.pairing.expiresAt <= now;
  const line = expired ? 'expired' : s.pairing ? 'code' : s.paired ? 'paired' : 'none';
  const button = s.paired ? 'unpair' : s.state === 'dev-disabled' ? null : expired ? 'new' : 'start';
  return { line, button };
}

/** The 24 hours of the quiet-hours pickers, and the default window when the user turns them on (22 → 7). */
export const PHONE_HOURS = Array.from({ length: 24 }, (_, h) => h);
export const PHONE_QUIET_DEFAULT = { from: 22, to: 7 } as const;

let started = false;
export function startPhone(): void {
  const api = phoneApi();
  if (started || !api) return;
  started = true;
  api.onChanged(s => phoneStatus.set(s));
  void api.status().then(s => phoneStatus.set(s), () => {});
  watchFocus(() => ui.get().focusMode, fn => ui.subscribe(fn), id => { void api.focusChanged(id).catch(() => {}); });
}
