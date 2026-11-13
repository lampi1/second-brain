// The agent window's saved choices (ADR 0287): which of the three views a chat shows and where the line between chat
// and browser sits. Pins the one-time read of the old «browser open» switch and the limits of the split.
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/sb', () => ({ sb: {} }));
import { clampSplit, loadPrefs } from '../../src/renderer/store/ui';

describe('agent window prefs', () => {
  it('an old open browser becomes «Affiancati»; a saved view wins over it; the old keys are dropped', () => {
    const p = loadPrefs(JSON.stringify({ browserOpen: { a: true, b: false, c: true }, agentView: { c: 'browser' }, pairSplit: 0.6 }));
    expect(p.agentView).toEqual({ a: 'split', c: 'browser' });
    expect('browserOpen' in p).toBe(false);
    expect('pairSplit' in p).toBe(false);
  });
  it('nothing saved: no view and no split, the window picks its defaults', () => {
    const p = loadPrefs(null);
    expect(p.agentView).toEqual({});
    expect(p.agentSplit).toEqual({});
  });
  it('the line between chat and browser stays between a quarter and three quarters', () => {
    expect(clampSplit(0.1)).toBe(0.25);
    expect(clampSplit(0.5)).toBe(0.5);
    expect(clampSplit(0.9)).toBe(0.75);
  });
});
