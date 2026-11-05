// Asks the app's page to decode a Telegram voice note (ADR 0219). Main has no audio decoder; the renderer has WebAudio
// (decodeAudioData), which reads OGG/Opus. Main sends the bytes on PHONE_IPC.decodeRequest with a fresh id; the page
// answers with a 16 kHz mono PCM16 WAV (or an error) on PHONE_IPC.decodeResult, which ipc-handlers/phone.ts hands to
// resolveVoiceDecode. Nothing here records or stores audio: the bridge writes the WAV to a temporary file for the local
// transcription and deletes it. Used by the phone bridge (src/main/phone/bridge.ts) and ipc-handlers/phone.ts.
import crypto from 'node:crypto';
import { PHONE_IPC, type PhoneDecodeRequest, type PhoneDecodeResult } from '../../shared/contract/phone';

/** Telegram's own cap on a bot download. */
export const PHONE_VOICE_MAX_BYTES = 20 * 1024 ** 2;
export const PHONE_DECODE_TIMEOUT_MS = 60_000;

/** Where the request goes: the app window's webContents (null when the window is gone). */
export interface DecodeSender { send(channel: string, payload: PhoneDecodeRequest): void; isDestroyed?(): boolean }

interface Waiting { resolve: (wav: Uint8Array) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }

export class VoiceDecodeRequests {
  private readonly waiting = new Map<string, Waiting>();

  constructor(private readonly newId: () => string = () => crypto.randomUUID()) {}

  /** Resolves with the WAV bytes; rejects on no window, too big, the page's error or no answer within timeoutMs. */
  request(sender: DecodeSender | null, bytes: Uint8Array, timeoutMs = PHONE_DECODE_TIMEOUT_MS): Promise<Uint8Array> {
    if (!sender || sender.isDestroyed?.()) return Promise.reject(new Error('the app window is closed: no voice decoding'));
    if (!bytes.byteLength) return Promise.reject(new Error('empty voice note'));
    if (bytes.byteLength > PHONE_VOICE_MAX_BYTES) return Promise.reject(new Error('voice note over 20 MB'));
    const id = this.newId();
    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(id); reject(new Error(`voice decoding timed out after ${timeoutMs} ms`)); }, timeoutMs);
      this.waiting.set(id, { resolve, reject, timer });
      try { sender.send(PHONE_IPC.decodeRequest, { id, bytes }); }
      catch (e) { clearTimeout(timer); this.waiting.delete(id); reject(e instanceof Error ? e : new Error(String(e))); }
    });
  }

  /** The page's answer. false = unknown or late id (ignored). */
  resolve(result: PhoneDecodeResult | null | undefined): boolean {
    const id = typeof result?.id === 'string' ? result.id : '';
    const w = this.waiting.get(id);
    if (!w) return false;
    this.waiting.delete(id);
    clearTimeout(w.timer);
    const wav = result?.wav;
    if (wav instanceof Uint8Array && wav.byteLength > 44 && !result?.error) w.resolve(wav);
    else w.reject(new Error(typeof result?.error === 'string' && result.error ? result.error.slice(0, 300) : 'the page returned no audio'));
    return true;
  }

  /** How many requests wait for the page (tests, diagnostics). */
  get pending(): number { return this.waiting.size; }
}

const shared = new VoiceDecodeRequests();
/** Decode one voice note in the app's page: see VoiceDecodeRequests.request. */
export const requestVoiceDecode = (sender: DecodeSender | null, bytes: Uint8Array, timeoutMs = PHONE_DECODE_TIMEOUT_MS): Promise<Uint8Array> => shared.request(sender, bytes, timeoutMs);
export const resolveVoiceDecode = (result: PhoneDecodeResult | null | undefined): boolean => shared.resolve(result);
