// «Te la chiedo perché: …» (lib/proposal-ask.ts whyText, ADR 0193): every reason the policy gives is one plain line in
// Italian, English and German, with the numbers in it; no reason, no line.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProposalWhy } from '../../src/shared/proposals';
import type { whyText as WhyText } from '../../src/renderer/lib/proposal-ask';

let whyText: typeof WhyText;
let setLang: (l: 'it' | 'en' | 'de') => void;
beforeAll(async () => {
  const i18n = await import('../../src/renderer/i18n');
  setLang = i18n.setLang as typeof setLang;
  setLang('it');
  ({ whyText } = await import('../../src/renderer/lib/proposal-ask'));
});
afterAll(() => setLang('it'));

const ALL: ProposalWhy[] = [
  ...(['external', 'setting', 'permissions', 'role', 'forget', 'production'] as const).map(what => ({ code: 'never' as const, what })),
  { code: 'irreversible' }, { code: 'first' }, { code: 'few', n: 3 }, { code: 'rejected', no: 2, n: 6 }, { code: 'undone', n: 1 }, { code: 'building', yes: 30, n: 30 }, { code: 'blocked' },
];

describe('whyText', () => {
  it('words each reason in Italian, with its numbers', () => {
    expect(whyText({ code: 'rejected', no: 2, n: 6 })).toBe('in questo gruppo hai detto no 2 volte su 6');
    expect(whyText({ code: 'rejected', no: 1, n: 6 })).toBe('in questo gruppo hai detto no 1 volta su 6');
    expect(whyText({ code: 'first' })).toBe('prima volta per questo tipo');
    expect(whyText({ code: 'irreversible' })).toBe('non si può annullare da qui');
    expect(whyText({ code: 'never', what: 'permissions' })).toBe('tocca permessi, strumenti o hook');
    expect(whyText({ code: 'never', what: 'external' })).toContain('GitHub');
    expect(whyText({ code: 'building', yes: 30, n: 30 })).toContain('30 volte su 30');
    expect(whyText(undefined)).toBe('');
  });
  it('has a line for every reason in every language', () => {
    for (const lang of ['it', 'en', 'de'] as const) {
      setLang(lang);
      for (const w of ALL) expect(whyText(w), `${lang} ${JSON.stringify(w)}`).toMatch(/\S{3}/);
    }
    setLang('en');
    expect(whyText({ code: 'rejected', no: 2, n: 6 })).toBe('in this group you said no 2 times out of 6');
  });
});
