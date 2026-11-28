// A copied password leaves the clipboard after 30 s (ADR 0012) and, since ADR 0367, what was there before comes back,
// only if the clipboard still holds the password; agents may not paste meanwhile. Fake timers, in-memory clipboard.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { passwordClip } from '../../src/main/browser/password-clip';

const MS = 30_000;
function setup(initial = '') {
  let text = initial;
  const clip = { writeText: (t: string) => { text = t; }, readText: () => text, clear: () => { text = ''; } };
  const guard = { marked: 0, clearedN: 0, markCopied(ms: number) { this.marked = ms; }, cleared() { this.clearedN++; } };
  return { pc: passwordClip(clip, guard, MS), clip, guard, read: () => text, set: (t: string) => { text = t; } };
}

describe('passwordClip', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('puts the password on the clipboard only when copied, and gives back the earlier text after 30 s', async () => {
    const s = setup('what I had');
    expect(s.read()).toBe('what I had');
    s.pc.copy('pw-1');
    expect(s.read()).toBe('pw-1');
    expect(s.guard.marked).toBe(MS);
    await vi.advanceTimersByTimeAsync(MS - 1);
    expect(s.read()).toBe('pw-1');
    await vi.advanceTimersByTimeAsync(1);
    expect(s.read()).toBe('what I had');
    expect(s.guard.clearedN).toBe(1);
  });

  it('clears when there was nothing before, and leaves alone what the user copied meanwhile', async () => {
    const a = setup('');
    a.pc.copy('pw-1');
    await vi.advanceTimersByTimeAsync(MS);
    expect(a.read()).toBe('');
    const b = setup('before');
    b.pc.copy('pw-1');
    b.set('something new');
    await vi.advanceTimersByTimeAsync(MS);
    expect(b.read()).toBe('something new');
  });

  it('a second copy keeps the first earlier text and restarts the 30 s; restore() runs at once (the app closing)', async () => {
    const s = setup('mine');
    s.pc.copy('pw-1');
    await vi.advanceTimersByTimeAsync(20_000);
    s.pc.copy('pw-2');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(s.read()).toBe('pw-2');
    await s.pc.restore();
    expect(s.read()).toBe('mine');
    await vi.advanceTimersByTimeAsync(MS);
    expect(s.read()).toBe('mine');
  });

  it('a text copied between two password copies is the one that comes back (X, password, Y, password → Y)', async () => {
    const s = setup('X');
    s.pc.copy('pw-1');
    await vi.advanceTimersByTimeAsync(5_000);
    s.set('Y');
    s.pc.copy('pw-1');
    await vi.advanceTimersByTimeAsync(MS);
    expect(s.read()).toBe('Y');
  });
});
