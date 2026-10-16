// Windows' language as the UI uses it (ADR 0057): 'it' when the user's first preferred language is Italian, 'en' for
// anything else (the app ships only these two). SB_LANG=it|en forces it: the e2e suite runs in Italian (its older specs
// read the Italian texts), a run in English is SB_LANG=en. Used by index.ts for app:info's systemLang.
import { app } from 'electron';
import type { Lang } from '../shared/contract';

/** pure: the forced value wins, then the first preferred locale ("it-IT", "it") */
export function pickLang(forced: string | undefined, locales: readonly string[]): Lang {
  if (forced === 'it' || forced === 'en') return forced;
  return (locales[0] ?? '').toLowerCase().startsWith('it') ? 'it' : 'en';
}

export function systemLang(env: NodeJS.ProcessEnv = process.env): Lang {
  const locales = app.getPreferredSystemLanguages?.() ?? [];
  return pickLang(env.SB_LANG, locales.length ? locales : [app.getLocale()]);
}
