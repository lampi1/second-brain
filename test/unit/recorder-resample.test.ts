// The call recorder's downsampler (ADR 0154, src/renderer/lib/recorder.ts resampler): it keeps its fractional position
// across blocks, so 48 kHz audio in 4096-sample blocks gives exactly a third as many 16 kHz samples, and a constant stays
// constant.
import { expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/lib/voice', () => ({ stopVoice: vi.fn(), blockVoiceWhile: vi.fn(), voice: { get: () => ({ phase: 'off' }) } }));
vi.mock('../../src/renderer/store/ui', () => ({ toast: vi.fn() }));
import { resampler } from '../../src/renderer/lib/recorder';

it('keeps the exact length over many blocks', () => {
  for (const rate of [48_000, 44_100]) {
    const r = resampler(rate / 16_000);
    let n = 0;
    const blocks = 1000;
    for (let b = 0; b < blocks; b++) n += r(new Float32Array(4096).fill(0.5)).length;
    expect(Math.abs(n - (blocks * 4096 * 16_000) / rate)).toBeLessThanOrEqual(1);
  }
});
it('averages each span', () => {
  const r = resampler(3);
  expect(Array.from(r(Float32Array.from([1, 1, 1, 0, 0, 0, 2])))).toEqual([1, 0]);
  expect(Array.from(r(Float32Array.from([2, 2])))).toEqual([2]);
});
