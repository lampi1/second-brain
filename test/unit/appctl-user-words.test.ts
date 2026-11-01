// The user's ask for app_config (src/main/appctl/user-words.ts, ADR 0149): their typed message or their «Sì» to a
// native question, with nothing written to the chat since, recent or still in the turn it started (the owner,
// 2026-11-01: «ti devo sempre scrivere in chat le parole esatte»); a no, free text, app news and agents' mail never.
import { describe, expect, it } from 'vitest';
import { saysYes, userAsked, type AskProof } from '../../src/main/appctl/user-words';
import type { PendingRequest } from '../../src/shared/contract';

const MIN = 60_000, now = 1_000 * MIN;
const ask = (p: Partial<AskProof>) => userAsked({ now, freshMs: 10 * MIN, turnMs: 120 * MIN, ...p });
const q = (labels: string[]): Pick<PendingRequest, 'type' | 'questions'> => ({ type: 'question', questions: [{ question: 'Imposto Cursor sullo Strategist?', multiSelect: false, options: labels.map(label => ({ label })) }] });

describe('saysYes: only a click on an option that is not a no', () => {
  it('a «Sì» option, with or without (consigliato), is a yes', () => {
    expect(saysYes(q(['Sì (consigliato)', 'No']), { kind: 'question', answers: { a: 'Sì (consigliato)' } })).toBe(true);
    expect(saysYes(q(['Sì', 'No']), { kind: 'question', answers: { a: 'Sì' } })).toBe(true);
  });
  it('a no, free text, a permission or a question without options are not', () => {
    expect(saysYes(q(['Sì', 'No (consigliato)']), { kind: 'question', answers: { a: 'No (consigliato)' } })).toBe(false);
    expect(saysYes(q(['Sì', 'No']), { kind: 'question', answers: { a: 'sì ma cambia anche il Scout' } })).toBe(false);
    expect(saysYes(q(['Sì', 'No']), { kind: 'question', answers: {} })).toBe(false);
    expect(saysYes({ type: 'permission' }, { kind: 'permission', allow: true })).toBe(false);
    expect(saysYes(undefined, { kind: 'question', answers: { a: 'Sì' } })).toBe(false);
  });
});

describe('userAsked: the user\'s own words or «Sì», the latest thing said to the chat', () => {
  it('a typed message is the ask while it is the latest \'user\' item, for 10 minutes', () => {
    expect(ask({ typed: now - 2 * MIN, lastUserItem: now - 2 * MIN, lastResult: now - MIN })).toBe(true);
    expect(ask({ typed: now - 11 * MIN, lastUserItem: now - 11 * MIN, lastResult: now - MIN })).toBe(false);
  });
  it('the same turn keeps the ask past 10 minutes (the work the user asked for), up to its cap', () => {
    expect(ask({ typed: now - 30 * MIN, lastUserItem: now - 30 * MIN, lastResult: now - 31 * MIN })).toBe(true);
    expect(ask({ typed: now - 30 * MIN, lastUserItem: now - 30 * MIN })).toBe(true);
    expect(ask({ typed: now - 121 * MIN, lastUserItem: now - 121 * MIN, lastResult: now - 122 * MIN })).toBe(false);
  });
  it('the user\'s «Sì» is the ask, also after an agent\'s mail that woke the turn', () => {
    expect(ask({ answered: now - MIN, lastUserItem: now - 5 * MIN })).toBe(true);
    expect(ask({ typed: now - 40 * MIN, answered: now - MIN, lastUserItem: now - 5 * MIN, lastResult: now - 20 * MIN })).toBe(true);
  });
  it('an agent\'s message, app news or quoted text written after the ask is never the user\'s', () => {
    // a 'user' item after the typed message (an agent quoting the user, an app event): the turn is not theirs
    expect(ask({ typed: now - 2 * MIN, lastUserItem: now - MIN })).toBe(false);
    expect(ask({ answered: now - 2 * MIN, lastUserItem: now - MIN })).toBe(false);
    // only app items, no typed message nor «Sì»
    expect(ask({ lastUserItem: now - MIN })).toBe(false);
  });
});
