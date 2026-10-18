// The bilingual work lexicon (src/shared/work-concepts.ts): whole words vs "stem*" beginnings, accents, and the routing
// kind it gives when the brain has no rule (ties, no work word).
import { describe, expect, it } from 'vitest';
import { builtinTask, conceptOf, conceptsOf } from '../../../src/shared/work-concepts';

describe('work concepts', () => {
  it('matches Italian and English forms of the same job, accents and case aside', () => {
    expect(['correggilo', 'Sistema', 'fix', 'BUG', 'crashes'].map(conceptOf)).toEqual(['fix', 'fix', 'fix', 'fix', 'fix']);
    expect(conceptOf('Perché')).toBe('cause');
    expect(conceptOf('revisiona')).toBe('review');
  });
  it('keeps whole-word entries whole: no "prod" in produttività, no "post" in postgres, no "add" in addetto', () => {
    expect(conceptOf('produttività')).toBeNull();
    expect(conceptOf('postgres')).toBeNull();
    expect(conceptOf('addetto')).toBeNull();
    expect(conceptOf('prod')).toBe('ops');
  });
  it('counts every word with a concept', () => {
    expect(conceptsOf('Leggi i log di produzione e trova la causa')).toEqual(['ops', 'ops', 'cause']);
  });
  it('gives the routing kind by majority, ties in a fixed order, null without a work word', () => {
    expect(builtinTask('Leggi i log di produzione e dimmi perché le code sono piene')).toBe('ops-read');
    expect(builtinTask('Smista la posta e prepara le bozze')).toBe('triage');
    expect(builtinTask('Fai la review del fix')).toBe('review');
    expect(builtinTask('Prenota un tavolo per stasera')).toBeNull();
  });
});
