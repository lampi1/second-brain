// IPC handlers, Voice mode (ADR 0152), call recordings (ADR 0154) and Impara lessons (ADR 0185). Registered by
// src/main/index.ts with every other group (Handlers in ipc.ts keeps the set complete); each channel's shape is in
// src/shared/contract/*.ts.
import { armLoopback } from '../window';
import { shell } from 'electron';
import { tutorModeOf } from '@shared/lesson';
import { VOICE_NAMES, type VoiceName } from '@shared/voice';
import type { HandlerContext, HandlersOf } from './context';

export function mediaHandlers({ s, voice, recordings, learn }: HandlerContext): HandlersOf<'voice' | 'rec' | 'impara'> {
  return {
    'voice:state': () => voice.state(),
    'voice:prepare': a => voice.prepare(a && VOICE_NAMES.includes(a.voice as VoiceName) ? a.voice : undefined),
    'voice:listen': a => voice.listen(a?.on === true, a?.session, a?.talk === true),
    'voice:audio': a => voice.audio(a?.samples, a?.session),
    'voice:commit': a => voice.commit(a?.session),
    'voice:cancelSpeech': () => voice.cancelSpeech(),
    'voice:speak': a => voice.speak(String(a?.text ?? ''), a?.voice && ['paola', 'miro', 'dii'].includes(a.voice) ? a.voice : undefined),
    'rec:state': () => recordings.state(),
    'rec:arm': () => armLoopback(),
    'rec:start': a => recordings.start({ source: a?.source === 'file' ? 'file' : 'call', channels: a?.channels === 2 ? 2 : 1, title: typeof a?.title === 'string' ? a.title : undefined,
        from: typeof a?.from === 'string' ? a.from : undefined, fromPath: typeof a?.fromPath === 'string' ? a.fromPath : undefined, systemAudio: a?.systemAudio === true }),
    'rec:chunk': a => recordings.chunk(String(a?.id ?? ''), a?.pcm),
    'rec:stop': a => recordings.stop(String(a?.id ?? '')),
    'rec:transcribe': a => recordings.queue(String(a?.id ?? '')),
    'rec:rename': a => recordings.rename(String(a?.id ?? ''), String(a?.title ?? '')),
    'rec:remove': a => recordings.remove(String(a?.id ?? '')),
    'rec:transcript': a => recordings.transcript(String(a?.id ?? '')),
    'rec:find': () => recordings.findOnPc(),
    'rec:readFound': a => recordings.readFound(String(a?.path ?? '')),
    'rec:open': async a => {
      const id = String(a?.id ?? '');
      if (!s.recordings.get(id)) throw new Error('registrazione sconosciuta');
      if (a?.what === 'folder') { shell.showItemInFolder(s.recordings.wav(id)); return; }
      const err = await shell.openPath(a?.what === 'text' ? s.recordings.textFile(id) : s.recordings.wav(id));
      if (err) throw new Error(err);
    },
    'impara:state': () => learn().state(),
    'impara:get': a => learn().get(String(a?.id ?? '')),
    'impara:start': a => learn().start(a),
    'impara:move': a => learn().move(String(a?.id ?? ''), String(a?.at ?? '')),
    'impara:ask': a => learn().ask(String(a?.id ?? ''), a?.kind, String(a?.at ?? ''), typeof a?.text === 'string' ? a.text : undefined),
    'impara:answer': a => learn().answer(String(a?.id ?? ''), String(a?.checkId ?? ''), Array.isArray(a?.choice) ? a.choice.map(Number) : Number(a?.choice), a?.confidence),
    'impara:explain': a => learn().explain(String(a?.id ?? ''), String(a?.text ?? '')),
    'impara:retry': a => learn().retry(String(a?.id ?? '')),
    'impara:clarify': a => learn().clarify(String(a?.id ?? ''), a?.answers),
    'impara:topics': a => learn().topics(String(a?.id ?? ''), { drop: a?.drop, go: a?.go === true }),
    'impara:remove': a => learn().remove(String(a?.id ?? '')),
    'impara:queue': a => learn().queue(a?.mode, typeof a?.subject === 'string' ? a.subject : undefined, typeof a?.lesson === 'string' ? a.lesson : undefined),
    'impara:grade': a => learn().gradeCard(String(a?.card ?? ''), Number(a?.grade)),
    'impara:subject': a => learn().setSubject(String(a?.id ?? ''), a?.subject),
    'impara:tutor': a => learn().tutor(String(a?.id ?? ''), String(a?.at ?? ''), String(a?.q ?? ''), tutorModeOf(a?.mode)),
    'impara:tutorWarm': a => learn().tutorWarm(String(a?.id ?? '')),
    'impara:studio': a => learn().studio(String(a?.id ?? ''), a?.kind),
  };
}
