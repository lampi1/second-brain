// The voice process (ADR 0152): an Electron utility process started by main/voice/service.ts, so the speech engine's
// CPU work and its own onnxruntime (sherpa-onnx bundles one) never share a process with main or with the hybrid
// search's onnxruntime-node. It downloads and checks the models (download.ts), listens (Silero VAD cuts the
// microphone's 16 kHz stream into utterances, Whisper turns each into Italian text) and speaks (Piper, an Italian
// voice). It also transcribes a recorded call or an imported file (transcribe.ts, ADR 0154). Messages in and out: VoiceIn / VoiceOut (protocol.ts). Built to out/main/voice-worker.js.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ASR, TTS, VAD, partBytes, partsFor } from './catalog';
import { ensurePart, partDir, partReady } from './download';
import type { VoiceIn, VoiceOut } from './protocol';
import { transcribeWav } from './transcribe';
import { VOICE_RATE, isNoise, type VoiceAsr, type VoiceName } from '@shared/voice';

interface Port { on(ev: 'message', fn: (e: { data: VoiceIn }) => void): void; postMessage(m: VoiceOut): void }
const port = (process as unknown as { parentPort: Port }).parentPort;
const send = (m: VoiceOut) => port.postMessage(m);

/* eslint-disable @typescript-eslint/no-explicit-any -- sherpa-onnx-node ships JS without types */
let sherpa: any = null, loadError: Error | null = null;
/** the native addon, loaded once; a failure is kept, so a broken install fails fast instead of on every chunk */
const lib = () => {
  if (loadError) throw loadError;
  try { return (sherpa ??= createRequire(import.meta.url)('sherpa-onnx-node')); }
  catch (e) { loadError = new Error(`motore voce non caricato: ${msg(e)}`); throw loadError; }
};
let root = '';
let vad: any = null, rec: any = null, recFor = '', tts: any = null, ttsFor = '';
const cores = () => globalThis.navigator?.hardwareConcurrency ?? 4;
const threads = () => Math.max(1, Math.min(4, Math.floor(cores() / 2)));
/** Whisper is the wait between the end of a sentence and its text: it gets most of the cores (the voice runs beside it) */
const asrThreads = () => Math.max(1, Math.min(8, cores() - 2));

/** silence that ends an utterance: 0.5 s, the value OpenAI's Realtime VAD example uses (0.8 before: each sentence waited
 *  that much longer); a conversation still holds what was heard 0.7 s more for the rest of the thought (lib/voice.ts) */
const SILENCE_S = 0.5;
function vadNow(): any {
  if (vad) return vad;
  const s = lib();
  vad = new s.Vad({ sileroVad: { model: path.join(partDir(root, VAD), 'silero_vad.onnx'), threshold: 0.5, minSilenceDuration: SILENCE_S, minSpeechDuration: 0.25, maxSpeechDuration: 25, windowSize: 512 }, sampleRate: VOICE_RATE, numThreads: 1, debug: 0 }, 60);
  return vad;
}
function recNow(asr: VoiceAsr): any {
  if (rec && recFor === asr) return rec;
  const d = partDir(root, ASR[asr]);
  rec = new (lib().OfflineRecognizer)({ featConfig: { sampleRate: VOICE_RATE, featureDim: 80 },
    modelConfig: { whisper: { encoder: path.join(d, 'encoder.onnx'), decoder: path.join(d, 'decoder.onnx'), language: 'it', task: 'transcribe', tailPaddings: -1 }, tokens: path.join(d, 'tokens.txt'), numThreads: asrThreads(), provider: 'cpu', debug: 0 } });
  recFor = asr;
  return rec;
}
function ttsNow(voice: VoiceName): any {
  if (tts && ttsFor === voice) return tts;
  const d = partDir(root, TTS[voice]);
  if (!partReady(root, TTS[voice])) throw new Error('La voce non è ancora scaricata: Impostazioni → Voce.');
  const model = fs.readdirSync(d).find(f => f.endsWith('.onnx'));
  if (!model) throw new Error('voce non trovata sul disco');
  tts = new (lib().OfflineTts)({ model: { vits: { model: path.join(d, model), tokens: path.join(d, 'tokens.txt'), dataDir: path.join(d, 'espeak-ng-data') }, numThreads: threads(), provider: 'cpu', debug: 0 }, maxNumSentences: 1 });
  ttsFor = voice;
  return tts;
}

let asrNow: VoiceAsr = 'fast';
let preparing = false; // a download runs beside the decode/speak queue: voice mode keeps working meanwhile
let queue: Promise<void> = Promise.resolve();
const later = (fn: () => Promise<void> | void) => { queue = queue.then(fn, fn).catch(e => send({ type: 'error', message: msg(e) })); };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** `later`, with the job's own result or failure */
/** the voice has its own line: a sentence to say never waits behind Whisper, and Whisper (the user talking over it)
 *  never waits behind a long reply */
let speakQueue: Promise<void> = Promise.resolve();
const laterSpeak = (fn: () => Promise<void> | void) => { speakQueue = speakQueue.then(fn, fn).catch(e => send({ type: 'error', message: msg(e) })); };
const queued = <T>(fn: () => Promise<T>) => new Promise<T>((res, rej) => later(async () => { try { res(await fn()); } catch (e) { rej(e); } }));

