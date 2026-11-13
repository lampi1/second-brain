// The bilingual work lexicon (src/shared/work-concepts.ts): whole words vs "stem*" beginnings, accents, and the routing
// kind it gives when the brain has no rule (ties, no work word).
import { describe, expect, it } from 'vitest';
import { builtinTask, conceptOf, conceptsOf, fromLedgerKind } from '../../../src/shared/work-concepts';

describe('work concepts', () => {
  it('matches Italian and English forms of the same job, accents and case aside', () => {
    expect(['correggilo', 'Sistemala', 'fix', 'BUG', 'crashes'].map(conceptOf)).toEqual(['fix', 'fix', 'fix', 'fix', 'fix']);
    expect(conceptOf('Indaga')).toBe('cause');
    expect(conceptOf('revisiona')).toBe('review');
  });
  it('keeps whole-word entries whole and stopwords out: no "prod" in produttività, no "sistema" as a noun, no "quando"', () => {
    expect(conceptOf('sistema')).toBeNull(); expect(conceptOf('sistemalo')).toBe('fix');
    expect(conceptOf('quando')).toBeNull(); expect(conceptOf('perché')).toBeNull(); expect(conceptOf('fixture')).toBeNull();
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

describe('fromLedgerKind (ADR 0186)', () => {
  it('maps the old ledger kinds, keeps a work kind, and never returns an object key', () => {
    expect(fromLedgerKind('fix')).toBe('bug-fix');
    expect(fromLedgerKind('qa')).toBe('qa-run');
    expect(fromLedgerKind('question')).toBe('altro');
    expect(fromLedgerKind('writing')).toBe('writing');
    expect(fromLedgerKind('constructor')).toBe('altro');
    expect(fromLedgerKind('toString')).toBe('altro');
    expect(fromLedgerKind(undefined)).toBe('altro');
  });
});
