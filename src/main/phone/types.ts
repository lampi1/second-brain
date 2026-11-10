// Types of the Telegram phone bridge that live only in main: the subset of the Telegram Bot API the bridge reads, the
// injected dependencies of createPhoneBridge (PhoneBridgeDeps: everything external, so every module is unit-tested
// against a fake Telegram server) and the small logger shape. The shared shapes (PhoneStatus, PhonePort, …) stay in
// src/shared/contract/phone.ts, which is a fixed copy and is never edited here.
// Used by every module in src/main/phone/ and by the integrator that builds the deps (wiring.ts).
import type { PhonePort } from '../../shared/contract/phone';

// ── Telegram Bot API (only the fields the bridge reads) ────────────────────────────────────────────────────────────
export interface TgUser { id: number; is_bot?: boolean; first_name?: string; username?: string }
export interface TgChat { id: number; type: string }
export interface TgVoice { file_id: string; duration: number; file_size?: number; mime_type?: string }
export interface TgMessage {
  message_id: number;
  /** unix seconds */
  date: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  /** the message this one replies to (only its id is read: buttons.ts textAnswer) */
  reply_to_message?: { message_id: number };
  voice?: TgVoice;
  audio?: TgVoice;
}
export interface TgCallbackQuery { id: string; from: TgUser; message?: TgMessage; data?: string }
export interface TgUpdate { update_id: number; message?: TgMessage; callback_query?: TgCallbackQuery; [other: string]: unknown }
export interface TgFile { file_id: string; file_size?: number; file_path?: string }
export interface InlineButton { text: string; callback_data: string }
export interface InlineKeyboard { inline_keyboard: InlineButton[][] }

// ── logger ─────────────────────────────────────────────────────────────────────────────────────────────────────────
type LogExtra = { data?: unknown; cause?: string; hint?: string };
/** The part of src/main/log.ts the bridge uses (scope 'phone'); error always carries cause and hint. */
export interface PhoneLog {
  debug(scope: string, msg: string, extra?: LogExtra): void;
  info(scope: string, msg: string, extra?: LogExtra): void;
  warn(scope: string, msg: string, extra?: LogExtra): void;
  error(scope: string, msg: string, extra: LogExtra & { cause: string; hint: string }): void;
}

// ── bot token shape: the one definition (token-store.ts and bridge.ts check it, filter.ts masks it in text) ─────────
const BOT_ID = '\\d{5,16}';
/** A whole BotFather token: "<bot id>:<secret>". */
export const BOT_TOKEN_SHAPE = new RegExp(`^${BOT_ID}:[A-Za-z0-9_-]{30,64}$`);
/** A bot token inside a text (global: use with replace). */
export const BOT_TOKEN_IN_TEXT = new RegExp(`\\b${BOT_ID}:[A-Za-z0-9_-]{30,}`, 'g');

/** What the urgent channel carries: always sent, with sound, also at night and in Focus (design §8). */
export type UrgentKind = 'production' | 'urgente' | 'budget';

/** Everything external the bridge needs; the integrator builds it in wiring.ts. */
export interface PhoneBridgeDeps {
  /** global fetch (tests pass the real one against the fake server) */
  fetch: typeof fetch;
  /** the bot token from its encrypted slot (token-store.ts), null when none */
  getToken(): string | null;
  /** stores a new token in the encrypted slot (token-store.ts) */
  saveToken(token: string): Promise<void>;
  /** deletes the stored token (token-store.ts) */
  deleteToken(): Promise<void>;
  /** <userData>/phone-state.json */
  statePath: string;
  now(): number;
  phonePort: PhonePort;
  /** decodes a Telegram voice note (OGG/Opus, …) to a 16 kHz mono PCM WAV (the renderer does it, decode-request.ts) */
  decodeVoice(bytes: Uint8Array): Promise<Uint8Array>;
  /** transcribes a WAV file with the local voice engine; null = the voice models are not installed */
  transcribe(wavPath: string): Promise<string | null>;
  /** folder for the temporary WAV (deleted right after the transcription) */
  tempDir: string;
  /** where the user is: at the PC (window active or input in the last 5 min) and Modalità notte */
  presence(): { atPc: boolean; nightMode: boolean };
  /** only the stable instance polls Telegram (two pollers on one token fight with 409) */
  isStable: boolean;
  /** tests and the dev e2e only: a fake Telegram server on http://127.0.0.1:<port> or http://localhost:<port> */
  testApiBase?: string;
  /** src/main/log.ts addRedaction: the token's exact value never reaches a log line */
  addRedaction(secret: string): void;
  log: PhoneLog;
  /** test knobs; production leaves them out */
  timing?: Partial<PhoneTiming>;
}

export interface PhoneTiming {
  /** gap between two outgoing messages (Telegram: ~1 message/s per chat) */
  sendGapMs: number;
  /** getUpdates long-polling timeout, seconds */
  pollTimeoutS: number;
  /** first and maximum wait after a failed poll */
  backoffMs: number;
  backoffMaxMs: number;
  /** how often the bridge re-checks waiting questions and the night-mode return */
  tickMs: number;
  /** the longest wait for a 429's retry_after */
  maxRetryAfterMs: number;
}

export const DEFAULT_TIMING: PhoneTiming = {
  sendGapMs: 1000,
  pollTimeoutS: 50,
  backoffMs: 1000,
  backoffMaxMs: 60_000,
  tickMs: 30_000,
  maxRetryAfterMs: 120_000,
};
