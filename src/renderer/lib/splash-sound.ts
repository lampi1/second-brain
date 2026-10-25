// A quiet, original four-note opening motif, synthesized locally. Splash.tsx supplies the existing sound/DND
// preferences and voice/visibility state. No files, autoplay retry, shared notification queue or lasting context.
import type { Settings } from '@shared/contract';
import type { SplashMode } from './splash';

export const SPLASH_NOTES = [
  { frequency: 196, at: 0, duration: 2.7, volume: 0.035 },
  { frequency: 293.665, at: 0.48, duration: 2.6, volume: 0.027 },
  { frequency: 440, at: 1.02, duration: 2.5, volume: 0.023 },
  { frequency: 587.33, at: 1.64, duration: 2.4, volume: 0.018 },
] as const;

export function splashCanSound(options: {
  mode: SplashMode; reduced: boolean; visible: boolean; frozen: boolean; voiceOff: boolean; recorderOff: boolean;
  settings: Pick<Settings, 'tasks' | 'dnd' | 'dndUntil'> | null; now: number;
}): boolean {
  const s = options.settings;
  return options.mode === 'on' && !options.reduced && options.visible && !options.frozen && options.voiceOff && options.recorderOff
    && !!s && s.tasks?.sound !== false && !s.dnd && !(s.dndUntil && s.dndUntil > options.now);
}

/** Returns a cancellation function. A suspended or unavailable device stays silent, without resuming later. */
export function playSplashSound(create: () => AudioContext = () => new window.AudioContext()): () => void {
  let context: AudioContext | null = null;
  const nodes: { oscillator: OscillatorNode; gain: GainNode }[] = [];
  let stopped = false, closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try { void context?.close().catch(() => {}); } catch { /* device disappeared */ }
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const { oscillator, gain } of nodes) {
      // Disconnect first: even a device that cannot stop its scheduled sources becomes silent immediately.
      gain.disconnect();
      try { oscillator.stop(); } catch { /* already ended */ }
      oscillator.disconnect();
    }
    close();
  };
  try {
    context = create();
    if (context.state !== 'running') { stop(); return stop; }
    const at = context.currentTime + 0.02;
    let remaining = SPLASH_NOTES.length;
    for (const note of SPLASH_NOTES) {
      const oscillator = context.createOscillator(), gain = context.createGain();
      nodes.push({ oscillator, gain });
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(note.frequency, at + note.at);
      gain.gain.setValueAtTime(0, at + note.at);
      gain.gain.linearRampToValueAtTime(note.volume, at + note.at + 0.25);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + note.at + note.duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); if (--remaining === 0) close(); };
      oscillator.start(at + note.at);
      oscillator.stop(at + note.at + note.duration + 0.02);
    }
  } catch { stop(); }
  return stop;
}
