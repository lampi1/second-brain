// Decodes the phone bridge's voice notes in the page (ADR 0219): main sends a Telegram voice note's bytes (OGG/Opus) on
// PHONE_IPC.decodeRequest; WebAudio decodes it straight at 16 kHz (an OfflineAudioContext at that rate resamples, the
// same way the recordings' import does in lib/recorder.ts), the channels are mixed to mono and the page answers with a
// PCM16 WAV on decodeResult. No recording is made (never rec:start), nothing is stored here: main transcribes it on the
// PC. Notes over 5 minutes or 20 MB are refused. Started once by main.tsx.
import { REC_RATE } from '@shared/recordings';
import type { PhoneDecodeRequest, PhoneDecodeResult } from '@shared/contract/phone';
import { PHONE_VOICE_MAX_MS, encodeWav, mixdown } from './phone-wav';
import { resampler } from './recorder';
import { phoneApi } from './phone';

const MAX_BYTES = 20 * 1024 ** 2;

/** Decodes one request into its answer; never throws (an error goes back to main as text). */
export async function decodeVoiceNote(req: PhoneDecodeRequest, decode: (bytes: ArrayBuffer) => Promise<AudioBuffer> = defaultDecode): Promise<PhoneDecodeResult> {
  try {
    const bytes = req.bytes;
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength) return { id: req.id, error: 'empty voice note' };
    if (bytes.byteLength > MAX_BYTES) return { id: req.id, error: 'voice note over 20 MB' };
    const buf = await decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    if ((buf.length / buf.sampleRate) * 1000 > PHONE_VOICE_MAX_MS) return { id: req.id, error: 'voice note over 5 minutes' };
    let mono = mixdown(Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c)));
    // decodeAudioData already gives the context's rate; another rate (a decoder that ignores it) is brought down here
    if (buf.sampleRate > REC_RATE) mono = resampler(buf.sampleRate / REC_RATE)(mono);
    return { id: req.id, wav: encodeWav(mono) };
  } catch (e) {
    return { id: req.id, error: `decoding failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) };
  }
}

const defaultDecode = (bytes: ArrayBuffer): Promise<AudioBuffer> => new OfflineAudioContext(1, 1, REC_RATE).decodeAudioData(bytes);

let wired = false;
export function startPhoneVoice(): void {
  const api = phoneApi();
  if (wired || !api) return;
  wired = true;
  api.onDecodeRequest(req => { void decodeVoiceNote(req).then(r => api.decodeResult(r)).catch(() => {}); });
}
