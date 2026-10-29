// The headline (SPEC 18, main/headline.ts), at the top of Memoria (on the Dashboard from 18/10, Brother: «la frase io me la
// aspetto nella dashboard»; Memoria since ADR 0122; the Grindhouse shows only the strips): the line main has now ('headline:get'), then each
// new one ('headline:changed'). Costi no longer shows the line's own monthly spend ("Battuta del Grindhouse", ADR 0101:
// noise on a cost page; its requests stay in the API engine's spend). The page never waits for it: until the first answer the line keeps its place empty
// (no jump when it arrives); main itself never waits for a model either (a previous or built-in line).
import { useEffect, useState } from 'react';
import type { HeadlineState } from '@shared/contract';
import { t } from '../../i18n';

export function useHeadline(): HeadlineState | null {
  const [state, setState] = useState<HeadlineState | null>(null);
  useEffect(() => {
    let alive = true;
    let off = () => {};
    try {
      window.sb.invoke('headline:get', undefined).then(s => { if (alive) setState(s); }, () => {});
      off = window.sb.on('headline:changed', s => { if (alive) setState(s); });
    } catch { /* no bridge (tests) */ }
    return () => { alive = false; off(); };
  }, []);
  return state;
}

export function HeadlineLine({ state }: { state: HeadlineState | null }) {
  const by = state?.source === 'builtin' ? t('home.headlineBuiltin') : state ? t('home.headlineBy', { model: state.model }) : undefined;
  return <p className="dash-headline" data-testid="dash-headline" data-source={state?.source ?? 'loading'} title={by} aria-live="polite">{state?.text ?? ''}</p>;
}
