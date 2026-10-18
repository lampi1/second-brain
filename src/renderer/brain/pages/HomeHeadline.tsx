// The headline (SPEC 18, main/headline.ts), on the Dashboard under its title since 18/10 (Brother: «la frase io me la
// aspetto nella dashboard»; the Grindhouse shows only the strips): the line main has now ('headline:get'), then each
// new one ('headline:changed'). The page never waits for it: until the first answer the line keeps its place empty
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

/** Costi's line: what the headline spent this month on the API credits (its requests are in the API engine's spend too). */
export function HeadlineCost() {
  const s = useHeadline();
  if (!s) return null;
  return <p className="small muted" data-testid="bx-cost-headline">{t('costs.headline', { usd: s.monthUsd.toFixed(2), calls: s.monthCalls, model: s.model })}</p>;
}

export function HeadlineLine({ state }: { state: HeadlineState | null }) {
  const by = state?.source === 'builtin' ? t('home.headlineBuiltin') : state ? t('home.headlineBy', { model: state.model }) : undefined;
  return <p className="dash-headline" data-testid="dash-headline" data-source={state?.source ?? 'loading'} title={by} aria-live="polite">{state?.text ?? ''}</p>;
}
