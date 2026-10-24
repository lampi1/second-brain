// Call recordings on disk and their queue (ADR 0154, src/main/recordings/store.ts, service.ts, voice/transcribe.ts):
// the WAV grows chunk by chunk and gets its real header at the stop; a crash leaves a recording the next start closes;
// a stopped call is transcribed (left = «Tu», right = «Altri», the microphone's echo dropped) one at a time; a removed
// one is cancelled; only a file «Trovate sul PC» listed can be read back. The WAV reader cuts speech per channel.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { RecordingStore } from '../../src/main/recordings/store';
import { RecordingService } from '../../src/main/recordings/service';
import { transcribeWav, type VadLike } from '../../src/main/voice/transcribe';
import { wavHeader, type RecState } from '../../src/shared/recordings';
import type { TranscribedLine } from '../../src/main/voice/transcribe';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-rec-'));
const second = (ch: number, v = 1000) => { const a = new Int16Array(16_000 * ch).fill(v); return new Uint8Array(a.buffer); };
const flush = () => new Promise(r => setTimeout(r, 0));

describe('store', () => {
  it('writes the WAV, fixes the header at the stop', () => {
    const st = new RecordingStore(tmp());
    const r = st.start({ source: 'call', channels: 2, title: 'x', startedAt: 1 }, new Date(2026, 9, 24, 15, 0, 0).getTime());
    expect(r.id).toMatch(/^20261024-150000-[0-9a-f]{4}$/);
    expect(st.append(r.id, second(2))).toBe(1000);
    expect(st.append(r.id, second(2))).toBe(2000);
    const done = st.stop(r.id);
    expect(done).toMatchObject({ status: 'saved', durationMs: 2000, bytes: 128_044 });
    const head = fs.readFileSync(st.wav(r.id)).subarray(0, 44);
    expect(Buffer.from(head).equals(Buffer.from(wavHeader(128_000, 2)))).toBe(true);
    expect(() => st.append(r.id, second(2))).toThrow();
  });
  it('recovers a recording a crash left open and queues it', () => {
    const root = tmp();
    const a = new RecordingStore(root);
    const r = a.start({ source: 'call', channels: 1, title: 'x', startedAt: 1 });
    a.append(r.id, second(1)); a.append(r.id, second(1));
    a.closeAll(); // the app quit without a stop
    const b = new RecordingStore(root);
    expect(b.recover()).toEqual([r.id]);
    expect(b.get(r.id)).toMatchObject({ status: 'saved', durationMs: 2000 });
  });
  it('refuses unknown ids and path tricks', () => {
    const st = new RecordingStore(tmp());
    expect(() => st.wav('../x')).toThrow();
    expect(st.get('20261024-150000-zzzz')).toBeNull();
  });
});

function service(lines: TranscribedLine[] | ((wav: string) => Promise<{ lines: TranscribedLine[]; error?: string }>)) {
  const store = new RecordingStore(tmp());
  const states: RecState[] = [];
  const calls: string[] = [];
  const cancelled: string[] = [];
  const svc = new RecordingService({
    store, home: tmp(), asr: () => 'fast', changed: s => states.push(s),
    transcribe: (wav, progress) => {
      calls.push(wav);
      progress(0.5);
      const result = typeof lines === 'function' ? lines(wav) : Promise.resolve({ lines });
      return { result, cancel: () => cancelled.push(wav) };
    },
  });
  return { store, svc, states, calls, cancelled };
}

