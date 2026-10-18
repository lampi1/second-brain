// The Grindhouse's headline under the greeting (SPEC 18, main/headline.ts): the line main has now ('headline:get'), then
// each new one ('headline:changed'). The Home never waits for it: until the first answer the line keeps its place empty
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
  return <p className="home-headline" data-testid="home-headline" data-source={state?.source ?? 'loading'} title={by} aria-live="polite">{state?.text ?? ''}</p>;
}
