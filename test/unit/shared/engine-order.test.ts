// The one order of the engines, pure part (src/shared/engine-order.ts, ADR 0359): the saved shape, the order applied to a
// list, a role's exception, the user's threshold, and when a card's words name an order (whole words, one sentence, no
// other engine, no «non»).
import { describe, expect, it } from 'vitest';
import type { CreditReading } from '../../../src/shared/credit-rule';
import { checkedOrder, inOrder, namesInOrder, pastThreshold, roleOrder, wordsOf } from '../../../src/shared/engine-order';

describe('the order', () => {
  it('is a list of engines, none twice', () => {
    expect(checkedOrder(['codex', 'claude'])).toEqual(['codex', 'claude']);
    expect(() => checkedOrder(['codex', 'codex'])).toThrow(/due volte/);
    expect(() => checkedOrder(['Codex!'])).toThrow(/lista di motori/);
    expect(() => checkedOrder('codex')).toThrow(/lista di motori/);
  });
  it('puts a list in order, stable; what it does not name comes after', () => {
    const list = [{ engine: 'claude', n: 1 }, { engine: 'codex', n: 2 }, { engine: 'cursor', n: 3 }, { engine: 'codex', n: 4 }] as const;
    expect(inOrder(list, ['codex']).map(x => x.n)).toEqual([2, 4, 1, 3]);
    expect(inOrder(list, []).map(x => x.n)).toEqual([1, 2, 3, 4]);
  });
  it('a role\'s own order replaces everybody\'s', () => {
    expect(roleOrder(['claude'], ['codex'])).toEqual(['claude']);
    expect(roleOrder([], ['codex'])).toEqual(['codex']);
    expect(roleOrder(undefined, ['codex'])).toEqual(['codex']);
  });
});

describe('the threshold', () => {
  const now = 1_000_000, reading = (w: Partial<CreditReading['windows'][number]>, ok = true): CreditReading => ({ at: now, ok, pool: 'codex', account: null, windows: [{ kind: 'weekly', label: '7g', usedPercent: 85, resetsAt: now + 1, ...w }] });
  it('names the first window past it', () => expect(pastThreshold(reading({}), null, 80, now)).toBe('7g al 85%, soglia 80%'));
  it('is nothing below it, without one, without a good reading, or once the window renewed', () => {
    expect(pastThreshold(reading({ usedPercent: 79 }), null, 80, now)).toBeNull();
    expect(pastThreshold(reading({}), null, null, now)).toBeNull();
    expect(pastThreshold(reading({}, false), null, 80, now)).toBeNull();
    expect(pastThreshold(null, null, 80, now)).toBeNull();
    expect(pastThreshold(reading({ resetsAt: now }), null, 80, now)).toBeNull();
  });
  it('a window of one model counts for that model only; money never does', () => {
    expect(pastThreshold(reading({ model: 'opus' }), 'claude-sonnet', 80, now)).toBeNull();
    expect(pastThreshold(reading({ model: 'opus' }), 'claude-opus', 80, now)).not.toBeNull();
    expect(pastThreshold(reading({ kind: 'spend' }), null, 80, now)).toBeNull();
  });
});

describe('a card that names an order', () => {
  const engines = [['OpenAI', 'opencode'], ['Antigravity'], ['Claude']], o = { others: [['Cursor', 'cursor']] };
  it('all of them, in order, in one sentence', () => {
    expect(namesInOrder('Prima OpenAI, poi Antigravity, Claude per ultimo.', engines, o)).toBe(true);
    expect(namesInOrder('Prima Antigravity, poi OpenAI, Claude per ultimo.', engines, o)).toBe(false);
    expect(namesInOrder('OpenAI per primo. Poi Antigravity. Claude per ultimo.', engines, o)).toBe(false);
  });
  it('whole words only, no other engine, no negation', () => {
    expect(namesInOrder('OpenAIX, Antigravity, Claude', engines, o)).toBe(false);
    expect(namesInOrder('OpenAI, Antigravity, Cursor, Claude', engines, o)).toBe(false);
    expect(namesInOrder('Non OpenAI, Antigravity, Claude', engines, o)).toBe(false);
  });
  it('the words it needs and the ones it must not hold', () => {
    expect(namesInOrder('OpenAI, Antigravity, Claude', engines, { and: ['tutti i ruoli'] })).toBe(false);
    expect(namesInOrder('OpenAI, Antigravity, Claude per tutti i ruoli', engines, { and: ['tutti i ruoli'], never: ['Scout'] })).toBe(true);
    expect(namesInOrder('Scout: OpenAI, Antigravity, Claude, poi tutti i ruoli', engines, { and: ['tutti i ruoli'], never: ['Scout'] })).toBe(false);
  });
  it('no engines name nothing; words ignore case, accents and punctuation', () => {
    expect(namesInOrder('tutto', [])).toBe(false);
    expect(wordsOf('Più «Sì», 80%.')).toBe(' piu si 80% ');
  });
});
