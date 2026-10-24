// Messages between main (voice/service.ts) and the voice process (voice/worker.ts), ADR 0152.
import type { VoiceAsr, VoiceName } from '@shared/voice';

export type VoiceIn =
  | { type: 'init'; root: string; asr: VoiceAsr }
  | { type: 'state'; asr: VoiceAsr; voice: VoiceName }
  | { type: 'prepare'; asr: VoiceAsr; voice: VoiceName }
  | { type: 'listen'; on: boolean; asr: VoiceAsr }
  | { type: 'audio'; samples: Float32Array }
  | { type: 'speak'; id: number; text: string; voice: VoiceName }
  | { type: 'unload' };

export type VoiceOut =
  | { type: 'up' }
  | { type: 'state'; ready: { vad: boolean; asr: boolean; tts: boolean } }
  | { type: 'progress'; done: number; total: number }
  | { type: 'prepared' }
  | { type: 'speech'; active: boolean }
  | { type: 'heard'; text: string; ms: number }
  | { type: 'spoken'; id: number; samples: Float32Array; rate: number; error?: string }
  | { type: 'error'; message: string };
