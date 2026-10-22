// The UI's translations, written in house (ADR 0057: no i18n package). t('area.key', params?) gives the text in the
// current language; the dictionaries are it.ts (the source), en.ts and de.ts (German as in Austria, ADR 0117; same
// keys, checked by the typecheck). The language is the setting `language` (system | it | en | de) resolved with Windows' language from app:info (systemLang).
// main.tsx sets it before the first render; App.tsx re-mounts the tree when it changes (rare: one click in Settings),
// so plain t() calls anywhere (components, actions, toasts) always read the current one. Dates and numbers: locale().
import type { ChatItem, Lang, LanguageMode } from '@shared/contract';
import { it } from './it';

export type Dict = typeof it;
export type Key = keyof Dict;
export type TextKey = {[K in Key]:Dict[K] extends string?K:never}[Key];
type Args<K extends Key> = Dict[K] extends (p: infer P) => string ? [P] : [];

// Italian is in the first chunk (the source, and the fallback of a key whose dictionary is still loading); English and
// German are their own chunks, loaded once when chosen (loadLang): a user never parses the two they do not read.
const dicts: Partial<Record<Lang, Dict>> = { it };
const loading: Partial<Record<Lang, Promise<void>>> = {};
let cur: Lang = 'it';

/** whether a language's texts are here (Italian always is) */
export const langLoaded = (l: Lang): boolean => !!dicts[l];
/** Loads a language's dictionary once; the caller re-renders when it resolves (LangRoot, OverlayApp). */
export function loadLang(l: Lang): Promise<void> {
  if (dicts[l]) return Promise.resolve();
  return loading[l] ??= (l === 'en' ? import('./en').then(m => { dicts.en = m.en; }) : import('./de').then(m => { dicts.de = m.de; }))
    .catch(e => { delete loading[l]; throw e; });
}
/** A dictionary given directly (tests, which switch language synchronously). */
export function registerLang(l: Lang, dict: Dict): void { dicts[l] = dict; }
const dict = (): Dict => dicts[cur] ?? it;

export const resolveLang = (mode: LanguageMode | undefined, system: Lang | undefined): Lang =>
  mode === 'it' || mode === 'en' || mode === 'de' ? mode : (system ?? 'it');

export function setLang(l: Lang): void {
  cur = l;
  if (typeof document !== 'undefined') document.documentElement.lang = l;
}
export const lang = (): Lang => cur;
/** the locale for dates and numbers (toLocaleString, Intl): 24-hour clock in both */
export const locale = (): string => localeOf(cur);
/** the locale of a language: German is Austria's (ADR 0117) */
export const localeOf = (l: Lang): string => (l === 'en' ? 'en-GB' : l === 'de' ? 'de-AT' : 'it-IT');

export function t<K extends Key>(key: K, ...a: Args<K>): string {
  const m = dict()[key] as string | ((p: unknown) => string);
  return typeof m === 'function' ? m(a[0]) : m;
}

/** A system ChatItem's text in the current language: item.code (sys.ts, through t()) when set, else item.text (an
 *  older item, or one the UI does not have a code for yet: already English, from main). */
export function sysText(item: Extract<ChatItem, { kind: 'system' }>): string {
  if (!item.code) return item.text;
  const key = `sys.${item.code}` as Key;
  const m = dict()[key] as string | ((p: unknown) => string);
  return typeof m === 'function' ? m(item.params ?? {}) : m;
}
