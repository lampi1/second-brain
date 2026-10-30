// Voice mode in main (ADR 0152): starts the voice process (voice/worker.ts, an Electron utility process) when the user
// first needs it, keeps the VoiceState the renderer shows (models on disk, download progress, last error), and relays
// the microphone's chunks in and the transcripts and spoken audio out; it also transcribes recordings (ADR 0154). Voice
// mode records nothing to disk and nothing leaves the PC except the one-time model downloads (voice/catalog.ts). SB_VOICE_FAKE=1 (e2e, demo) swaps the
// engine for a fake that "hears" SB_VOICE_FAKE_TEXT once per listening session and speaks a short silence.
// Wired in main/index.ts (voice:* channels).
import path from 'node:path';
import { registerVoiceDiagnostics, VoiceMeasurements } from './diagnostics';
import fs from 'node:fs';
import { log } from '../log';
import { ASR, TTS, VAD, partBytes } from './catalog';
import { partReady } from './download';
import type { VoiceIn, VoiceOut } from './protocol';
import type { TranscribedLine } from './transcribe';
import { VOICE_NAMES, type VoiceAsr, type VoiceName, type VoiceState, type VoiceHeard, type VoiceSpeech } from '@shared/voice';

interface Child { postMessage(m: VoiceIn): void; on(ev: 'message', fn: (m: VoiceOut) => void): void; on(ev: 'exit', fn: (code: number) => void): void; kill(): boolean }
export interface VoiceDeps {
  /** userData/voice */
  root: string;
  /** the worker script (out/main/voice-worker.js) */
  script: string;
  settings: () => { asr: VoiceAsr; voice: VoiceName };
  fork: (script: string) => Child;
  changed: (s: VoiceState) => void;
  heard: (event: VoiceHeard) => void;
  speech: (event: VoiceSpeech) => void;
  /** push to talk: everything said before the release is heard (voice:committed) */
  committed?: (session: string) => void;
  fake?: { text: string; delayMs?: number } | null;
}

const SPEAK_TIMEOUT_MS = 30_000;
/** what the fake engine "hears" in a recording (e2e, demo): a short call, both sides */
const FAKE_LINES: TranscribedLine[] = [
  { start: 1200, end: 4800, ch: 1, text: 'Ciao, allora, il bug è nella pagina di login: dopo il reset della password resta bianca.' },
  { start: 5400, end: 8200, ch: 0, text: 'Ok, lo prendo io. Succede su tutti i browser?' },
  { start: 8800, end: 12600, ch: 1, text: 'Sì, anche su Edge. Serve per venerdì, prima del rilascio.' },
  { start: 13100, end: 15000, ch: 0, text: 'Perfetto, ci guardo oggi pomeriggio.' },
];

export class VoiceService {
  private readonly measurements = new VoiceMeasurements();
  private readonly releaseDiagnostics: () => void;
  private child: Child | null = null;
  private downloading: VoiceState['downloading'] = null;
  private error: string | null = null;
  private errorAt = 0;
  private speakId = 0;
  private listening: string | null = null;
  private readonly utterances = new Map<number, ReturnType<typeof setTimeout>>();
  private clearListening(): void {
    this.measurements.clear();
    this.listening = null;
    for (const timer of this.utterances.values()) clearTimeout(timer);
    this.utterances.clear();
    if (this.fakeTimer) clearTimeout(this.fakeTimer);
    this.fakeTimer = null;
  }
  private failListening(message: string): void {
    this.clearListening();
    this.error = message;
    // Inference cannot be preempted reliably inside the native decoder. Fail every affected job explicitly.
    this.child?.kill();
    this.emit();
  }
  private readonly speaks = new Map<number, (r: { samples: Float32Array; rate: number; error?: string }) => void>();
  private fakeTimer: ReturnType<typeof setTimeout> | null = null;
  private jobId = 0;
  private readonly jobs = new Map<number, { progress: (done: number) => void; done: (r: { lines: TranscribedLine[]; error?: string }) => void }>();
  constructor(private readonly d: VoiceDeps) { this.releaseDiagnostics = registerVoiceDiagnostics(() => this.measurements.snapshot(!!d.fake)); }

  state(): VoiceState {
    const { asr, voice } = this.d.settings();
    if (this.d.fake) return { ready: { vad: true, asr: true, tts: true }, asr, voice, voices: [...VOICE_NAMES], downloading: null, error: null, missingMb: 0, fake: true, diagnostics: this.measurements.snapshot(true) };
    const parts = [VAD, ASR[asr], TTS[voice]];
    const ready = { vad: partReady(this.d.root, VAD), asr: partReady(this.d.root, ASR[asr]), tts: partReady(this.d.root, TTS[voice]) };
    const missing = parts.filter(p => !partReady(this.d.root, p)).reduce((n, p) => n + partBytes(p), 0);
    // the voices on disk: Impara's podcast (ADR 0205) reads with two of them when there are two, never downloading one
    const voices = VOICE_NAMES.filter(n => partReady(this.d.root, TTS[n]));
    return { ready, asr, voice, voices, downloading: this.downloading, error: this.error, missingMb: Math.round(missing / 1e6), diagnostics: this.measurements.snapshot() };
  }

