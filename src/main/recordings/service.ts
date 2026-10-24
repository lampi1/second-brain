// Call recordings in main (ADR 0154): the renderer captures (lib/recorder.ts: the microphone on the left, the PC's audio
// on the right, both at 16 kHz) and sends a chunk a second; this service writes them (store.ts), and when a recording
// stops it queues the transcription: one at a time, by the local Whisper in the voice process (voice/service.ts
// transcribe), zero tokens. Imports go the same way (the renderer decodes the file, mono). «Trovate sul PC» lists audio
// and video files in the usual folders (find.ts); only a file from that list can be read back for import. Wired in
// main/index.ts (rec:* channels); the Orchestrator reads the list and the transcripts with app_recordings (appctl).
import fs from 'node:fs';
import { log } from '../log';
import type { RecordingStore } from './store';
import { findRecordings } from './find';
import { REC_IMPORT_MAX_BYTES, REC_MAX_MS, defaultTitle, dropEchoes, type RecFound, type RecSegment, type RecSource, type RecState, type Recording } from '@shared/recordings';
import type { VoiceAsr } from '@shared/voice';
import type { TranscribedLine } from '../voice/transcribe';

export interface RecordingDeps {
  store: RecordingStore;
  transcribe: (wav: string, progress: (done: number) => void) => { result: Promise<{ lines: TranscribedLine[]; error?: string }>; cancel: () => void };
  asr: () => VoiceAsr;
  changed: (s: RecState) => void;
  home: string;
  now?: () => number;
}

/** the largest chunk the renderer may send at once (a second of stereo is 64 KB; an import sends 30 s mono, ~1 MB) */
const CHUNK_MAX = 2 * 1024 * 1024;

export class RecordingService {
  private active: string | null = null;
  private readonly waiting: string[] = [];
  private running: { id: string; cancel: () => void } | null = null;
  private found: RecFound[] = [];
  private readonly now: () => number;
  constructor(private readonly d: RecordingDeps) { this.now = d.now ?? Date.now; }

  state(): RecState { return { list: this.d.store.list(), active: this.active, dir: this.d.store.root }; }
  private emit(): void { this.d.changed(this.state()); }

  /** At start: recordings the app did not close are closed; unfinished transcriptions run again. */
  recover(): void {
    try { for (const id of this.d.store.recover()) this.queue(id); } catch (e) { log.warn('recordings', 'recover failed', { cause: String(e) }); }
  }

  start(a: { source: RecSource; channels: 1 | 2; title?: string; from?: string; fromPath?: string; systemAudio?: boolean }): Recording {
    if (a.source === 'call' && this.active) throw new Error('C’è già una registrazione in corso.');
    const at = this.now();
    const from = a.from ? String(a.from).slice(0, 200) : undefined;
    const fromPath = a.fromPath && this.found.some(f => f.path === a.fromPath) ? a.fromPath : undefined;
    const r = this.d.store.start({ source: a.source, channels: a.channels === 2 ? 2 : 1, title: (a.title?.trim() || defaultTitle(at, a.source, from)).slice(0, 120), startedAt: at,
      ...(from ? { from } : {}), ...(fromPath ? { fromPath } : {}), ...(a.source === 'call' ? { systemAudio: !!a.systemAudio } : {}) }, at);
    if (a.source === 'call') this.active = r.id;
    log.info('recordings', 'recording started', { data: { id: r.id, source: r.source, channels: r.channels, systemAudio: r.systemAudio } });
    this.emit();
    return r;
  }

  /** A chunk of 16-bit samples; a call that passes REC_MAX_MS stops by itself. Returns the length so far (ms). */
  chunk(id: string, pcm: unknown): number {
    if (!(pcm instanceof Uint8Array) || pcm.byteLength > CHUNK_MAX) throw new Error('blocco audio non valido');
    const ms = this.d.store.append(id, pcm);
    if (id === this.active && ms >= REC_MAX_MS) { this.stop(id); log.warn('recordings', 'recording stopped at the maximum length', { data: { id } }); }
    return ms;
  }

