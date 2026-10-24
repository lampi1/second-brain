// The recordings on disk (ADR 0154): userData/recordings/<id>/ holds meta.json, audio.wav (16 kHz 16-bit PCM: a call is
// stereo, left = the user's microphone, right = the PC's audio; an import is mono), and once transcribed transcript.json
// (the lines) and trascrizione.md (the same as text, what the Orchestrator reads). Only on this PC, never in the brain
// (the owner's choice, 2026-10-24: «Solo sul PC (dati app)»). The audio is appended as it arrives, so a crash loses at
// most the last second: at start a recording left «recording» gets its WAV header fixed from the file's size.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { REC_RATE, transcriptText, wavHeader, wavMs, type Recording, type RecSegment } from '@shared/recordings';

const ID = /^\d{8}-\d{6}-[0-9a-f]{4}$/;

export class RecordingStore {
  private readonly open = new Map<string, { fd: number; bytes: number; ch: number }>();
  constructor(readonly root: string) {}

  private dir(id: string): string {
    if (!ID.test(id)) throw new Error(`registrazione sconosciuta: ${id}`);
    return path.join(this.root, id);
  }
  wav(id: string): string { return path.join(this.dir(id), 'audio.wav'); }
  textFile(id: string): string { return path.join(this.dir(id), 'trascrizione.md'); }

  list(): Recording[] {
    let names: string[] = [];
    try { names = fs.readdirSync(this.root).filter(n => ID.test(n)); } catch { return []; }
    return names.map(n => this.get(n)).filter((r): r is Recording => !!r).sort((a, b) => b.startedAt - a.startedAt);
  }

  get(id: string): Recording | null {
    try { return JSON.parse(fs.readFileSync(path.join(this.dir(id), 'meta.json'), 'utf8')) as Recording; } catch { return null; }
  }

  private save(r: Recording): Recording {
    const file = path.join(this.dir(r.id), 'meta.json');
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(r, null, 2));
    fs.renameSync(`${file}.tmp`, file);
    return r;
  }

  update(id: string, patch: Partial<Omit<Recording, 'id'>>): Recording {
    const r = this.get(id);
    if (!r) throw new Error(`registrazione sconosciuta: ${id}`);
    return this.save({ ...r, ...patch, id });
  }

  /** A new recording: its folder, meta.json and a WAV whose header is fixed when it stops. */
  start(meta: Omit<Recording, 'id' | 'status' | 'durationMs' | 'bytes'>, now = Date.now()): Recording {
    const d = new Date(now);
    const p = (n: number) => String(n).padStart(2, '0');
    const id = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${randomBytes(2).toString('hex')}`;
    fs.mkdirSync(this.dir(id), { recursive: true });
    const fd = fs.openSync(this.wav(id), 'w');
    fs.writeSync(fd, wavHeader(0, meta.channels));
    this.open.set(id, { fd, bytes: 0, ch: meta.channels });
    return this.save({ ...meta, id, status: 'recording', durationMs: 0, bytes: 44 });
  }

  isOpen(id: string): boolean { return this.open.has(id); }

  /** Appends 16-bit samples (interleaved when stereo); returns the audio's length so far in ms. */
  append(id: string, pcm: Uint8Array): number {
    const o = this.open.get(id);
    if (!o) throw new Error('la registrazione non è in corso');
    const ch = o.ch;
    const n = pcm.byteLength - (pcm.byteLength % (ch * 2)); // whole frames only
    if (n > 0) { fs.writeSync(o.fd, pcm, 0, n); o.bytes += n; }
    return wavMs(o.bytes, ch);
  }

  /** Stops writing: the header gets the real size; the recording is «saved» (waiting for its transcript). */
  stop(id: string): Recording {
    const o = this.open.get(id);
    const r = this.get(id);
    if (!r) throw new Error(`registrazione sconosciuta: ${id}`);
    if (o) {
      fs.writeSync(o.fd, wavHeader(o.bytes, r.channels), 0, 44, 0);
      fs.closeSync(o.fd);
      this.open.delete(id);
    }
    const bytes = o ? o.bytes : this.dataBytes(id);
    return this.update(id, { status: 'saved', bytes: bytes + 44, durationMs: wavMs(bytes, r.channels) });
  }

  private dataBytes(id: string): number {
    try { return Math.max(0, fs.statSync(this.wav(id)).size - 44); } catch { return 0; }
  }

  /** At start: a recording the app did not stop (a crash, a forced quit) is closed with what reached the disk, and a
   *  transcription that was running starts again. Returns the ids to transcribe. */
  recover(): string[] {
    const again: string[] = [];
    for (const r of this.list()) {
      if (r.status === 'recording' && !this.open.has(r.id)) {
        const bytes = this.dataBytes(r.id) - (this.dataBytes(r.id) % (r.channels * 2));
        try {
          const fd = fs.openSync(this.wav(r.id), 'r+');
          fs.writeSync(fd, wavHeader(bytes, r.channels), 0, 44, 0);
          fs.ftruncateSync(fd, bytes + 44);
          fs.closeSync(fd);
        } catch { /* no audio file: an empty recording */ }
        this.update(r.id, { status: 'saved', bytes: bytes + 44, durationMs: wavMs(bytes, r.channels) });
        if (bytes > REC_RATE * r.channels * 2) again.push(r.id);
      } else if (r.status === 'queued' || r.status === 'transcribing') {
        this.update(r.id, { status: 'queued', progress: 0 });
        again.push(r.id);
      }
    }
    return again;
  }

  writeTranscript(id: string, segs: RecSegment[], asr: Recording['asr'], now = Date.now()): Recording {
    const r = this.get(id);
    if (!r) throw new Error(`registrazione sconosciuta: ${id}`);
    fs.writeFileSync(path.join(this.dir(id), 'transcript.json'), JSON.stringify(segs));
    fs.writeFileSync(this.textFile(id), transcriptText(r, segs));
    return this.update(id, { status: 'ready', progress: undefined, error: undefined, transcribedAt: now, asr, lines: segs.length });
  }

  transcript(id: string): RecSegment[] {
    try { return JSON.parse(fs.readFileSync(path.join(this.dir(id), 'transcript.json'), 'utf8')) as RecSegment[]; } catch { return []; }
  }

  /** The transcript as text (trascrizione.md), or null when there is none yet. */
  text(id: string): string | null {
    try { return fs.readFileSync(this.textFile(id), 'utf8'); } catch { return null; }
  }

  remove(id: string): void {
    if (this.open.has(id)) throw new Error('ferma prima la registrazione');
    fs.rmSync(this.dir(id), { recursive: true, force: true });
  }

  /** The app quits: every open WAV gets its header (the recording stays «recording» until recover() at the next start). */
  closeAll(): void {
    for (const o of this.open.values()) {
      try { fs.writeSync(o.fd, wavHeader(o.bytes, o.ch), 0, 44, 0); fs.closeSync(o.fd); } catch { /* best effort */ }
    }
    this.open.clear();
  }
}
