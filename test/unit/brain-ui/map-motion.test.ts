// The motion math of the 3D brain map (lib/map-motion.ts): easing that lands, the live fade carried between two
// snapshots, the pulse along an axon, stable neuron shapes and axon bends.
import { describe, expect, it } from 'vitest';
import { approach, axonBend, breath, CARRY_MS, dendrites, liveTarget, neuronShape, pulseHead, tauFor, TAU_DOWN, TAU_UP } from '../../../src/renderer/brain/lib/map-motion';

describe('approach', () => {
  it('moves towards the target by the elapsed time, never past it', () => {
    const a = approach(0, 1, 100, 100);
    expect(a).toBeGreaterThan(0.6);
    expect(a).toBeLessThan(0.65);
    expect(approach(1, 0, 100, 100)).toBeCloseTo(1 - a, 5);
    expect(approach(0, 1, 100_000, 100)).toBe(1);
  });
  it('lands exactly on the target once close (the loop can rest), and stays put with no time', () => {
    let v = 0;
    for (let i = 0; i < 200 && v !== 1; i++) v = approach(v, 1, 16, 140);
    expect(v).toBe(1);
    expect(approach(0.3, 1, 0, 140)).toBe(0.3);
    expect(approach(0.3, 1, -5, 140)).toBe(0.3);
  });
  it('the same total time gives the same value whatever the frame rate', () => {
    let a = 0, b = 0;
    for (let i = 0; i < 6; i++) a = approach(a, 1, 16.6, 300, 0);
    for (let i = 0; i < 2; i++) b = approach(b, 1, 49.8, 300, 0);
    expect(a).toBeCloseTo(b, 6);
  });
  it('lights up quickly, fades slowly', () => {
    expect(tauFor(0, 1)).toBe(TAU_UP);
    expect(tauFor(1, 0)).toBe(TAU_DOWN);
    expect(TAU_UP).toBeLessThan(TAU_DOWN);
  });
});

describe('liveTarget', () => {
  it('a running call is fully lit', () => { expect(liveTarget(0.2, true, 5000, 15_000)).toBe(1); });
  it('a finished call keeps fading at its own pace between two snapshots', () => {
    expect(liveTarget(0.5, false, 0, 15_000)).toBe(0.5);
    expect(liveTarget(0.5, false, 750, 15_000)).toBeCloseTo(0.45, 6);
  });
  it('without a newer snapshot it stops a little below the last level (frozen clock), never below zero', () => {
    expect(liveTarget(0.5, false, 60_000, 15_000)).toBeCloseTo(0.5 - CARRY_MS / 15_000, 6);
    expect(liveTarget(0.01, false, 1000, 15_000)).toBe(0);
  });
  it('a level still at 1 holds (the call just ended, the snapshot has not started the fade yet)', () => {
    expect(liveTarget(1, false, 900, 15_000)).toBe(1);
  });
});

describe('pulse and breath', () => {
  it('the pulse enters before the source and leaves past the target, once per period', () => {
    expect(pulseHead(0, 1000, 0)).toBeCloseTo(-0.2, 6);
    expect(pulseHead(500, 1000, 0)).toBeCloseTo(0.6, 6);
    expect(pulseHead(999.999, 1000, 0)).toBeCloseTo(1.4, 3);
    expect(pulseHead(1000, 1000, 0)).toBeCloseTo(-0.2, 6);
    expect(pulseHead(-250, 1000, 0)).toBeCloseTo(pulseHead(750, 1000, 0), 6);
  });
  it('breath stays within 0..1', () => {
    for (let t = 0; t < 4000; t += 97) { const b = breath(t, 1.3); expect(b).toBeGreaterThanOrEqual(0); expect(b).toBeLessThanOrEqual(1); }
  });
});

describe('neuron shapes', () => {
  it('the same id gives the same neuron; ids spread over the variants', () => {
    expect(neuronShape('memoria:now.md', 5)).toEqual(neuronShape('memoria:now.md', 5));
    const seen = new Set(Array.from({ length: 40 }, (_, i) => neuronShape(`n${i}`, 5).variant));
    expect(seen.size).toBe(5);
  });
  it('dendrites are unit directions with a sensible length, different between variants', () => {
    const d = dendrites(2, 4);
    expect(d).toHaveLength(4);
    for (const x of d) { expect(Math.hypot(...x.dir)).toBeCloseTo(1, 6); expect(x.len).toBeGreaterThanOrEqual(0.75); expect(x.len).toBeLessThanOrEqual(1.35); }
    expect(dendrites(3, 4)[0]!.dir).not.toEqual(d[0]!.dir);
  });
  it('an axon bends slightly, always the same way for the same link', () => {
    const b = axonBend('a|b|flusso');
    expect(b).toBe(axonBend('a|b|flusso'));
    expect(Math.abs(b)).toBeGreaterThanOrEqual(0.06);
    expect(Math.abs(b)).toBeLessThanOrEqual(0.14);
    const signs = new Set(Array.from({ length: 20 }, (_, i) => Math.sign(axonBend(`k${i}`))));
    expect(signs.size).toBe(2);
  });
});
