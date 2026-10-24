// The Orchestrator and the call recordings (ADR 0154; owner 2026-10-24: «basta che chieda all'orchestrator voglio fare
// questo bug … l'app in generale sa che deve andare a vedersi la registrazione»): app_recordings lists the recordings
// and reads a transcript (made on the PC by Whisper, zero tokens; reading it costs only the lines asked for), and lists
// the audio and video files of the last weeks found on the PC that are not imported yet; app_recording_import asks the
// app to import one of those (the Registrazioni page decodes it, then Whisper transcribes it). Only on the Orchestrator's
// own endpoint: a call is the user's private conversation.
import os from 'node:os';
import { clock, type Recording } from '../../shared/recordings';
import { findRecordings } from '../recordings/find';
import type { EventMap } from '../../shared/contract';

export interface RecordingsRead {
  list(): Recording[];
  text(id: string): string | null;
  textFile(id: string): string;
}
interface Tool { name: string; description: string; inputSchema: object; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean }; run(a: Record<string, unknown>): Promise<object | string> | object | string }

const TEXT_MAX = 40_000;
const day = (at: number) => new Date(at).toISOString().slice(0, 16).replace('T', ' ');

export function recordingTools(rec: RecordingsRead, emitUi: (cmd: EventMap['ui:command']) => void, home = os.homedir()): Tool[] {
  return [{
    name: 'app_recordings',
    description: 'The user\'s call recordings and imported audio/video files (Registrazioni page), each transcribed on the PC by the local Whisper (zero tokens). Without id: the list (id, title, date, length, status, transcript lines and file) plus, with pc=true, the audio/video files of the last 30 days found on the PC and not imported yet (Downloads, Documents, Videos, Desktop, OneDrive Recordings…; import one with app_recording_import). With id: the transcript as text, «[mm:ss] Tu:» = the user (microphone), «Altri:» = the other participants (PC audio); query = only the lines with those words; offset = where to go on in a long one. Use it when the user mentions a call, a meeting or a recording («fai il bug della call di ieri»): find the recording by date/title, read it, then act on what was said.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: { type: 'object', properties: {
      id: { type: 'string', description: 'a recording id from the list' },
      query: { type: 'string', description: 'words to find in the transcript (with id)' },
      offset: { type: 'number', description: 'character offset in a long transcript (with id)' },
      pc: { type: 'boolean', description: 'also list audio/video files found on the PC, not imported yet' },
    }, required: [] },
    run: async a => {
      const list = rec.list();
      if (typeof a.id === 'string' && a.id) {
        const r = list.find(x => x.id === a.id);
        if (!r) throw new Error(`registrazione sconosciuta: ${a.id} (vedi app_recordings senza id)`);
        const text = rec.text(r.id);
        if (!text) return { id: r.id, title: r.title, status: r.status, note: r.status === 'error' ? `trascrizione fallita: ${r.error ?? ''}` : 'trascrizione non ancora pronta: riprova tra poco' };
        if (typeof a.query === 'string' && a.query.trim()) {
          const words = a.query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
          const hits = text.split('\n').filter(l => l.startsWith('[') && words.some(w => l.toLowerCase().includes(w)));
          return { id: r.id, title: r.title, matches: hits.length, lines: hits.slice(0, 80).join('\n') };
        }
        const from = Math.max(0, Math.floor(Number(a.offset) || 0));
        const part = text.slice(from, from + TEXT_MAX);
        return { id: r.id, title: r.title, file: rec.textFile(r.id), text: part, ...(from + TEXT_MAX < text.length ? { more: true, nextOffset: from + TEXT_MAX, total: text.length } : {}) };
      }
      const out: Record<string, unknown> = {
        recordings: list.slice(0, 50).map(r => ({ id: r.id, title: r.title, when: day(r.startedAt), length: clock(r.durationMs), source: r.source, status: r.status,
          ...(r.lines !== undefined ? { lines: r.lines } : {}), ...(r.status === 'transcribing' ? { progress: r.progress } : {}), ...(r.status === 'ready' ? { file: rec.textFile(r.id) } : {}),
          ...(r.source === 'call' && r.systemAudio === false ? { note: 'solo microfono' } : {}) })),
      };
      if (!list.length) out.note = 'Nessuna registrazione nell’app. Con pc=true cerco i file audio/video recenti sul PC.';
      if (a.pc === true) {
        const done = new Set(list.map(r => r.fromPath?.toLowerCase()).filter(Boolean));
        out.onPc = (await findRecordings(home)).filter(f => !done.has(f.path.toLowerCase()))
          .map(f => ({ path: f.path, name: f.name, folder: f.folder, when: day(f.mtime), mb: Math.round(f.size / 1e5) / 10 }));
      }
      return out;
    },
  }, {
    name: 'app_recording_import',
    description: 'Import an audio/video file listed by app_recordings pc=true into the app\'s recordings: the Registrazioni page opens, decodes it and the local Whisper transcribes it (zero tokens, a few minutes for a long call). Then read it with app_recordings.',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'the file\'s path from app_recordings pc=true' } }, required: ['path'] },
    run: async a => {
      const p = String(a.path ?? '');
      const found = await findRecordings(home);
      if (!found.some(f => f.path === p)) throw new Error('file non tra quelli trovati sul PC: usa un path di app_recordings pc=true');
      emitUi({ action: 'recImport', value: p });
      return { ok: true, note: 'Import avviato nella pagina Registrazioni. La trascrizione arriva tra qualche minuto: controlla con app_recordings.' };
    },
  }];
}