  private emit(): void { this.d.changed(this.state()); }

  private proc(): Child {
    if (this.child) return this.child;
    fs.mkdirSync(this.d.root, { recursive: true });
    const c = this.d.fork(this.d.script);
    c.on('message', m => { if (this.child === c) this.onMessage(m); });
    c.on('exit', code => {
      if (this.child !== c) return;
      this.child = null;
      if (this.listening) { this.clearListening(); this.error = 'Il motore voce si è fermato: riattiva la conversazione.'; }
      if (this.downloading) { this.downloading = null; this.error = 'Il motore voce si è fermato durante il download: riprova.'; }
      for (const done of this.speaks.values()) done({ samples: new Float32Array(0), rate: 22050, error: 'motore voce fermo' });
      this.speaks.clear();
      for (const j of this.jobs.values()) j.done({ lines: [], error: 'il motore voce si è fermato durante la trascrizione' });
      this.jobs.clear();
      if (code) log.warn('voice', 'voice process exited', { cause: `exit code ${code}`, hint: 'started again on the next use; npm run logs -- --scope voice' });
      this.emit();
    });
    c.postMessage({ type: 'init', root: this.d.root, asr: this.d.settings().asr });
    this.child = c;
    return c;
  }

  private onMessage(m: VoiceOut): void {
    switch (m.type) {
      case 'progress': this.downloading = { done: m.done, total: m.total }; this.emit(); return;
      case 'prepared': this.downloading = null; this.error = null; log.info('voice', 'models ready', { data: this.d.settings() }); this.emit(); return;
      case 'heard': {
        if (m.session !== this.listening || !this.utterances.has(m.utterance)) { this.measurements.count('staleEvents'); return; }
        clearTimeout(this.utterances.get(m.utterance)); this.utterances.delete(m.utterance);
        this.measurements.heard(m.utterance); this.d.heard(m); this.emit(); return;
      }
      case 'speech': {
        if (m.session !== this.listening || !Number.isSafeInteger(m.utterance) || m.utterance < 1) return;
        if (m.active) {
          if (this.utterances.has(m.utterance)) return;
          if (this.utterances.size >= 4) { this.failListening('La trascrizione è in ritardo: riattiva la voce e ripeti la frase.'); return; }
          this.utterances.set(m.utterance, setTimeout(() => { this.measurements.count('timeouts'); this.failListening('La trascrizione non ha risposto: riattiva la voce e ripeti la frase.'); }, 75_000));
        } else if (!this.utterances.has(m.utterance)) return;
        else this.measurements.endpoint(m.utterance);
        this.d.speech(m); return;
      }
      case 'committed': if (m.session === this.listening) this.d.committed?.(m.session); return;
      case 'tprogress': this.jobs.get(m.job)?.progress(m.done); return;
      case 'transcribed': { const j = this.jobs.get(m.job); this.jobs.delete(m.job); j?.done(m); return; }
      case 'spoken': { const done = this.speaks.get(m.id); this.speaks.delete(m.id); done?.(m); return; }
      case 'error':
        if (m.message === this.error && Date.now() - this.errorAt < 10_000) return;
        this.errorAt = Date.now();
        this.measurements.count('errors');
        log.warn('voice', 'voice engine error', { cause: m.message, hint: 'models in userData/voice; a bad download is deleted and fetched again with «Scarica»' });
        if (this.downloading) this.downloading = null;
        this.error = m.message;
        this.emit();
        return;
      default: return;
    }
  }

  /** Downloads what the chosen models still miss (the user's click, or the first Ctrl+M). */
  prepare(): VoiceState {
    if (this.d.fake || this.downloading) return this.state();
    const { asr, voice } = this.d.settings();
    this.error = null;
    this.downloading = { done: 0, total: 0 };
    this.proc().postMessage({ type: 'prepare', asr, voice });
    this.emit();
    return this.state();
  }

  /** talk: a spoken conversation (its voice is loaded now too) */
  listen(on: boolean, session: string, talk = false): void {
    if (typeof session !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(session)) throw new Error('Invalid voice session');
    if (!on && this.listening !== session) return; // a late stop must not stop a newer microphone
    this.clearListening();
    this.listening = on ? session : null;
    if (on) this.error = null;
    if (this.d.fake) {
      this.fakeTimer = on ? setTimeout(() => {
        if (this.listening !== session) return;
        this.d.speech({ session, utterance: 1, active: true });
        this.d.speech({ session, utterance: 1, active: false });
        this.d.heard({ session, utterance: 1, text: this.d.fake!.text, ms: 600 });
      }, Math.max(0, Math.min(60_000, this.d.fake.delayMs ?? 600))) : null;
      return;
    }
    if (!on && !this.child) return;
    this.proc().postMessage({ type: 'listen', on, session, asr: this.d.settings().asr, ...(on && talk ? { voice: this.d.settings().voice } : {}) });
  }

