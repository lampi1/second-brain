// Voice mode (ADR 0152), call recordings (ADR 0154) and Impara lessons (ADR 0185).
// One area of the IPC contract: src/shared/contract.ts re-exports it and assembles the channel maps (change a shape
// here first, then both sides).
import type { ImparaState, Lesson, LessonConfidence, LessonExtraKind, LessonStart, TutorMode } from '../lesson';
import type { RecFound, RecSegment, RecSource, RecState, Recording } from '../recordings';
import type { ReviewCard, ReviewGrade, ReviewItem, ReviewMode } from '../review';
import type { StudioKind } from '../lesson-studio';
import type { VoiceName, VoiceState } from '../voice';

/** renderer → main, media: each entry [argument, result]. Part of InvokeMap (src/shared/contract.ts). */
export interface MediaInvokeMap {
  /** voice mode (ADR 0152, main/voice/): the models and the engine now; prepare = download the missing ones (the user's
   *  click or first Ctrl+M); listen = the microphone opened or closed; audio = a 16 kHz mono chunk of it (never stored);
   *  speak = Italian speech for a text (the renderer plays it) */
  'voice:state': [void, VoiceState];
  'voice:prepare': [void, VoiceState];
  'voice:listen': [{ on: boolean; session: string; talk?: boolean }, void];
  'voice:cancelSpeech': [void, void];
  'voice:audio': [{ session: string; samples: Float32Array }, void];
  /** push to talk released (ADR 0152): close what was said now */
  'voice:commit': [{ session: string }, void];
  'voice:speak': [{ text: string; voice?: VoiceName }, { samples: Float32Array; rate: number; error?: string }];
  /** call recordings (ADR 0154, main/recordings/): arm = the PC's audio may be captured for the next few seconds (the
   *  user's «Registra call»), start one, its 16-bit chunks, stop (queues the local transcript), the transcript, «Trovate sul PC» and the bytes of
   *  one of those files (only a listed one), open the audio / text / folder with the system */
  'rec:state': [void, RecState];
  'rec:arm': [void, void];
  'rec:start': [{ source: RecSource; channels: 1 | 2; title?: string; from?: string; fromPath?: string; systemAudio?: boolean }, Recording];
  'rec:chunk': [{ id: string; pcm: Uint8Array }, number];
  'rec:stop': [{ id: string }, Recording | null];
  'rec:transcribe': [{ id: string }, void];
  'rec:rename': [{ id: string; title: string }, Recording];
  'rec:remove': [{ id: string }, void];
  'rec:transcript': [{ id: string }, { recording: Recording | null; segments: RecSegment[] }];
  'rec:find': [void, RecFound[]];
  'rec:readFound': [{ path: string }, Uint8Array];
  'rec:open': [{ id: string; what: 'audio' | 'text' | 'folder' }, void];
  /** Impara (ADR 0185, main/learn/): the saved lessons, one whole, a new one (its material is gathered and the model
   *  writes it in the background: 'impara:changed' brings each step), where the user is, an extra piece at a piece, a
   *  check's answer, the final «Spiegalo tu», «Riprova», delete */
  'impara:state': [void, ImparaState];
  'impara:get': [{ id: string }, Lesson | null];
  'impara:start': [LessonStart, Lesson];
  'impara:move': [{ id: string; at: string }, Lesson];
  'impara:ask': [{ id: string; kind: LessonExtraKind; at: string; text?: string }, Lesson];
  /** choice: an option, or for order and match (ADR 0204) the list of shared/quiz.ts QuizResponse */
  'impara:answer': [{ id: string; checkId: string; choice: number | number[]; confidence?: LessonConfidence }, Lesson];
  'impara:explain': [{ id: string; text: string }, Lesson];
  'impara:retry': [{ id: string }, Lesson];
  /** the answers to the questions asked before the lesson (ADR 0188); '' = skipped */
  'impara:clarify': [{ id: string; answers: string[] }, Lesson];
  /** the public topics from the user's files that wait to be searched on the web (ADR 0206): ✕ drops one, go = now */
  'impara:topics': [{ id: string; drop?: string; go?: boolean }, Lesson];
  'impara:remove': [{ id: string }, void];
  /** the review (ADR 0189): a session's cards (the due ones, or a subject's quiz), a card's grade, a lesson's subject */
  'impara:queue': [{ mode: ReviewMode; subject?: string; lesson?: string }, ReviewItem[]];
  'impara:grade': [{ card: string; grade: ReviewGrade }, ReviewCard];
  'impara:subject': [{ id: string; subject: string }, Lesson];
  /** the tutor (ADR 0190): a question beside the lesson ('impara:tutor' streams the answer), and the session started
   *  ahead while the learner opens the tutor or types */
  'impara:tutor': [{ id: string; at: string; q: string; mode?: TutorMode }, Lesson];
  'impara:tutorWarm': [{ id: string }, void];
  /** a «Studio» tile (ADR 0205): one short run over the lesson's verified facts; the output lands on the lesson */
  'impara:studio': [{ id: string; kind: StudioKind }, Lesson];
}