  /** Stops it and queues its transcript (a recording under a second is dropped: a click by mistake). */
  stop(id: string): Recording | null {
    if (!this.d.store.isOpen(id)) return this.d.store.get(id);
    const r = this.d.store.stop(id);
    if (this.active === id) this.active = null;
    log.info('recordings', 'recording saved', { data: { id, ms: r.durationMs, bytes: r.bytes } });
    if (r.durationMs < 1000) { this.d.store.remove(id); this.emit(); return null; }
    this.queue(id);
    this.emit();
    return this.d.store.get(id);
  }

  /** «Trascrivi» / «Riprova»: (again) into the queue. */
  queue(id: string): void {
    const r = this.d.store.get(id);
    if (!r || r.status === 'recording' || this.waiting.includes(id) || this.running?.id === id) return;
    this.d.store.update(id, { status: 'queued', progress: 0, error: undefined });
    this.waiting.push(id);
    this.emit();
    this.next();
  }

  private next(): void {
    if (this.running) return;
    const id = this.waiting.shift();
    if (!id) return;
    const r = this.d.store.get(id);
    if (!r) { this.next(); return; }
    this.d.store.update(id, { status: 'transcribing', progress: 0 });
    this.emit();
    const asr = this.d.asr();
    const started = this.now();
    const job = this.d.transcribe(this.d.store.wav(id), done => {
      if (!this.d.store.get(id)) return;
      this.d.store.update(id, { progress: Math.round(done * 100) / 100 });
      this.emit();
    });
    this.running = { id, cancel: job.cancel };
    void job.result.then(({ lines, error }) => {
      if (this.running?.id !== id) return; // removed meanwhile
      this.running = null;
      if (!this.d.store.get(id)) { this.next(); return; }
      if (error) {
        this.d.store.update(id, { status: 'error', progress: undefined, error });
        log.warn('recordings', 'transcription failed', { cause: error, data: { id }, hint: 'Impostazioni → Voce: are the models downloaded?' });
      } else {
        const segs: RecSegment[] = lines.map(l => ({ start: l.start, end: l.end, who: r.channels === 2 ? (l.ch === 0 ? 'me' : 'others') : null, text: l.text }));
        this.d.store.writeTranscript(id, dropEchoes(segs), asr, this.now());
        log.info('recordings', 'transcript written', { data: { id, lines: segs.length, ms: this.now() - started, audioMs: r.durationMs, asr } });
      }
      this.emit();
      this.next();
    });
  }

  rename(id: string, title: string): Recording {
    const t = String(title ?? '').trim().slice(0, 120);
    if (!t) throw new Error('nome vuoto');
    const r = this.d.store.update(id, { title: t });
    // the text file carries the title in its header
    if (r.status === 'ready') this.d.store.writeTranscript(id, this.d.store.transcript(id), r.asr, r.transcribedAt);
    this.emit();
    return this.d.store.get(id)!;
  }

  remove(id: string): void {
    if (this.running?.id === id) { const c = this.running.cancel; this.running = null; c(); }
    const w = this.waiting.indexOf(id);
    if (w >= 0) this.waiting.splice(w, 1);
    if (this.d.store.isOpen(id)) { this.d.store.stop(id); if (this.active === id) this.active = null; }
    this.d.store.remove(id);
    this.emit();
    this.next();
  }

  transcript(id: string): { recording: Recording | null; segments: RecSegment[] } {
    return { recording: this.d.store.get(id), segments: this.d.store.transcript(id) };
  }

  /** Audio and video files of the last weeks on the PC, the ones already imported left out. */
  async findOnPc(): Promise<RecFound[]> {
    const done = new Set(this.d.store.list().map(r => r.fromPath?.toLowerCase()).filter(Boolean));
    this.found = (await findRecordings(this.d.home, this.now())).filter(f => !done.has(f.path.toLowerCase()));
    return this.found;
  }

  /** The bytes of a file «Trovate sul PC» listed (only those: the renderer cannot ask for any other path). */
  readFound(p: string): Uint8Array {
    const f = this.found.find(x => x.path === p);
    if (!f) throw new Error('file non trovato: aggiorna «Trovate sul PC»');
    const st = fs.statSync(p);
    if (st.size > REC_IMPORT_MAX_BYTES) throw new Error('file troppo grande (oltre 1 GB)');
    return fs.readFileSync(p);
  }

  dispose(): void {
    this.running?.cancel();
    this.running = null;
    this.d.store.closeAll();
  }
}
