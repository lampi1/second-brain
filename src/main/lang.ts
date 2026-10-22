// Windows' language as the UI uses it (ADR 0057, 0117): 'it' when the user's first preferred language is Italian, 'de'
// when it is German (de-AT, de-DE, de-CH...), 'en' for anything else. SB_LANG=it|en|de forces it: the e2e suite runs in Italian (its older specs
// read the Italian texts), a run in English is SB_LANG=en. Used by index.ts for app:info's systemLang.
import { app } from 'electron';
import { isLang, type Lang } from '../shared/contract';

/** pure: the forced value wins, then the first preferred locale ("it-IT", "it") */
export function pickLang(forced: string | undefined, locales: readonly string[]): Lang {
  if (isLang(forced)) return forced;
  const first = (locales[0] ?? '').toLowerCase();
  return first.startsWith('it') ? 'it' : first.startsWith('de') ? 'de' : 'en';
}

export function systemLang(env: NodeJS.ProcessEnv = process.env): Lang {
  const locales = app.getPreferredSystemLanguages?.() ?? [];
  return pickLang(env.SB_LANG, locales.length ? locales : [app.getLocale()]);
}
