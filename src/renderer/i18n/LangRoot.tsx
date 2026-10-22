// Keeps the UI in the chosen language (ADR 0057): reads the setting `language` and Windows' language (app:info) from
// the store, sets the current one for t() and re-mounts its children when it changes, so every text is drawn again.
// startLang() picks it, and loads its dictionary, before the first render (no Italian flash on an English system).
// Used by main.tsx.
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { sb } from '../sb';
import { useApp } from '../store/store';
import { lang, langLoaded, loadLang, resolveLang, setLang } from './index';

export function LangRoot({ children }: { children: ReactNode }) {
  const want = useApp(s => (s.settings && s.info ? resolveLang(s.settings.language, s.info.systemLang) : lang()));
  // a language whose dictionary is still loading keeps the one on screen until it is here (one re-mount, no mixed texts)
  const [, loaded] = useState(0);
  useEffect(() => { if (!langLoaded(want)) void loadLang(want).then(() => loaded(n => n + 1), () => {}); }, [want]);
  if (want !== lang() && langLoaded(want)) setLang(want);
  return <Fragment key={lang()}>{children}</Fragment>;
}

/** before the first render: the saved choice and Windows' language; at most 1.5 s, then Italian and LangRoot fixes it */
export function startLang(): Promise<void> {
  const got = Promise.all([sb.invoke('settings:get', undefined), sb.invoke('app:info', undefined)])
    .then(async ([s, i]) => { const l = resolveLang(s.language, i.systemLang); await loadLang(l); setLang(l); });
  return Promise.race([got, new Promise<void>(r => { setTimeout(r, 1500); })]).catch(() => {});
}
