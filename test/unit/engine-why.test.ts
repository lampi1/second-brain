// The line that says which engine a chat started on and why (renderer/lib/engine-why.ts, ADR 0357).
import { describe, expect, it } from 'vitest';
import { engineWhy } from '../../src/renderer/lib/engine-why';

describe('engineWhy', () => {
  it('a role chat says its route; another chat how it was chosen; else nothing', () => {
    expect(engineWhy({ run: { presetChoice: { preset: 'base', route: 'OpenAI Sol: primo disponibile' } } as never, route: { reason: 'x' } as never })).toBe('OpenAI Sol: primo disponibile');
    expect(engineWhy({ route: { reason: 'scelta dell’utente' } as never })).toBe('scelta dell’utente');
    expect(engineWhy({})).toBeNull();
  });
});
