// Unit tests of renderer/lib/memo.ts: the single-entry caches shared by the store's selectors (one computation per state
// object for every component) and the record equality that replaces JSON.stringify in hot selectors.
import { describe, expect, it, vi } from 'vitest';
import { memoLast, memoPerKey, sameRecord } from '../../src/renderer/lib/memo';

describe('memoLast', () => {
  it('computes once per argument identity and again when any argument changes', () => {
    const fn = vi.fn((a: object, b: number) => ({ a, b }));
    const m = memoLast(fn);
    const x = {}, y = {};
    const first = m(x, 1);
    expect(m(x, 1)).toBe(first);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(m(y, 1)).not.toBe(first);
    expect(m(y, 2)).toEqual({ a: y, b: 2 });
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('memoPerKey', () => {
  it('keeps one value per key for the last object, and starts over for a new object', () => {
    const fn = vi.fn((o: { n: number }, key: string) => `${key}${o.n}`);
    const m = memoPerKey(fn);
    const o1 = { n: 1 }, o2 = { n: 2 };
    expect(m(o1, 'a')).toBe('a1');
    expect(m(o1, 'b')).toBe('b1');
    expect(m(o1, 'a')).toBe('a1');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(m(o2, 'a')).toBe('a2');
    expect(fn).toHaveBeenCalledTimes(3);
  });
  it('remembers a null result too', () => {
    const fn = vi.fn(() => null);
    const m = memoPerKey(fn);
    const o = {};
    m(o, 'x'); m(o, 'x');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('sameRecord', () => {
  it('compares keys and values by identity', () => {
    expect(sameRecord({ a: '1', b: '2' }, { b: '2', a: '1' })).toBe(true);
    expect(sameRecord({ a: '1' }, { a: '2' })).toBe(false);
    expect(sameRecord({ a: '1' }, { a: '1', b: '2' })).toBe(false);
    expect(sameRecord({ a: undefined }, { b: undefined })).toBe(false);
  });
});
