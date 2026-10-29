// Unit tests of the review sampler's state line (src/shared/judging.ts, ADR 0182) and its place in the levels
// diagnostic: the day it was turned off comes from the newest change of `judging` to false; turned on again it is not off.
import { describe, expect, it } from 'vitest';
import { judgingOffSince, samplerOffLine } from '../../../src/shared/judging';
import { diagnose, formatDiagnosis } from '../../../src/main/agents/level-diagnosis';

const ch = (at: number, after: boolean, undone = false) => ({ key: 'judging' as const, at, after, ...(undone ? { undone } : {}) });

describe('judging state', () => {
  it('reads the day it was turned off from the change log', () => {
    expect(judgingOffSince([ch(1, true), ch(5, false), { key: 'theme' as never, at: 9, after: 'x' }])).toBe(5);
    expect(judgingOffSince([ch(5, false), ch(7, true)])).toBeNull();
    expect(judgingOffSince([ch(3, false), ch(7, false, true)])).toBe(3);
    expect(judgingOffSince([])).toBeNull();
  });
  it('says plainly that no verified outcome arrives, in the levels diagnostic too', () => {
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10), off = Date.UTC(2026, 9, 27);
    expect(samplerOffLine({ on: false, offSince: off }, day)).toBe('Campionatore spento dal 2026-10-27: nessun esito verificato arriva.');
    expect(samplerOffLine({ on: false, offSince: null }, day)).toBe('Campionatore spento: nessun esito verificato arriva.');
    expect(samplerOffLine({ on: true, offSince: null }, day)).toBe('');
    expect(formatDiagnosis(diagnose([], [], off, null, 0, { on: false, offSince: off }))).toContain('Campionatore spento dal 2026-10-27');
    expect(formatDiagnosis(diagnose([], [], off, null, 0, { on: true, offSince: null }))).not.toContain('Campionatore');
  });
});
