// Main's wiring of the Telegram phone bridge (ADR 0219, design brain tmp/phone-telegram-plan.md §4 §8 §10): builds the
// real PhoneBridgeDeps (token store, fetch, userData paths, the renderer's voice decode, the local voice engine,
// presence) and the urgent sources (budget at 100 %, a /urgente launched in a chat), so index.ts only creates, starts
// and stops it. Only the stable instance polls api.telegram.org; the dev instance gets a fake server only from
// SB_PHONE_TEST_API, and only a loopback http://127.0.0.1|localhost:<port>; the variable is ignored in the stable one.
// Kept free of Electron imports (every external piece is injected) so test/unit/phone/wiring.test.ts runs it in Node.
// Used by src/main/index.ts.
import path from 'node:path';
import type { BudgetAlert, ChatItem, EventChannel, EventMap } from '../../shared/contract';
import type { PhonePort } from '../../shared/contract/phone';
import { createPhoneBridge, type PhoneBridge } from './bridge';
import type { PhoneBridgeDeps, PhoneLog, PhoneTiming } from './types';

/** user input this recent (seconds) counts as «at the PC» (design §8) */
export const AT_PC_IDLE_S = 5 * 60;
const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}\/?$/;

/** The fake Telegram server of the dev instance and the e2e: never in the stable one, never anything but loopback. */
export function phoneTestApi(isStable: boolean, env: Record<string, string | undefined>): string | undefined {
  if (isStable) return undefined;
  const v = env.SB_PHONE_TEST_API?.trim();
  return v && LOOPBACK.test(v) ? v.replace(/\/$/, '') : undefined;
}

/** What the local voice engine offers the phone (voice/service.ts VoiceService, structural). */
export interface PhoneVoice {
  state(): { ready: { vad: boolean; asr: boolean } };
  transcribe(wav: string, progress: (done: number) => void): { result: Promise<{ lines: { text: string }[]; error?: string }> };
}

export interface AppPhoneDeps {
  userData: string;
  isStable: boolean;
  env: Record<string, string | undefined>;
  port: PhonePort;
  token: { get(): string | null; set(token: string): void; clear(): void };
  /** the renderer decodes the OGG/Opus note to a 16 kHz WAV (decode-request.ts requestVoiceDecode on the app window) */
  decodeVoice(bytes: Uint8Array): Promise<Uint8Array>;
  voice: PhoneVoice;
  /** the app window is focused and visible */
  windowActive(): boolean;
  /** seconds since the last keyboard or mouse input on the PC (Electron powerMonitor.getSystemIdleTime) */
  idleSeconds(): number;
  /** Modalità notte (ADR 0191: settings awayMode) */
  nightMode(): boolean;
  addRedaction(secret: string): void;
  log: PhoneLog;
  fetch?: typeof fetch;
  now?: () => number;
  timing?: Partial<PhoneTiming>;
}

/** The local voice engine on a WAV path; null when its models are not on disk (the phone then asks for text). */
export async function transcribeForPhone(voice: PhoneVoice, wavPath: string): Promise<string | null> {
  const r = voice.state().ready;
  if (!r.asr || !r.vad) return null;
  const out = await voice.transcribe(wavPath, () => {}).result;
  if (out.error) throw new Error(out.error);
  return out.lines.map(l => l.text.trim()).filter(Boolean).join(' ');
}

/** «At the PC» (design §8): the app window active, or keyboard/mouse input in the last 5 minutes; plus Modalità notte. */
export function phonePresence(d: Pick<AppPhoneDeps, 'windowActive' | 'idleSeconds' | 'nightMode'>): PhoneBridgeDeps['presence'] {
  return () => {
    let idle = Infinity;
    try { idle = d.idleSeconds(); } catch { /* unknown: not at the PC unless the window is active */ }
    return { atPc: d.windowActive() || idle < AT_PC_IDLE_S, nightMode: d.nightMode() };
  };
}

export function createAppPhone(d: AppPhoneDeps): PhoneBridge {
  const testApiBase = phoneTestApi(d.isStable, d.env);
  const deps: PhoneBridgeDeps = {
    fetch: d.fetch ?? fetch,
    getToken: () => d.token.get(),
    saveToken: async t => { d.token.set(t); },
    deleteToken: async () => { d.token.clear(); },
    statePath: path.join(d.userData, 'phone-state.json'),
    now: d.now ?? Date.now,
    phonePort: d.port,
    decodeVoice: b => d.decodeVoice(b),
    transcribe: wav => transcribeForPhone(d.voice, wav),
    tempDir: path.join(d.userData, 'phone-tmp'),
    presence: phonePresence(d),
    isStable: d.isStable,
    ...(testApiBase ? { testApiBase } : {}),
    addRedaction: d.addRedaction,
    log: d.log,
    ...(d.timing ? { timing: d.timing } : {}),
  };
  return createPhoneBridge(deps);
}

const SCOPE: Record<BudgetAlert['scope'], string> = { day: 'oggi', chat: 'una chat', fiveHour: 'finestra di 5 ore', week: 'settimana' };
const URGENTE = /^\s*\/urgente\b/i;
/** the user typed into the chat (chat:send) this recently: an engine replaying an old chat's history is not a new /urgente */
export const TYPED_WINDOW_MS = 15_000;

/** The urgent sources (design §8: always sent, with sound): a budget alert at 100 % and a /urgente the user typed in a
 *  chat. Texts are neutral (never a chat title, never the message): the phone learns that, not what. */
export function urgentSources(bridge: Pick<PhoneBridge, 'notifyUrgent'>, chats: () => { id: string; isOrchestrator: boolean; agent?: { name?: string } | null }[],
  typedAt: (chatId: string) => number | undefined, now: () => number = Date.now) {
  return <K extends EventChannel>(channel: K, payload: EventMap[K]): void => {
    if (channel === 'budget:alert') {
      const a = payload as BudgetAlert;
      if (a.threshold !== 100) return;
      void bridge.notifyUrgent('budget', `Limite di spesa raggiunto (${SCOPE[a.scope] ?? a.scope}, ${Math.round(a.pct)} %): guarda sul PC.`).catch(() => undefined);
    } else if (channel === 'chat:item') {
      const p = payload as EventMap['chat:item'];
      const item = p.item as ChatItem;
      // only a fresh message the user just typed on the PC (a replace is a repaint; a phone one the phone already knows;
      // an engine replaying an old chat's history comes without a recent chat:send)
      if (p.replace || item.kind !== 'user' || item.from || item.via === 'phone' || !URGENTE.test(item.text)) return;
      const typed = typedAt(p.chatId);
      if (typed === undefined || now() - typed > TYPED_WINDOW_MS) return;
      const c = chats().find(x => x.id === p.chatId);
      const who = c?.isOrchestrator ? 'Orchestrator' : c?.agent?.name ?? 'una chat';
      void bridge.notifyUrgent('urgente', `Triage /urgente avviato al PC (${who}).`).catch(() => undefined);
    }
  };
}