/** a recording's transcription (ADR 0154): its own VADs, Whisper shared with voice mode through the queue */
const cancelled = new Set<number>();
async function transcribe(job: number, wav: string, asr: VoiceAsr): Promise<void> {
  if (!partReady(root, VAD) || !partReady(root, ASR[asr])) throw new Error('Whisper non è ancora scaricato: Impostazioni → Voce → Scarica.');
  const s = lib();
  let last = 0;
  const lines = await transcribeWav(wav, {
    vad: () => new s.Vad({ sileroVad: { model: path.join(partDir(root, VAD), 'silero_vad.onnx'), threshold: 0.5, minSilenceDuration: 0.6, minSpeechDuration: 0.25, maxSpeechDuration: 25, windowSize: 512 }, sampleRate: VOICE_RATE, numThreads: 1, debug: 0 }, 60),
    decode: async samples => {
      const r = recNow(asr);
      const stream = r.createStream();
      stream.acceptWaveform({ samples, sampleRate: VOICE_RATE });
      return String((await r.decodeAsync(stream))?.text ?? '');
    },
    queue: queued,
    noise: isNoise,
    cancelled: () => cancelled.has(job),
    progress: done => { if (done - last >= 0.01 || done >= 1) { last = done; send({ type: 'tprogress', job, done }); } },
  });
  if (cancelled.delete(job)) return;
  send({ type: 'transcribed', job, lines });
}

/** Every utterance the VAD closed: Whisper, then 'heard'. */
function drain(): void {
  const v = vadNow();
  while (!v.isEmpty()) {
    const seg = v.front(false); // a copy: the native buffer is freed by pop() before Whisper runs
    v.pop();
    const samples: Float32Array = seg.samples;
    const ms = Math.round((samples.length / VOICE_RATE) * 1000);
    later(async () => {
      // one 'heard' per utterance, empty when nothing was understood: the renderer pairs each with its start
      let text = '';
      try {
        if (!partReady(root, ASR[asrNow])) throw new Error('Whisper non è ancora scaricato: Impostazioni → Voce.');
        const r = recNow(asrNow);
        const stream = r.createStream();
        stream.acceptWaveform({ samples, sampleRate: VOICE_RATE });
        text = String((await r.decodeAsync(stream))?.text ?? '').trim();
      } finally { send({ type: 'heard', text, ms }); }
    });
  }
}

let lastDetected = false, warned = false;
const WINDOW = 512;
let tail = new Float32Array(0);
const concat = (a: Float32Array, b: Float32Array) => { const o = new Float32Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };
port.on('message', ({ data: m }) => {
  try {
    switch (m.type) {
      case 'init': root = m.root; asrNow = m.asr; return;
      case 'state': send({ type: 'state', ready: { vad: partReady(root, VAD), asr: partReady(root, ASR[m.asr]), tts: partReady(root, TTS[m.voice]) } }); return;
      case 'prepare': if (preparing) return; preparing = true; void (async () => {
        const parts = partsFor(m.asr, m.voice).filter(p => !partReady(root, p));
        const total = parts.reduce((n, p) => n + partBytes(p), 0);
        let before = 0;
        for (const p of parts) {
          await ensurePart(root, p, done => send({ type: 'progress', done: before + done, total }));
          before += partBytes(p);
        }
        send({ type: 'prepared' });
      })().catch(e => send({ type: 'error', message: msg(e) })).finally(() => { preparing = false; }); return;
      case 'listen':
        asrNow = m.asr;
        if (!m.on) { if (vad) { vad.flush(); drain(); vad.reset(); } lastDetected = false; tail = new Float32Array(0); return; }
        // loaded now, so the first sentence does not also pay for loading the models
        later(() => { if (partReady(root, ASR[m.asr])) recNow(m.asr); });
        if (m.voice) { const v = m.voice; laterSpeak(() => { if (partReady(root, TTS[v])) ttsNow(v); }); }
        return;
      case 'audio': {
        if (!partReady(root, VAD)) { if (!warned) send({ type: 'error', message: 'Modelli della voce mancanti: scaricali da Impostazioni → Voce.' }); warned = true; return; }
        let v: any;
        try { v = vadNow(); } catch (e) { if (!warned) send({ type: 'error', message: msg(e) }); warned = true; return; }
        // Silero reads 512-sample windows: the microphone's chunks are cut to that size, the rest waits for the next one
        const all = tail.length ? concat(tail, m.samples) : m.samples;
        let at = 0;
        for (; at + WINDOW <= all.length; at += WINDOW) v.acceptWaveform(all.subarray(at, at + WINDOW));
        tail = all.slice(at);
        const det = !!v.isDetected();
        if (det !== lastDetected) { lastDetected = det; send({ type: 'speech', active: det }); }
        drain();
        return;
      }
      case 'speak': laterSpeak(async () => {
        try {
          const audio = await ttsNow(m.voice).generateAsync({ text: m.text, sid: 0, speed: 1, enableExternalBuffer: false }) // Electron's memory cage refuses external buffers;
          send({ type: 'spoken', id: m.id, samples: audio.samples, rate: audio.sampleRate });
        } catch (e) { send({ type: 'spoken', id: m.id, samples: new Float32Array(0), rate: 22050, error: msg(e) }); }
      }); return;
      case 'transcribe': void transcribe(m.job, m.wav, m.asr).catch(e => { cancelled.delete(m.job); send({ type: 'transcribed', job: m.job, lines: [], error: msg(e) }); }); return;
      case 'tcancel': cancelled.add(m.job); return;
      case 'unload': asrNow = m.asr; rec = null; tts = null; recFor = ''; ttsFor = ''; return;
    }
  } catch (e) { send({ type: 'error', message: msg(e) }); }
});
send({ type: 'up' });
