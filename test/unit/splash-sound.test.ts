// The opening motif respects existing sound/DND and microphone policies, never retries blocked autoplay, and
// releases scheduled oscillators and its private audio context on normal completion, failure, skip or unmount.
import { describe, expect, it, vi } from 'vitest';
import { SPLASH_NOTES, playSplashSound, splashCanSound } from '../../src/renderer/lib/splash-sound';

const allowed: Parameters<typeof splashCanSound>[0] = {
  mode: 'on', reduced: false, visible: true, frozen: false, voiceOff: true, recorderOff: true, now: 1000,
  settings: { tasks: { enabled: true, everyMin: 5, sound: true }, dnd: false, dndUntil: null },
};

function audio(state: AudioContextState = 'running') {
  const nodes: { oscillator: ReturnType<typeof oscillator>; gain: ReturnType<typeof gain> }[] = [];
  const oscillator = () => ({
    frequency: { setValueAtTime: vi.fn() }, type: '', connect: vi.fn((g: unknown) => g),
    start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), onended: null as (() => void) | null,
  });
  const gain = () => ({
    gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn(), disconnect: vi.fn(),
  });
  const context = {
    state, currentTime: 0, destination: {}, close: vi.fn(async () => {}), resume: vi.fn(),
    createOscillator: vi.fn(() => { const pair = { oscillator: oscillator(), gain: gain() }; nodes.push(pair); return pair.oscillator; }),
    createGain: vi.fn(() => nodes.at(-1)!.gain),
  };
  return { context, nodes, create: () => context as unknown as AudioContext };
}

describe('opening sound policy', () => {
  it('requires known preferences and stays silent for previews, reduced motion, hidden windows, frozen demos and any microphone activity', () => {
    expect(splashCanSound(allowed)).toBe(true);
    for (const patch of [
      { settings: null }, { mode: 'hold' as const }, { reduced: true }, { visible: false },
      { frozen: true }, { voiceOff: false }, { recorderOff: false },
    ]) expect(splashCanSound({ ...allowed, ...patch })).toBe(false);
  });
  it('respects the existing sound switch and permanent or timed do-not-disturb', () => {
    const settings = allowed.settings!;
    expect(splashCanSound({ ...allowed, settings: { ...settings, tasks: { ...settings.tasks, sound: false } } })).toBe(false);
    expect(splashCanSound({ ...allowed, settings: { ...settings, dnd: true } })).toBe(false);
    expect(splashCanSound({ ...allowed, settings: { ...settings, dndUntil: 2000 } })).toBe(false);
    expect(splashCanSound({ ...allowed, settings: { ...settings, dndUntil: 900 } })).toBe(true);
  });
});

describe('opening sound cleanup', () => {
  it('schedules one quiet motif and closes after the last note', () => {
    const a = audio();
    playSplashSound(a.create);
    expect(a.nodes).toHaveLength(SPLASH_NOTES.length);
    expect(Math.max(...SPLASH_NOTES.map(n => n.at + n.duration))).toBeLessThan(4.5);
    expect(SPLASH_NOTES.reduce((sum, n) => sum + n.volume, 0)).toBeLessThan(0.11);
    for (const pair of a.nodes) { expect(pair.oscillator.start).toHaveBeenCalledOnce(); pair.oscillator.onended!(); }
    expect(a.context.close).toHaveBeenCalledOnce();
  });
  it('cancels scheduled notes immediately and is safe to call repeatedly', () => {
    const a = audio();
    const stop = playSplashSound(a.create);
    stop(); stop();
    for (const pair of a.nodes) {
      expect(pair.gain.disconnect).toHaveBeenCalledOnce();
      expect(pair.oscillator.stop).toHaveBeenCalledTimes(2); // scheduled ending, then immediate cancellation
      expect(pair.oscillator.stop).toHaveBeenLastCalledWith();
    }
    expect(a.context.close).toHaveBeenCalledOnce();
    for (const pair of a.nodes) pair.oscillator.onended!();
    expect(a.context.close).toHaveBeenCalledOnce();
  });
  it('never resumes suspended autoplay, so a future user gesture cannot replay the cue', () => {
    const a = audio('suspended');
    playSplashSound(a.create)();
    expect(a.context.resume).not.toHaveBeenCalled();
    expect(a.nodes).toHaveLength(0);
    expect(a.context.close).toHaveBeenCalledOnce();
  });
  it('tolerates an unavailable audio device and cleans up a partial graph', () => {
    expect(() => playSplashSound(() => { throw new Error('No device'); })()).not.toThrow();
    const a = audio();
    a.context.createGain.mockImplementationOnce(() => { throw new Error('Device disappeared'); });
    const stop = playSplashSound(a.create);
    stop();
    expect(a.context.close).toHaveBeenCalledOnce();
  });
});
