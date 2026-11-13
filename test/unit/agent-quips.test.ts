// The agents' nonsense lines (src/shared/agent-quips.ts, ADR 0300): every role speaks in every language at every
// moment, each line fits a small bubble, and a pick never repeats the line said last.
import { describe, expect, it } from 'vitest';
import { QUIP_CHARACTER, QUIP_KINDS, QUIP_MAX, QUIP_ROLES, isQuipRole, pickQuip, quips } from '../../src/shared/agent-quips';

const LANGS = ['it', 'en', 'de'] as const;

describe('agent quips', () => {
  it('gives every role lines of its own for every moment, in the three languages', () => {
    for (const lang of LANGS) for (const role of QUIP_ROLES) {
      for (const kind of QUIP_KINDS) {
        const all = quips(role, kind, lang);
        expect(all.length, `${lang} ${role} ${kind}`).toBeGreaterThanOrEqual(3);
        expect(new Set(all).size, `${lang} ${role} ${kind}: a line twice`).toBe(all.length);
      }
      expect(quips(role, 'work', lang).length).toBeGreaterThanOrEqual(12);
    }
    // a character each: no role says in its work what another one says
    for (const lang of LANGS) {
      const said = QUIP_ROLES.flatMap(role => quips(role, 'work', lang));
      expect(new Set(said).size).toBe(said.length);
    }
    for (const role of QUIP_ROLES) expect(QUIP_CHARACTER[role].length).toBeGreaterThan(20);
    expect(isQuipRole('scout')).toBe(true);
    expect(isQuipRole('flash')).toBe(false);
  });

  it('keeps every line short: a few words that fit the bubble', () => {
    for (const lang of LANGS) for (const role of QUIP_ROLES) for (const kind of QUIP_KINDS) for (const q of quips(role, kind, lang)) {
      expect(q.length, q).toBeLessThanOrEqual(QUIP_MAX);
      expect(q.split(/\s+/).length, q).toBeLessThanOrEqual(4);
      expect(q.trim(), q).toBe(q);
    }
  });

  it('picks by the given chance and never the line said last', () => {
    const all = quips('artisan', 'work', 'it');
    expect(pickQuip('artisan', 'work', 'it', () => 0)).toBe(all[0]);
    expect(pickQuip('artisan', 'work', 'it', () => 0.999999)).toBe(all[all.length - 1]);
    expect(pickQuip('artisan', 'work', 'it', () => 0, all[0])).toBe(all[1]);
    for (const q of all) for (const r of [0, 0.3, 0.6, 0.999]) expect(pickQuip('artisan', 'work', 'it', () => r, q)).not.toBe(q);
    // a chance of exactly 1 (out of range) still lands on a line
    expect(all).toContain(pickQuip('artisan', 'work', 'it', () => 1));
  });
});
