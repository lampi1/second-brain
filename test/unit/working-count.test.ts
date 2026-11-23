// Pins workingCount (src/renderer/lib/working-count.ts): the number beside the Grindhouse entry counts only the open
// chats that are starting or running a turn.
import { describe, expect, it } from 'vitest';
import { workingCount } from '../../src/renderer/lib/working-count';

describe('workingCount', () => {
  it('counts running and starting chats only', () => {
    expect(workingCount({
      a: { state: 'running' },
      b: { state: 'starting' },
      c: { state: 'idle' },
      d: { state: 'waiting' },
      e: { state: 'error' },
      f: { state: 'closed' },
    })).toBe(2);
  });

  it('leaves out closed chats and turns that are only closing', () => {
    expect(workingCount({
      a: { state: 'running', closedAt: 1 },
      b: { state: 'running', turnClosing: true },
      c: { state: 'running' },
      d: undefined,
    })).toBe(1);
  });

  it('is 0 with no chats (the badge is hidden)', () => {
    expect(workingCount({})).toBe(0);
  });
});
