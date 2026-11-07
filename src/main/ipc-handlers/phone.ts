// IPC handlers of the phone bridge (ADR 0219): Impostazioni → Telefono's buttons, the page's Focus (focus:changed) and
// its answer to a voice-note decode. Every call goes to the PhoneController (src/shared/contract/phone.ts) the bridge
// implements (src/main/phone/bridge.ts); until it is set (setPhoneController, by the wiring) a disabled one answers
// with state 'off'. The token travels only renderer → main on setToken and no handler ever returns it. Registered by
// registerPhoneHandlers in src/main/ipc.ts with the same sender check as every other channel; the bridge's status
// changes are forwarded to the page on PHONE_IPC.changed.
import type { IpcMainInvokeEvent } from 'electron';
import type { PhoneController, PhoneSettingsPatch, PhoneStatus } from '../../shared/contract/phone';
import { PHONE_IPC } from '../../shared/contract/phone';
import type { PhoneInvokeChannel, PhoneInvokeMap } from '../../shared/contract/phone-ipc';
import { resolveVoiceDecode } from '../phone/decode-request';

type PhoneHandler<K extends PhoneInvokeChannel> = (arg: PhoneInvokeMap[K][0], e?: IpcMainInvokeEvent) => PhoneInvokeMap[K][1] | Promise<PhoneInvokeMap[K][1]>;
export type PhoneHandlers = { [K in PhoneInvokeChannel]: PhoneHandler<K> };

const OFF_REASON = 'Il collegamento al telefono non è attivo in questa versione dell’app.';

/** The controller before the bridge is wired, or when it cannot run: status only, every action refused in Italian. */
export function disabledPhoneController(state: 'off' | 'dev-disabled' = 'off', hasToken: () => boolean = () => false): PhoneController {
  const status = (): PhoneStatus => ({ hasToken: hasToken(), enabled: false, paired: false, pairing: null, state, error: null, dropped: 0, quietHours: null, recent: [] });
  const refuse = (): never => { throw new Error(state === 'dev-disabled' ? 'Il telefono funziona solo nell’istanza stable dell’app.' : OFF_REASON); };
  return {
    status,
    setToken: async () => refuse(),
    clearToken: async () => refuse(),
    startPairing: () => refuse(),
    unpair: () => refuse(),
    update: () => refuse(),
    onChanged: () => () => {},
    setFocus: () => {},
  };
}

/** Quiet hours from the page: null, or whole hours 0-23 that differ. Anything else is refused. */
export function checkPatch(raw: unknown): PhoneSettingsPatch {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: PhoneSettingsPatch = {};
  if ('enabled' in p) {
    if (typeof p.enabled !== 'boolean') throw new Error('enabled: atteso vero o falso');
    out.enabled = p.enabled;
  }
  if ('quietHours' in p) {
    const q = p.quietHours as { from?: unknown; to?: unknown } | null;
    if (q === null) out.quietHours = null;
    else {
      const hour = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23;
      if (!q || typeof q !== 'object' || !hour(q.from) || !hour(q.to) || q.from === q.to) throw new Error('Fuori orario: due ore diverse tra 0 e 23.');
      out.quietHours = { from: q.from as number, to: q.to as number };
    }
  }
  return out;
}

/** The Focus chat id from the page: a short id or null. */
export function checkFocus(raw: unknown): string | null {
  const id = (raw as { chatId?: unknown } | null | undefined)?.chatId;
  return typeof id === 'string' && id.length > 0 && id.length <= 200 ? id : null;
}

export function phoneHandlers(controller: () => PhoneController, decoded: typeof resolveVoiceDecode = resolveVoiceDecode): PhoneHandlers {
  return {
    [PHONE_IPC.status]: () => controller().status(),
    [PHONE_IPC.setToken]: a => {
      const token = (a as { token?: unknown } | undefined)?.token;
      if (typeof token !== 'string' || !token.trim()) throw new Error('Incolla il token di BotFather.');
      return controller().setToken(token.trim());
    },
    [PHONE_IPC.clearToken]: () => controller().clearToken(),
    [PHONE_IPC.startPairing]: () => controller().startPairing(),
    [PHONE_IPC.unpair]: () => controller().unpair(),
    [PHONE_IPC.update]: a => controller().update(checkPatch(a)),
    [PHONE_IPC.focusChanged]: a => { controller().setFocus(checkFocus(a)); },
    [PHONE_IPC.decodeResult]: a => { decoded(a); },
  };
}

/** The one controller the handlers call and whose changes reach the page; swapped by the wiring when the bridge starts. */
export class PhoneIpcHub {
  private current: PhoneController;
  private off: () => void = () => {};
  private send: ((status: PhoneStatus) => void) | null = null;

  constructor(initial: PhoneController = disabledPhoneController()) { this.current = initial; }

  controller = (): PhoneController => this.current;

  /** Where PHONE_IPC.changed goes (the app window); set once by registerPhoneHandlers. */
  forwardTo(send: (status: PhoneStatus) => void): void { this.send = send; this.subscribe(); }

  set(c: PhoneController): void {
    this.off();
    this.current = c;
    this.subscribe();
    this.send?.(c.status());
  }

  private subscribe(): void {
    this.off();
    this.off = this.current.onChanged(s => this.send?.(s));
  }
}

export const phoneHub = new PhoneIpcHub();
/** The wiring hands the real bridge here (part of the integration): the page then talks to it. */
export const setPhoneController = (c: PhoneController): void => phoneHub.set(c);
