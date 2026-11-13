// Unit tests of renderer/lib/splash.ts: when the opening splash shows and which sentence it carries.
import { describe, expect, it } from 'vitest';
import { SPLASH_LINES, dayLine, splashMode } from '../../src/renderer/lib/splash';
import { it as italian } from '../../src/renderer/i18n/it';

const store = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };

describe('splashMode', () => {
  it('shows only when main asks it, once per window', () => {
    const s = store();
    expect(splashMode('', s)).toBeNull();
    expect(splashMode('?splash=0', s)).toBeNull();
    expect(splashMode('?splash=1', s)).toBe('on');
    expect(splashMode('?splash=1', s)).toBeNull(); // a reload after a crash does not replay it
    expect(splashMode('?splash=hold', store())).toBe('hold');
  });
  it('shows anyway when storage is unavailable', () => {
    expect(splashMode('?splash=1', { getItem: () => { throw new Error('off'); }, setItem: () => {} })).toBe('on');
    expect(splashMode('?splash=1', null)).toBe('on');
  });
});

describe('the sentence', () => {
  it('the own line changes each local day and exists in the dictionary', () => {
    const day = 86_400_000, base = Date.UTC(2026, 9, 22, 12);
    expect(dayLine(base, 0)).not.toBe(dayLine(base + day, 0));
    expect(dayLine(base, 0)).toBe(dayLine(base + 3 * 3_600_000, 0));
    expect(dayLine(Date.UTC(2026, 9, 22, 23, 30), -120)).toBe(dayLine(Date.UTC(2026, 9, 23, 8), -120)); // Rome, after midnight
    for (let i = 0; i < SPLASH_LINES; i++) expect(italian).toHaveProperty(`splash.line.${i}`);
    expect(italian).not.toHaveProperty(`splash.line.${SPLASH_LINES}`);
  });
});
