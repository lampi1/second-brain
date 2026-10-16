// Keeps the UI in the chosen language (ADR 0057): reads the setting `language` and Windows' language (app:info) from
// the store, sets the current one for t() and re-mounts its children when it changes, so every text is drawn again.
// startLang() picks it before the first render (no Italian flash on an English system). Used by main.tsx.
import { Fragment, type ReactNode } from 'react';
import { sb } from '../sb';
import { useApp } from '../store/store';
import { lang, resolveLang, setLang } from './index';

export function LangRoot({ children }: { children: ReactNode }) {
  const want = useApp(s => (s.settings && s.info ? resolveLang(s.settings.language, s.info.systemLang) : lang()));
  if (want !== lang()) setLang(want);
  return <Fragment key={want}>{children}</Fragment>;
}

/** before the first render: the saved choice and Windows' language; at most 1.5 s, then Italian and LangRoot fixes it */
export function startLang(): Promise<void> {
  const got = Promise.all([sb.invoke('settings:get', undefined), sb.invoke('app:info', undefined)])
    .then(([s, i]) => { setLang(resolveLang(s.language, i.systemLang)); });
  return Promise.race([got, new Promise<void>(r => { setTimeout(r, 1500); })]).catch(() => {});
}