describe('service', () => {
  it('a stopped call is transcribed: left Tu, right Altri, echo dropped', async () => {
    const { svc, store } = service([
      { start: 0, end: 3000, ch: 1, text: 'Il bug è nella pagina di login' },
      { start: 100, end: 2900, ch: 0, text: 'il bug è nella pagina di login' },
      { start: 4000, end: 5000, ch: 0, text: 'Ok, lo prendo io' },
    ]);
    const r = svc.start({ source: 'call', channels: 2, systemAudio: true });
    expect(() => svc.start({ source: 'call', channels: 2 })).toThrow(/in corso/);
    svc.chunk(r.id, second(2)); svc.chunk(r.id, second(2));
    svc.stop(r.id);
    await flush();
    expect(store.get(r.id)).toMatchObject({ status: 'ready', lines: 2, asr: 'fast' });
    expect(store.transcript(r.id).map(s => `${s.who}:${s.text}`)).toEqual(['others:Il bug è nella pagina di login', 'me:Ok, lo prendo io']);
    expect(store.text(r.id)).toContain('Tu: Ok, lo prendo io');
    expect(svc.state().active).toBeNull();
  });
  it('drops a click by mistake (under a second)', () => {
    const { svc, store } = service([]);
    const r = svc.start({ source: 'call', channels: 1 });
    expect(svc.stop(r.id)).toBeNull();
    expect(store.list()).toEqual([]);
  });
  it('one transcription at a time; a failure keeps the audio and can be retried', async () => {
    let fail = true;
    const waits: (() => void)[] = [];
    const { svc, store, calls } = service(() => new Promise(res => waits.push(() => res(fail ? { lines: [], error: 'Whisper non è ancora scaricato' } : { lines: [{ start: 0, end: 1, ch: 0, text: 'ciao' }] }))));
    const a = svc.start({ source: 'file', channels: 1, from: 'a.mp3' }); svc.chunk(a.id, second(1)); svc.chunk(a.id, second(1)); svc.stop(a.id);
    const b = svc.start({ source: 'file', channels: 1, from: 'b.mp3' }); svc.chunk(b.id, second(1)); svc.chunk(b.id, second(1)); svc.stop(b.id);
    expect(calls).toHaveLength(1);
    expect(store.get(b.id)?.status).toBe('queued');
    waits.shift()!(); await flush();
    expect(store.get(a.id)).toMatchObject({ status: 'error', error: 'Whisper non è ancora scaricato' });
    expect(calls).toHaveLength(2);
    fail = false;
    waits.shift()!(); await flush();
    expect(store.get(b.id)?.status).toBe('ready');
    svc.queue(a.id);
    waits.shift()!(); await flush();
    expect(store.get(a.id)).toMatchObject({ status: 'ready', lines: 1 });
    expect(store.transcript(a.id)[0]?.who).toBeNull();
  });
  it('removing a recording being transcribed cancels it', async () => {
    const { svc, store, cancelled } = service(() => new Promise(() => {}));
    const a = svc.start({ source: 'call', channels: 1 }); svc.chunk(a.id, second(1)); svc.chunk(a.id, second(1)); svc.stop(a.id);
    svc.remove(a.id);
    expect(cancelled).toHaveLength(1);
    expect(store.list()).toEqual([]);
  });
  it('reads back only a file the PC search listed', async () => {
    const { svc } = service([]);
    expect(() => svc.readFound('/etc/passwd')).toThrow(/non trovato/);
    expect(() => svc.chunk('x', 'not bytes')).toThrow();
  });
});

describe('transcribeWav', () => {
  it('cuts each channel by its own VAD and reads each segment back for Whisper', async () => {
    const dir = tmp(), file = path.join(dir, 'a.wav');
    // 3 s stereo: left loud in second 1, right loud in second 2
    const frames = 48_000, pcm = new Int16Array(frames * 2);
    for (let i = 16_000; i < 32_000; i++) pcm[i * 2] = 8000;
    for (let i = 32_000; i < 48_000; i++) pcm[i * 2 + 1] = 8000;
    fs.writeFileSync(file, Buffer.concat([Buffer.from(wavHeader(pcm.byteLength, 2)), Buffer.from(pcm.buffer)]));
    // a toy VAD: speech = |sample| > 0.1, segments by sample index
    const vad = (): VadLike => {
      let at = 0, start = -1; const out: { start: number; samples: Float32Array }[] = []; let cur: number[] = [];
      const close = () => { if (start >= 0) out.push({ start, samples: Float32Array.from(cur) }); start = -1; cur = []; };
      return {
        acceptWaveform: s => { for (const x of s) { if (Math.abs(x) > 0.1) { if (start < 0) start = at; cur.push(x); } else close(); at++; } },
        isEmpty: () => !out.length, front: () => out[0]!, pop: () => { out.shift(); }, flush: close,
      };
    };
    const seen: number[] = [];
    const lines = await transcribeWav(file, {
      vad, decode: async s => { seen.push(s.length); return s[0]! > 0.2 ? 'parola' : ''; }, queue: fn => fn(),
      noise: t => !t, cancelled: () => false, progress: () => {},
    });
    expect(lines).toEqual([{ start: 1000, end: 2000, ch: 0, text: 'parola' }, { start: 2000, end: 3000, ch: 1, text: 'parola' }]);
    expect(seen).toEqual([16_000, 16_000]);
  });
});
