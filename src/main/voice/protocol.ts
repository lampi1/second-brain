// Messages between main (voice/service.ts) and the voice process (voice/worker.ts), ADR 0152.
import type { VoiceAsr, VoiceName, VoiceHeard, VoiceSpeech } from '@shared/voice';

export type VoiceIn =
  | { type: 'init'; root: string; asr: VoiceAsr }
  | { type: 'state'; asr: VoiceAsr; voice: VoiceName }
  | { type: 'prepare'; asr: VoiceAsr; voice: VoiceName; only?: 'voice' }
  /** on: Whisper (and, for a conversation, the voice) load now, not at the first sentence */
  | { type: 'listen'; on: boolean; session: string; asr: VoiceAsr; voice?: VoiceName }
  | { type: 'audio'; session: string; samples: Float32Array }
  /** push to talk released: what was said is closed now (no wait for silence), 'committed' once all of it is heard */
  | { type: 'commit'; session: string }
  | { type: 'speak'; id: number; text: string; voice: VoiceName; speed?: number }
  | { type: 'cancel-speech'; through: number }
  | { type: 'unload'; asr: VoiceAsr }
  /** a recording's WAV to transcribe (ADR 0154): one line per utterance, per channel (a call: 0 = me, 1 = others) */
  | { type: 'transcribe'; job: number; wav: string; asr: VoiceAsr }
  | { type: 'tcancel'; job: number };

export type VoiceOut =
  | { type: 'up' }
  | { type: 'state'; ready: { vad: boolean; asr: boolean; tts: boolean } }
  | { type: 'progress'; done: number; total: number }
  | { type: 'prepared' }
  | ({ type: 'speech' } & VoiceSpeech)
  | ({ type: 'heard' } & VoiceHeard)
  | { type: 'spoken'; id: number; samples: Float32Array; rate: number; error?: string }
  | { type: 'error'; message: string }
  | { type: 'committed'; session: string }
  | { type: 'tprogress'; job: number; done: number }
  | { type: 'transcribed'; job: number; lines: { start: number; end: number; ch: number; text: string }[]; error?: string };
