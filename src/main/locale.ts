// The UI language's locale for the texts main writes for the user (budget and usage lines, the Cursor ledger, the app
// digest): the setting `language`, or Windows' language when it is «Come il sistema» (ADR 0117). index.ts registers
// the source once the settings are read; before that (and in unit tests) it is Italian, the app's first language.
// No electron import here, so the pure modules that format dates stay testable.
import type { Lang } from '../shared/contract';

export const LOCALE: Readonly<Record<Lang, string>> = { it: 'it-IT', en: 'en-GB', de: 'de-AT' };
let source: () => Lang = () => 'it';

export const setUiLangSource = (f: () => Lang): void => { source = f; };
export const uiLang = (): Lang => { try { return source(); } catch { return 'it'; } };
export const uiLocale = (): string => LOCALE[uiLang()];
