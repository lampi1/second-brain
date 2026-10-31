// Transcribing a recording's WAV in the voice process (ADR 0154): read in 10-second blocks, each channel gets its own
// Silero VAD (a call: channel 0 = the user's microphone, 1 = the PC's audio), the VAD keeps only where each speech
// segment starts and how long it is; close segments of one speaker are joined (mergeSpans, ADR 0215); then each is
// read back from the file and given to the recognizer, one at a time
// through the worker's queue, so voice mode's own utterances still get their turn between two lines. Memory stays at a
// block plus one segment whatever the length of the call. The engine is passed in (worker.ts), so tests use fakes.
import fs from 'node:fs';
import { REC_RATE } from '@shared/recordings';

export interface VadLike { acceptWaveform(s: Float32Array): void; isEmpty(): boolean; front(ext: boolean): { start: number; samples: Float32Array }; pop(): void; flush(): void }
export interface TranscribeEngine {
  vad(): VadLike;
  /** Whisper on one segment (16 kHz mono) */
  decode(samples: Float32Array): Promise<string>;
  /** runs `fn` on the worker's decode queue (between voice mode's utterances) */
  queue<T>(fn: () => Promise<T>): Promise<T>;
  noise(text: string): boolean;
  cancelled(): boolean;
  progress(done: number): void;
}
export interface TranscribedLine { start: number; end: number; ch: number; text: string }

/** Where the samples start and how many channels (a PCM 16-bit WAV; anything else is refused). */
export function wavLayout(fd: number): { data: number; bytes: number; channels: number; rate: number } {
  const head = Buffer.alloc(4096);
  const n = fs.readSync(fd, head, 0, head.length, 0);
  if (n < 44 || head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') throw new Error('il file audio non è un WAV');
  let at = 12, channels = 0, rate = 0, bits = 0;
  while (at + 8 <= n) {
    const id = head.toString('ascii', at, at + 4), size = head.readUInt32LE(at + 4);
    if (id === 'fmt ') { channels = head.readUInt16LE(at + 10); rate = head.readUInt32LE(at + 12); bits = head.readUInt16LE(at + 22); }
    if (id === 'data') {
      if (bits !== 16 || !channels) throw new Error('formato audio non supportato');
      const total = fs.fstatSync(fd).size - (at + 8);
      return { data: at + 8, bytes: Math.min(size || total, total), channels, rate };
    }
    at += 8 + size + (size % 2);
  }
  throw new Error('WAV senza dati audio');
}

const WINDOW = 512;
/** ADR 0215 (owner: «troppo lento nella trascrizione»): sherpa-onnx gives Whisper every piece plus 1000 frames (10 s) of
 *  silence, capped at 3000 (30 s): offline-recognizer-whisper-impl.h, `tail_padding_frames = 1000`, `max_num_frames =
 *  3000`. So a 2 s sentence costs the encoder 12 s of audio. Consecutive pieces of the same speaker, with at most
 *  MERGE_GAP_S of silence between them, are read as one piece of at most MERGE_MAX_S: far fewer Whisper runs, each
 *  with more speech and the same padding. */
export const MERGE_GAP_S = 1.5;
export const MERGE_MAX_S = 19;
export interface Span { ch: number; start: number; n: number }
/** The VAD's speech pieces (sorted by start) joined as above; a piece of the other channel in between ends a group, so
 *  the conversation keeps its order. */
export function mergeSpans(spans: readonly Span[], rate = REC_RATE): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    const last = out.at(-1);
    if (last && last.ch === s.ch && s.start - (last.start + last.n) <= MERGE_GAP_S * rate && s.start + s.n - last.start <= MERGE_MAX_S * rate) {
      last.n = Math.max(last.n, s.start + s.n - last.start);
    } else out.push({ ...s });
  }
  return out;
}
const BLOCK_FRAMES = REC_RATE * 10;
/** the VAD pass is about this share of the work, Whisper the rest */
const VAD_SHARE = 0.15;
const tick = () => new Promise<void>(r => setImmediate(r));

export async function transcribeWav(file: string, e: TranscribeEngine): Promise<TranscribedLine[]> {
  const fd = fs.openSync(file, 'r');
  try {
    const { data, bytes, channels, rate } = wavLayout(fd);
    if (rate !== REC_RATE) throw new Error(`frequenza ${rate} Hz non supportata`);
    const frame = channels * 2;
    const vads = Array.from({ length: channels }, () => e.vad());
    const tails = Array.from({ length: channels }, () => new Float32Array(0));
    const spans: Span[] = [];
    const drain = () => vads.forEach((v, ch) => { while (!v.isEmpty()) { const s = v.front(false); spans.push({ ch, start: s.start, n: s.samples.length }); v.pop(); } });
    const buf = Buffer.alloc(BLOCK_FRAMES * frame);
    for (let off = 0; off < bytes; off += buf.length) {
      if (e.cancelled()) return [];
      const got = fs.readSync(fd, buf, 0, Math.min(buf.length, bytes - off), data + off);
      const frames = Math.floor(got / frame);
      for (let ch = 0; ch < channels; ch++) {
        const prev = tails[ch]!;
        const all = new Float32Array(prev.length + frames);
        all.set(prev);
        for (let i = 0; i < frames; i++) all[prev.length + i] = buf.readInt16LE(i * frame + ch * 2) / 32768;
        let at = 0;
        for (; at + WINDOW <= all.length; at += WINDOW) vads[ch]!.acceptWaveform(all.subarray(at, at + WINDOW));
        tails[ch] = all.slice(at);
      }
      drain();
      e.progress(VAD_SHARE * Math.min(1, (off + got) / Math.max(1, bytes)));
      await tick();
    }
    // the last few samples, padded to a whole window, so the end of the call is not cut
    tails.forEach((tl, ch) => { if (tl.length) { const w = new Float32Array(WINDOW); w.set(tl); vads[ch]!.acceptWaveform(w); } });
    vads.forEach(v => v.flush());
    drain();
    spans.sort((a, b) => a.start - b.start || a.ch - b.ch);
    const groups = mergeSpans(spans);
    const lines: TranscribedLine[] = [];
    for (let i = 0; i < groups.length; i++) {
      if (e.cancelled()) return [];
      const { ch, start, n } = groups[i]!;
      const text = await e.queue(async () => {
        const raw = Buffer.alloc(n * frame);
        const got = fs.readSync(fd, raw, 0, raw.length, data + start * frame);
        const samples = new Float32Array(Math.floor(got / frame));
        for (let k = 0; k < samples.length; k++) samples[k] = raw.readInt16LE(k * frame + ch * 2) / 32768;
        return (await e.decode(samples)).trim();
      });
      if (text && !e.noise(text)) lines.push({ start: Math.round((start / REC_RATE) * 1000), end: Math.round(((start + n) / REC_RATE) * 1000), ch, text });
      e.progress(VAD_SHARE + (1 - VAD_SHARE) * ((i + 1) / groups.length));
    }
    return lines;
  } finally { fs.closeSync(fd); }
}
