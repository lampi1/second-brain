// The house i18n (ADR 0057): the language resolution (setting + Windows' language, SB_LANG for tests) and t() with
// and without params, in both languages.
import { afterEach, describe, expect, it } from 'vitest';
import { lang, locale, resolveLang, setLang, t } from '../../../src/renderer/i18n';
import { it as itDict } from '../../../src/renderer/i18n/it';
import { en } from '../../../src/renderer/i18n/en';
import { pickLang } from '../../../src/main/lang';

afterEach(() => setLang('it'));

describe('language', () => {
  it('Windows decides only with "system"; Italian before anything is known', () => {
    expect(resolveLang('system', 'en')).toBe('en');
    expect(resolveLang('system', 'it')).toBe('it');
    expect(resolveLang('it', 'en')).toBe('it');
    expect(resolveLang('en', 'it')).toBe('en');
    expect(resolveLang(undefined, undefined)).toBe('it');
  });
  it('Windows: Italian only when the first preferred language is Italian; SB_LANG forces it', () => {
    expect(pickLang(undefined, ['it-IT', 'en-US'])).toBe('it');
    expect(pickLang(undefined, ['en-GB', 'it-IT'])).toBe('en');
    expect(pickLang(undefined, ['de-DE'])).toBe('en');
    expect(pickLang(undefined, [])).toBe('en');
    expect(pickLang('it', ['en-US'])).toBe('it');
    expect(pickLang('xx', ['it'])).toBe('it');
  });
});

describe('t()', () => {
  it('gives the text of the current language and its locale', () => {
    expect(t('common.close')).toBe('Chiudi');
    expect(locale()).toBe('it-IT');
    setLang('en');
    expect(lang()).toBe('en');
    expect(t('common.close')).toBe('Close');
    expect(locale()).toBe('en-GB');
  });
  it('both dictionaries have the same keys and no empty text', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(itDict).sort());
    for (const d of [itDict, en] as Record<string, unknown>[]) for (const [k, v] of Object.entries(d)) if (typeof v === 'string') expect(v.trim(), k).not.toBe('');
  });
});
