// A state shown without flicker (lib/steady.ts, ADR 0312): a stop shorter than HOLD_MS while a chat works never reaches
// the screen; a longer one shows once the hold is over; an error and a new start show at once.
import { describe, expect, it } from 'vitest';
import { HOLD_MS, steadyValue } from '../../src/renderer/lib/steady';

describe('steadyValue', () => {
  it('shows the current value when nothing is held', () => {
    expect(steadyValue('wait', undefined, null, 1000)).toBe('wait');
    expect(steadyValue('run', 'run', null, 1000)).toBe('run');
  });
  it('keeps the last working value during a stop younger than the hold', () => {
    expect(steadyValue('wait', 'run', 1000, 1000 + HOLD_MS - 1)).toBe('run');
    expect(steadyValue('wait', 'run', 1000, 1000)).toBe('run');
  });
  it('shows the stop once it lasted the whole hold', () => {
    expect(steadyValue('wait', 'run', 1000, 1000 + HOLD_MS)).toBe('wait');
  });
  it('takes a hold of its own length', () => {
    expect(steadyValue('wait', 'run', 0, 150, 200)).toBe('run');
    expect(steadyValue('wait', 'run', 0, 250, 200)).toBe('wait');
  });
});
