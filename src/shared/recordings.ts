// Call recordings (ADR 0154, owner 2026-10-24: «avviare una registrazione sia dell'audio del computer che del microfono
// per le call su Teams … si salvi già un file dentro l'app … a zero token»): the shapes main (main/recordings/) and the
// renderer (lib/recorder.ts, components/RecordingsPage.tsx) share, and the pure rules both need: the WAV header, the
// transcript as text, the echo of the call in the microphone. A call is stereo: left = the user's microphone («Tu»),
// right = the PC's audio («Altri»); an imported file is mono (no speakers told apart). Pinned by test/unit/recordings.test.ts.

import type { VoiceAsr } from './voice';

/** call = recorded by the app (mic + PC audio); file = an audio or video file the user imported */
export type RecSource = 'call' | 'file';
/** recording = still running; saved = audio on disk, no transcript yet; queued / transcribing = Whisper's turn;
 *  ready = transcript written; error = the transcription failed (the audio stays) */
export type RecStatus = 'recording' | 'saved' | 'queued' | 'transcribing' | 'ready' | 'error';
export type RecWho = 'me' | 'others';

export interface Recording {
  id: string;
  title: string;
  source: RecSource;
  startedAt: number;
  durationMs: number;
  /** 2 = a call (left me, right others), 1 = an imported file */
  channels: 1 | 2;
  status: RecStatus;
  /** 0..1 while transcribing */
  progress?: number;
  error?: string;
  /** the WAV's size on disk */
  bytes: number;
  /** an imported file's own name, and where it was when the user imported it from «Trovate sul PC» */
  from?: string;
  fromPath?: string;
  /** a call: the PC's audio was captured too (false = microphone only: the system refused or does not support it) */
  systemAudio?: boolean;
  /** when the transcript was written, with which Whisper, how many lines */
  transcribedAt?: number;
  asr?: VoiceAsr;
  lines?: number;
}

/** One transcribed line: milliseconds from the start, who spoke (null = an imported file: not known). */
export interface RecSegment { start: number; end: number; who: RecWho | null; text: string }

/** An audio or video file found on the PC (Downloads, Documents, Videos, Desktop, the Teams «Recordings» folder…). */
export interface RecFound { path: string; name: string; size: number; mtime: number; folder: string }

export interface RecState {
  list: Recording[];
  /** the recording being made now */
  active: string | null;
  /** the folder that holds them (userData/recordings) */
  dir: string;
}

/** 16 kHz is what Whisper and Silero read: the app records at that rate, nothing to convert at transcription time */
export const REC_RATE = 16_000;
/** a call longer than this stops by itself (about 1.8 GB of WAV) */
export const REC_MAX_MS = 8 * 3600_000;
/** an imported file larger than this is refused (the renderer decodes it in memory, and it crosses IPC once) */
export const REC_IMPORT_MAX_BYTES = 500 * 1024 ** 2;
export const REC_EXTENSIONS = ['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.webm', '.flac', '.mp4', '.m4v', '.mov', '.mkv'];

/** The 44-byte header of a PCM 16-bit WAV with `dataBytes` of samples. */
export function wavHeader(dataBytes: number, channels: number, rate = REC_RATE): Uint8Array {
  const b = new Uint8Array(44);
  const v = new DataView(b.buffer);
  const tag = (at: number, s: string) => { for (let i = 0; i < 4; i++) b[at + i] = s.charCodeAt(i); };
  tag(0, 'RIFF'); v.setUint32(4, 36 + dataBytes, true); tag(8, 'WAVE');
  tag(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * channels * 2, true); v.setUint16(32, channels * 2, true); v.setUint16(34, 16, true);
  tag(36, 'data'); v.setUint32(40, dataBytes, true);
  return b;
}

/** Milliseconds of audio in `dataBytes` of 16-bit samples. */
export const wavMs = (dataBytes: number, channels: number, rate = REC_RATE): number => Math.round((dataBytes / (channels * 2) / rate) * 1000);

/** "4:05" or "1:02:09" */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

const words = (s: string): string[] => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter(w => w.length > 1);
function similar(a: string, b: string): number {
  const x = new Set(words(a)), y = new Set(words(b));
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / Math.min(x.size, y.size);
}

/** On speakers the microphone also hears the call: a «Tu» line that says what an «Altri» line says at the same time is
 *  that echo, and is dropped. */
export function dropEchoes(segs: RecSegment[]): RecSegment[] {
  const others = segs.filter(s => s.who === 'others');
  return segs.filter(s => {
    if (s.who !== 'me') return true;
    const len = Math.max(1, s.end - s.start);
    return !others.some(o => {
      const overlap = Math.min(s.end, o.end) - Math.max(s.start, o.start);
      return overlap / len >= 0.5 && similar(s.text, o.text) >= 0.6;
    });
  });
}

/** Lines in time order; consecutive lines of the same speaker less than 2 s apart become one paragraph. */
export function turns(segs: RecSegment[]): RecSegment[] {
  const out: RecSegment[] = [];
  for (const s of [...segs].sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    if (last && last.who === s.who && s.start - last.end < 2000 && last.text.length < 1200) { last.end = Math.max(last.end, s.end); last.text = `${last.text} ${s.text}`; }
    else out.push({ ...s });
  }
  return out;
}

export const whoLabel = (who: RecWho | null): string => (who === 'me' ? 'Tu' : who === 'others' ? 'Altri' : '');

/** The transcript as the Orchestrator and the user's editor read it: a header, then «[mm:ss] Tu: …» lines. */
export function transcriptText(rec: Pick<Recording, 'title' | 'startedAt' | 'durationMs' | 'source' | 'channels'>, segs: RecSegment[]): string {
  const when = new Date(rec.startedAt);
  const date = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')} ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
  const head = [`# ${rec.title}`, '', `${rec.source === 'call' ? 'Call registrata' : 'File importato'} il ${date}, durata ${clock(rec.durationMs)}.`,
    rec.channels === 2 ? '«Tu» = il microfono dell’utente, «Altri» = l’audio del PC (gli altri partecipanti).' : 'Una sola traccia: chi parla non è distinto.', ''];
  return [...head, ...turns(segs).map(s => `[${clock(s.start)}]${s.who ? ` ${whoLabel(s.who)}:` : ''} ${s.text}`)].join('\n') + '\n';
}

/** A recording's default name: «Call del 24 ottobre, 15:30». */
export function defaultTitle(at: number, source: RecSource, from?: string): string {
  if (source === 'file' && from) return from.replace(/\.[a-z0-9]{2,5}$/i, '').slice(0, 80);
  const d = new Date(at);
  const months = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  return `Call del ${d.getDate()} ${months[d.getMonth()]}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Is this a file name the importer can read? */
export const recExtensionOk = (name: string): boolean => REC_EXTENSIONS.some(e => name.toLowerCase().endsWith(e));
