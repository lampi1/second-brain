// Messages between main (voice/service.ts) and the voice process (voice/worker.ts), ADR 0152.
import type { VoiceAsr, VoiceName } from '@shared/voice';

export type VoiceIn =
  | { type: 'init'; root: string; asr: VoiceAsr }
  | { type: 'state'; asr: VoiceAsr; voice: VoiceName }
  | { type: 'prepare'; asr: VoiceAsr; voice: VoiceName }
  /** on: Whisper (and, for a conversation, the voice) load now, not at the first sentence */
  | { type: 'listen'; on: boolean; asr: VoiceAsr; voice?: VoiceName }
  | { type: 'audio'; samples: Float32Array }
  | { type: 'speak'; id: number; text: string; voice: VoiceName }
  | { type: 'unload'; asr: VoiceAsr }
  /** a recording's WAV to transcribe (ADR 0154): one line per utterance, per channel (a call: 0 = me, 1 = others) */
  | { type: 'transcribe'; job: number; wav: string; asr: VoiceAsr }
  | { type: 'tcancel'; job: number };

export type VoiceOut =
  | { type: 'up' }
  | { type: 'state'; ready: { vad: boolean; asr: boolean; tts: boolean } }
  | { type: 'progress'; done: number; total: number }
  | { type: 'prepared' }
  | { type: 'speech'; active: boolean }
  | { type: 'heard'; text: string; ms: number }
  | { type: 'spoken'; id: number; samples: Float32Array; rate: number; error?: string }
  | { type: 'error'; message: string }
  | { type: 'tprogress'; job: number; done: number }
  | { type: 'transcribed'; job: number; lines: { start: number; end: number; ch: number; text: string }[]; error?: string };
