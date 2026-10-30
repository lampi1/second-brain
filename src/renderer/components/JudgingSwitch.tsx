// The Agenti page's one switch for the roles' independent reviews (2026-10-22, the owner: "un toggle semplice … con una
// stima del costo al giorno"): «Abilita controllo livello e performance». On = once a night a hidden Sentinel run reviews
// a sample of the finished runs that no free signal decides (main/agents/judge-sample.ts, ADR 0203), from now on
// (judgingSince: no backlog); off = none. Beside it the daily cap on reviews (Settings.judgingCapUsd, «Tetto al giorno»)
// and what it costs a day: the sampled runs a day times what a reviewed run cost so far, at most the cap
// (agents:judgingEstimate, zero tokens), the runs a day their receipts decide with no review (ADR 0130) and when the last
// nightly batch ran. Off, it says plainly since when no verified outcome arrives (ADR 0186). useJudgingEstimate reads the estimate for the page (the cards' «aggiornato …» too). Used by
// AgentCatalogPage.tsx.
import { useEffect, useState } from 'react';
import type { JudgingEstimate } from '@shared/agents';
import { judgingOffSince } from '@shared/judging';
import { setSetting, useApp } from '../store/store';
import { formatCost } from '../lib/format';
import { sb } from '../sb';
import { locale, t } from '../i18n';
import { HelpTip } from './HelpTip';
import { now as clockNow } from '../lib/clock';

/** the caps offered beside the switch, $ a day */
export const CAP_CHOICES = [0.5, 1, 2, 5] as const;

/** The switch's estimate, read now and every minute; null while unknown. */
export function useJudgingEstimate(): JudgingEstimate | null {
  const [estimate, setEstimate] = useState<JudgingEstimate | null>(null);
  const cap = useApp(s => s.settings?.judgingCapUsd);
  useEffect(() => {
    let alive = true;
    const read = () => sb.invoke('agents:judgingEstimate', undefined).then(e => { if (alive) setEstimate(e); }, () => { if (alive) setEstimate(null); });
    read();
    const timer = setInterval(read, 60_000);
    return () => { alive = false; clearInterval(timer); };
  }, [cap]);
  return estimate;
}

/** When, in words: «stanotte alle 03:00», «oggi alle 14:10», «ieri alle 03:00», «il 28 ott alle 03:00». */
export function updatedWhen(at: number, now: number): string {
  const d = new Date(at), n = new Date(now);
  const time = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(n) - day(d)) / 86_400_000);
  if (days === 0) return t(d.getHours() < 6 ? 'catalog.when.night' : 'catalog.when.today', { time });
  if (days === 1) return t('catalog.when.yesterday', { time });
  return t('catalog.when.date', { date: d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' }), time });
}

export function JudgingSwitch({ estimate }: { estimate: JudgingEstimate | null }) {
  const on = useApp(s => s.settings?.judging === true);
  const cap = useApp(s => s.settings?.judgingCapUsd ?? 1);
  const loaded = useApp(s => !!s.settings);
  const [busy, setBusy] = useState(false);
  // off: since when, from the settings' change log (ADR 0186); null = not in the log
  const [offSince, setOffSince] = useState<number | null>(null);
  useEffect(() => {
    if (on || !loaded) return;
    let alive = true;
    sb.invoke('settings:history', { limit: 500 }).then(h => { if (alive) setOffSince(judgingOffSince(h)); }, () => { if (alive) setOffSince(null); });
    return () => { alive = false; };
  }, [on, loaded]);
  if (!loaded) return null;
  const flip = () => {
    setBusy(true);
    void setSetting(on ? { judging: false } : { judging: true, judgingSince: Date.now() }).finally(() => setBusy(false));
  };
  const n = (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: 1 });
  const cost = !estimate || estimate.runsPerDay <= 0 ? t('catalog.judging.costNone') : estimate.perDayUsd != null
    ? t('catalog.judging.cost', { cost: formatCost(estimate.perDayUsd), sampled: n(estimate.sampledPerDay ?? 0), runs: n(estimate.runsPerDay), each: formatCost(estimate.reviewUsd ?? 0) })
    : t('catalog.judging.costNoReview', { sampled: n(estimate.sampledPerDay ?? 0), runs: n(estimate.runsPerDay) });
  // the runs their receipts decide cost nothing (ADR 0130)
  const free = estimate && (estimate.receiptsPerDay ?? 0) > 0 ? t('catalog.judging.receipts', { runs: n(estimate.receiptsPerDay) }) : '';
  const last = estimate?.lastBatch;
  const choices = CAP_CHOICES.includes(cap as typeof CAP_CHOICES[number]) ? CAP_CHOICES : [...CAP_CHOICES, cap].sort((a, b) => a - b);
  return <section className="judging-switch" data-on={on} data-testid="judging-switch">
    <div className="judging-text">
      <span className="judging-title"><label htmlFor="judging-on">{t('catalog.judging.title')}</label>
        <HelpTip title={t('explain.judge.title')} testid="judging-help"><p>{t('explain.judge.p1')}</p><p>{t('explain.judge.p2')}</p><p>{t('explain.judge.p3')}</p></HelpTip></span>
      <p className="judging-desc">{t(on ? 'catalog.judging.onDesc' : 'catalog.judging.offDesc')}</p>
      {!on && <p className="judging-off" data-testid="judging-off">{offSince !== null
        ? t('catalog.judging.offSince', { day: new Date(offSince).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' }) }) : t('catalog.judging.offNoDay')}</p>}
      <p className="judging-cost" data-testid="judging-cost">{cost}{free && ` ${free}`}</p>
      {on && last && <p className="judging-last" data-testid="judging-last">{t('catalog.judging.last', { when: updatedWhen(last.at, clockNow()), runs: last.runs, cost: last.costUsd === null ? '—' : formatCost(last.costUsd) })}</p>}
    </div>
    <div className="judging-controls">
      <div className="judging-cap" role="radiogroup" aria-label={t('catalog.judging.capLabel')} data-testid="judging-cap" aria-disabled={!on}>
        <span className="judging-cap-label">{t('catalog.judging.capLabel')}</span>
        <span className="judging-cap-seg">{choices.map(v => <button key={v} type="button" role="radio" aria-checked={v === cap} className={v === cap ? 'on' : ''} disabled={!on}
          onClick={() => { if (v !== cap) void setSetting({ judgingCapUsd: v }); }} data-testid={`judging-cap-${v}`}>{`${v.toLocaleString(locale(), { maximumFractionDigits: 2 })} $`}</button>)}</span>
      </div>
      <button id="judging-on" type="button" role="switch" aria-checked={on} disabled={busy} className={`judging-toggle${on ? ' on' : ''}`} onClick={flip} data-testid="judging-on"><span className="judging-knob" aria-hidden="true" /></button>
    </div>
  </section>;
}
