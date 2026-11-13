// Pure audio helpers of the phone bridge's voice notes (ADR 0219), apart from the WebAudio code so the unit tests run
// them in Node: mix a decoded buffer's channels to mono, bring it to 16 kHz with the recorder's resampler
// (lib/recorder.ts, the same one the call recordings use), and write a PCM16 WAV with the recordings' header
// (shared/recordings.ts wavHeader). Used by lib/phone-voice.ts.
import { REC_RATE, wavHeader } from '@shared/recordings';

/** At most this much audio from the phone (the bridge refuses longer notes before downloading them). */
export const PHONE_VOICE_MAX_MS = 5 * 60 * 1000;

const toInt16 = (x: number) => Math.max(-32768, Math.min(32767, Math.round(x * 32767)));

/** The mean of the channels, sample by sample. */
export function mixdown(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0]!;
  const n = Math.min(...channels.map(c => c.length));
  const out = new Float32Array(Math.max(0, n));
  for (let i = 0; i < out.length; i++) { let v = 0; for (const c of channels) v += c[i]!; out[i] = v / channels.length; }
  return out;
}

/** 16 kHz mono samples → a whole PCM 16-bit WAV file. */
export function encodeWav(samples: Float32Array, rate = REC_RATE): Uint8Array {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) pcm[i] = toInt16(samples[i]!);
  const out = new Uint8Array(44 + pcm.byteLength);
  out.set(wavHeader(pcm.byteLength, 1, rate), 0);
  out.set(new Uint8Array(pcm.buffer), 44);
  return out;
}