  /** Push to talk released: close what was said now; `committed` when all of it is transcribed. */
  commit(session: string): void {
    if (!this.listening || session !== this.listening) return;
    if (this.d.fake) {
      // the fake engine «hears» its sentence for each press (no microphone)
      this.d.speech({ session, utterance: 1, active: true });
      this.d.speech({ session, utterance: 1, active: false });
      this.d.heard({ session, utterance: 1, text: this.d.fake.text, ms: 600 });
      this.d.committed?.(session);
      return;
    }
    this.proc().postMessage({ type: 'commit', session });
  }

  audio(samples: Float32Array, session: string): void {
    if (this.d.fake || !this.listening || session !== this.listening || !(samples instanceof Float32Array) || samples.length > 64_000) return;
    this.proc().postMessage({ type: 'audio', session, samples });
  }

  /** Drop queued synthesis as well as playback; the worker cancels native generation at its next progress callback. */
  cancelSpeech(): void {
    this.measurements.count('cancellations', this.speaks.size);
    this.child?.postMessage({ type: 'cancel-speech', through: this.speakId });
    for (const done of this.speaks.values()) done({ samples: new Float32Array(0), rate: 22050 });
    this.speaks.clear();
  }

  speak(text: string, voice?: VoiceName): Promise<{ samples: Float32Array; rate: number; error?: string }> {
    const clean = String(text ?? '').slice(0, 2000).trim();
    if (!clean) return Promise.resolve({ samples: new Float32Array(0), rate: 22050 });
    if (this.d.fake) return Promise.resolve({ samples: new Float32Array(6615), rate: 22050 });
    if (this.speaks.size >= 8) return Promise.resolve({ samples: new Float32Array(0), rate: 22050, error: 'La coda della voce è piena: riprova.' });
    const id = ++this.speakId;
    const measured = this.measurements.synthesisStarted();
    return new Promise(res => {
      // a stuck engine never leaves the renderer «speaking» (and deaf) for good
      const timer = setTimeout(() => {
        if (!this.speaks.delete(id)) return;
        this.measurements.count('timeouts');
        this.child?.postMessage({ type: 'cancel-speech', through: id });
        res({ samples: new Float32Array(0), rate: 22050, error: 'la voce non ha risposto in tempo' });
        this.failListening('Il motore voce non ha risposto: riattiva la voce per riprovare.');
      }, SPEAK_TIMEOUT_MS);
      this.speaks.set(id, r => { clearTimeout(timer); if (!r.error && r.samples.length) measured(); else if (r.error) this.measurements.count('errors'); res(r); this.emit(); });
      this.proc().postMessage({ type: 'speak', id, text: clean, voice: voice ?? this.d.settings().voice });
    });
  }

  /** A recording's WAV to text (ADR 0154), with the chosen Whisper; `progress` gets 0..1. The returned `cancel` stops
   *  it (the promise then resolves with no lines). */
  transcribe(wav: string, progress: (done: number) => void): { result: Promise<{ lines: TranscribedLine[]; error?: string }>; cancel: () => void } {
    if (this.d.fake) {
      let stop = false;
      const result = new Promise<{ lines: TranscribedLine[]; error?: string }>(res => {
        setTimeout(() => { progress(0.5); }, 150);
        setTimeout(() => res(stop ? { lines: [] } : { lines: FAKE_LINES }), 400);
      });
      return { result, cancel: () => { stop = true; } };
    }
    const job = ++this.jobId;
    const result = new Promise<{ lines: TranscribedLine[]; error?: string }>(res => {
      this.jobs.set(job, { progress, done: res });
      this.proc().postMessage({ type: 'transcribe', job, wav, asr: this.d.settings().asr });
    });
    return { result, cancel: () => {
      const j = this.jobs.get(job);
      this.jobs.delete(job);
      this.child?.postMessage({ type: 'tcancel', job });
      j?.done({ lines: [] });
    } };
  }

  /** settings changed (another Whisper or voice): the loaded models are dropped, the next use loads the new ones */
  settingsChanged(): void { this.child?.postMessage({ type: 'unload', asr: this.d.settings().asr }); this.emit(); }

  dispose(): void { this.clearListening(); this.cancelSpeech(); this.child?.kill(); this.child = null; this.releaseDiagnostics(); }
}

export const voiceRoot = (userData: string): string => path.join(userData, 'voice');
