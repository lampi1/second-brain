// Native voice lifecycle with a mock VAD/decoder/TTS: no models, microphones, network or audio devices.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceIn, VoiceOut } from '../../src/main/voice/protocol';
const fake = vi.hoisted(() => ({
  send: vi.fn<(event: VoiceOut) => void>(), listener: null as null | ((event: { data: VoiceIn }) => void),
  decode: vi.fn(), generate: vi.fn(), active: false, segment: null as null | Float32Array,
}));
vi.mock('../../src/main/voice/download', () => ({ partReady: () => true, partDir: () => '/models', ensurePart: vi.fn() }));
vi.mock('node:fs', () => ({ default: { readdirSync: () => ['voice.onnx'] } }));
vi.mock('node:module', () => ({ createRequire: () => () => ({
  Vad: class {
    acceptWaveform(samples: Float32Array) {
      if (samples[0] === 1) fake.active = true;
      if (samples[0] === 0 && fake.active) { fake.active = false; fake.segment = new Float32Array(512); }
    }
    isDetected() { return fake.active; }
    isEmpty() { return !fake.segment; }
    front() { return { samples: fake.segment }; }
    pop() { fake.segment = null; }
    reset() { fake.active = false; fake.segment = null; }
  },
  OfflineRecognizer: class {
    createStream() { return { acceptWaveform: vi.fn() }; }
    decodeAsync() { return fake.decode(); }
  },
  OfflineTts: class { generateAsync(options: unknown) { return fake.generate(options); } },
}) }));
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function emit(m: VoiceIn) { fake.listener!({ data: m }); }
function segment(session: string) {
  emit({ type: 'audio', session, samples: new Float32Array(512).fill(1) });
  emit({ type: 'audio', session, samples: new Float32Array(512) });
}
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); fake.active = false; fake.segment = null;
  Object.defineProperty(process, 'parentPort', { configurable: true, value: {
    on: (_ev: string, fn: typeof fake.listener) => { fake.listener = fn; }, postMessage: fake.send,
  } });
  await import('../../src/main/voice/worker');
  emit({ type: 'init', root: '/models', asr: 'fast' });
});
afterEach(() => { Reflect.deleteProperty(process, 'parentPort'); });
describe('voice worker cancellation and identity', () => {
  it('ignores old microphone chunks and late native decodes across listen sessions', async () => {
    let finish!: (value: { text: string }) => void;
    fake.decode.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ text: 'new' });
    emit({ type: 'listen', on: true, session: 'one', asr: 'fast' }); segment('one'); await flush();
    emit({ type: 'listen', on: false, session: 'one', asr: 'fast' });
    emit({ type: 'listen', on: true, session: 'two', asr: 'fast' });
    segment('one'); segment('two'); finish({ text: 'old' }); await flush();
    const heard = fake.send.mock.calls.map(([m]) => m).filter(m => m.type === 'heard');
    expect(heard).toEqual([{ type: 'heard', session: 'two', utterance: 2, text: 'new', ms: 32 }]);
    expect(fake.decode).toHaveBeenCalledTimes(2);
  });
  it('does not stop a new session when a cancelled decode rejects late', async () => {
    let reject!: (error: Error) => void;
    fake.decode.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    emit({ type: 'listen', on: true, session: 'one', asr: 'fast' }); segment('one'); await flush();
    emit({ type: 'listen', on: false, session: 'one', asr: 'fast' });
    emit({ type: 'listen', on: true, session: 'two', asr: 'fast' });
    reject(new Error('stale failure')); await flush();
    expect(fake.send.mock.calls.map(([m]) => m).filter(m => m.type === 'error' || m.type === 'heard')).toEqual([]);
  });
  it('skips cancelled queued synthesis and signals cancellation to active native generation', async () => {
    let finish!: (value: { samples: Float32Array; sampleRate: number }) => void;
    fake.generate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    emit({ type: 'speak', id: 1, voice: 'paola', text: 'first' }); await flush();
    emit({ type: 'speak', id: 2, voice: 'paola', text: 'queued' });
    const options = fake.generate.mock.calls[0]![0] as { onProgress(): boolean };
    expect(options.onProgress()).toBe(true);
    emit({ type: 'cancel-speech', through: 2 });
    expect(options.onProgress()).toBe(false);
    finish({ samples: new Float32Array(5), sampleRate: 22050 }); await flush();
    expect(fake.generate).toHaveBeenCalledTimes(1);
    expect(fake.send.mock.calls.map(([m]) => m).filter(m => m.type === 'spoken')).toEqual([]);
  });
  it('emits one capture pair per closed utterance, and stops accepting audio when off', async () => {
    fake.decode.mockResolvedValue({ text: 'heard' });
    emit({ type: 'listen', on: true, session: 'one', asr: 'fast' });
    segment('one'); segment('one'); await flush();
    const events = fake.send.mock.calls.map(([m]) => m).filter(m => m.type === 'speech');
    expect(events).toEqual([1, 2].flatMap(utterance => [true, false].map(active => ({ type: 'speech', session: 'one', utterance, active }))));
    emit({ type: 'listen', on: false, session: 'one', asr: 'fast' }); segment('one'); await flush();
    expect(fake.decode).toHaveBeenCalledTimes(2);
  });
});
