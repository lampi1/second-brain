// The phone bridge's voice notes in the page (ADR 0219, src/renderer/lib/phone-wav.ts and phone-voice.ts): mixdown,
// the PCM16 WAV at 16 kHz with its header, and decodeVoiceNote with a fake decoder (the real WebAudio decode of
// OGG/Opus runs only in Electron): limits, resampling, and errors returned as text, never thrown.
import { expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/lib/voice', () => ({ stopVoice: vi.fn(), blockVoiceWhile: vi.fn(), voice: { get: () => ({ phase: 'off' }) } }));
vi.mock('../../src/renderer/store/ui', () => ({ toast: vi.fn(), ui: { get: () => ({ focusMode: null }), subscribe: () => () => {} } }));
import { PHONE_VOICE_MAX_MS, encodeWav, mixdown } from '../../src/renderer/lib/phone-wav';
import { decodeVoiceNote } from '../../src/renderer/lib/phone-voice';

const ascii = (b: Uint8Array, at: number) => String.fromCharCode(...b.slice(at, at + 4));
const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const audio = (rate: number, channels: Float32Array[]) => ({ sampleRate: rate, length: channels[0]!.length, numberOfChannels: channels.length, getChannelData: (c: number) => channels[c]! }) as unknown as AudioBuffer;

it('mixdown averages the channels and keeps mono as is', () => {
  const m = Float32Array.from([0.5, -0.5]);
  expect(mixdown([m])).toBe(m);
  expect(Array.from(mixdown([Float32Array.from([1, 0, 1]), Float32Array.from([0, 0])]))).toEqual([0.5, 0]);
  expect(mixdown([]).length).toBe(0);
});

it('encodeWav writes a 16 kHz mono PCM16 file', () => {
  const wav = encodeWav(Float32Array.from([0, 1, -1, 2]));
  expect(wav.byteLength).toBe(44 + 8);
  expect(ascii(wav, 0)).toBe('RIFF');
  expect(ascii(wav, 8)).toBe('WAVE');
  const d = view(wav);
  expect(d.getUint16(22, true)).toBe(1);
  expect(d.getUint32(24, true)).toBe(16_000);
  expect(d.getUint16(34, true)).toBe(16);
  expect([0, 1, 2, 3].map(i => d.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32767, 32767]);
});

it('decodes a note into a WAV at 16 kHz, resampling a higher rate', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const decode = vi.fn(async (b: ArrayBuffer) => { expect(new Uint8Array(b)).toEqual(bytes); return audio(48_000, [new Float32Array(4800).fill(0.25), new Float32Array(4800).fill(0.25)]); });
  const r = await decodeVoiceNote({ id: 'v1', bytes }, decode);
  expect(r.error).toBeUndefined();
  expect(r.id).toBe('v1');
  expect(r.wav!.byteLength).toBe(44 + 1600 * 2);
  expect(view(r.wav!).getInt16(44, true)).toBe(Math.round(0.25 * 32767));
});

it('refuses empty, over 20 MB and over 5 minutes; a decoder error comes back as text', async () => {
  const never = vi.fn();
  expect(await decodeVoiceNote({ id: 'a', bytes: new Uint8Array(0) }, never)).toEqual({ id: 'a', error: 'empty voice note' });
  expect((await decodeVoiceNote({ id: 'b', bytes: new Uint8Array(20 * 1024 ** 2 + 1) }, never)).error).toMatch(/20 MB/);
  expect(never).not.toHaveBeenCalled();
  const long = async () => audio(16_000, [new Float32Array(Math.ceil((PHONE_VOICE_MAX_MS / 1000) * 16_000) + 16)]);
  expect((await decodeVoiceNote({ id: 'c', bytes: new Uint8Array([1]) }, long)).error).toMatch(/5 minutes/);
  const bad = async () => { throw new Error('EncodingError: unable to decode'); };
  expect(await decodeVoiceNote({ id: 'd', bytes: new Uint8Array([1]) }, bad)).toEqual({ id: 'd', error: 'decoding failed: EncodingError: unable to decode' });
});
