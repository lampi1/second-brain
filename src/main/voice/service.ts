// Voice mode in main (ADR 0152): starts the voice process (voice/worker.ts, an Electron utility process) when the user
// first needs it, keeps the VoiceState the renderer shows (models on disk, download progress, last error), and relays
// the microphone's chunks in and the transcripts and spoken audio out. Nothing is recorded to disk and nothing leaves
// the PC except the one-time model downloads (pinned files, voice/catalog.ts). SB_VOICE_FAKE=1 (e2e, demo) swaps the
// engine for a fake that "hears" SB_VOICE_FAKE_TEXT once per listening session and speaks a short silence.
// Wired in main/index.ts (voice:* channels).
import path from 'node:path';
import fs from 'node:fs';
import { log } from '../log';
import { ASR, TTS, VAD, partBytes } from './catalog';
import { partReady } from './download';
import type { VoiceIn, VoiceOut } from './protocol';
import type { VoiceAsr, VoiceName, VoiceState } from '@shared/voice';

interface Child { postMessage(m: VoiceIn): void; on(ev: 'message', fn: (m: VoiceOut) => void): void; on(ev: 'exit', fn: (code: number) => void): void; kill(): boolean }
export interface VoiceDeps {
  /** userData/voice */
  root: string;
  /** the worker script (out/main/voice-worker.js) */
  script: string;
  settings: () => { asr: VoiceAsr; voice: VoiceName };
  fork: (script: string) => Child;
  changed: (s: VoiceState) => void;
  heard: (text: string) => void;
  speech: (active: boolean) => void;
  fake?: { text: string } | null;
}

export class VoiceService {
  private child: Child | null = null;
  private downloading: VoiceState['downloading'] = null;
  private error: string | null = null;
  private speakId = 0;
  private readonly speaks = new Map<number, (r: { samples: Float32Array; rate: number; error?: string }) => void>();
  private fakeTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly d: VoiceDeps) {}

  state(): VoiceState {
    const { asr, voice } = this.d.settings();
    if (this.d.fake) return { ready: { vad: true, asr: true, tts: true }, asr, voice, downloading: null, error: null, missingMb: 0, fake: true };
    const parts = [VAD, ASR[asr], TTS[voice]];
    const ready = { vad: partReady(this.d.root, VAD), asr: partReady(this.d.root, ASR[asr]), tts: partReady(this.d.root, TTS[voice]) };
    const missing = parts.filter(p => !partReady(this.d.root, p)).reduce((n, p) => n + partBytes(p), 0);
    return { ready, asr, voice, downloading: this.downloading, error: this.error, missingMb: Math.round(missing / 1e6) };
  }

  private emit(): void { this.d.changed(this.state()); }

  private proc(): Child {
    if (this.child) return this.child;
    fs.mkdirSync(this.d.root, { recursive: true });
    const c = this.d.fork(this.d.script);
    c.on('message', m => this.onMessage(m));
    c.on('exit', code => {
      if (this.child !== c) return;
      this.child = null;
      if (this.downloading) { this.downloading = null; this.error = 'Il motore voce si è fermato durante il download: riprova.'; }
      for (const done of this.speaks.values()) done({ samples: new Float32Array(0), rate: 22050, error: 'motore voce fermo' });
      this.speaks.clear();
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
      case 'heard': this.d.heard(m.text); return;
      case 'speech': this.d.speech(m.active); return;
      case 'spoken': { const done = this.speaks.get(m.id); this.speaks.delete(m.id); done?.(m); return; }
      case 'error':
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

  listen(on: boolean): void {
    if (this.d.fake) {
      if (this.fakeTimer) clearTimeout(this.fakeTimer);
      this.fakeTimer = on ? setTimeout(() => { this.d.speech(true); this.d.speech(false); this.d.heard(this.d.fake!.text); }, 600) : null;
      return;
    }
    if (!on && !this.child) return;
    this.proc().postMessage({ type: 'listen', on, asr: this.d.settings().asr });
  }

  audio(samples: Float32Array): void {
    if (this.d.fake || !(samples instanceof Float32Array) || samples.length > 64_000) return;
    this.proc().postMessage({ type: 'audio', samples });
  }

  speak(text: string, voice?: VoiceName): Promise<{ samples: Float32Array; rate: number; error?: string }> {
    const clean = String(text ?? '').slice(0, 2000).trim();
    if (!clean) return Promise.resolve({ samples: new Float32Array(0), rate: 22050 });
    if (this.d.fake) return Promise.resolve({ samples: new Float32Array(6615), rate: 22050 });
    const id = ++this.speakId;
    return new Promise(res => {
      this.speaks.set(id, res);
      this.proc().postMessage({ type: 'speak', id, text: clean, voice: voice ?? this.d.settings().voice });
    });
  }

  /** settings changed (another Whisper or voice): the loaded models are dropped, the next use loads the new ones */
  settingsChanged(): void { this.child?.postMessage({ type: 'unload' }); this.emit(); }

  dispose(): void { if (this.fakeTimer) clearTimeout(this.fakeTimer); this.child?.kill(); this.child = null; }
}

export const voiceRoot = (userData: string): string => path.join(userData, 'voice');
