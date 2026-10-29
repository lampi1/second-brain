// The Agenti page's one switch for the roles' independent reviews (2026-10-22, the owner: "un toggle semplice … con una
// stima del costo al giorno"): «Abilita controllo livello e performance». On = every finished root run is reviewed by
// a Sentinel in a new session (main/agents/judge-sample.ts), from now on (judgingSince: no backlog); off = none. Beside
// it, what it costs a day: the runs a day it would review times what a review cost so far (agents:judgingEstimate,
// zero tokens), and the runs a day their receipts decide with no review (ADR 0130). Off, it says plainly since when no
// verified outcome arrives (ADR 0186). It replaced the "reviews per day" count of Impostazioni → Ruoli e deleghe. Used by AgentCatalogPage.tsx.
import { useEffect, useState } from 'react';
import type { JudgingEstimate } from '@shared/agents';
import { judgingOffSince } from '@shared/judging';
import { setSetting, useApp } from '../store/store';
import { formatCost } from '../lib/format';
import { sb } from '../sb';
import { locale, t } from '../i18n';
import { HelpTip } from './HelpTip';

export function JudgingSwitch() {
  const on = useApp(s => s.settings?.judging === true);
  const loaded = useApp(s => !!s.settings);
  const [estimate, setEstimate] = useState<JudgingEstimate | null>(null);
  const [busy, setBusy] = useState(false);
  // off: since when, from the settings' change log (ADR 0186); null = not in the log
  const [offSince, setOffSince] = useState<number | null>(null);
  useEffect(() => {
    if (on || !loaded) return;
    let alive = true;
    sb.invoke('settings:history', { limit: 500 }).then(h => { if (alive) setOffSince(judgingOffSince(h)); }, () => { if (alive) setOffSince(null); });
    return () => { alive = false; };
  }, [on, loaded]);
  useEffect(() => {
    let alive = true;
    const read = () => sb.invoke('agents:judgingEstimate', undefined).then(e => { if (alive) setEstimate(e); }, () => { if (alive) setEstimate(null); });
    read();
    const timer = setInterval(read, 60_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  if (!loaded) return null;
  const flip = () => {
    setBusy(true);
    void setSetting(on ? { judging: false } : { judging: true, judgingSince: Date.now() }).finally(() => setBusy(false));
  };
  const cost = !estimate || estimate.runsPerDay <= 0 ? t('catalog.judging.costNone') : estimate.perDayUsd != null
    ? t('catalog.judging.cost', { cost: formatCost(estimate.perDayUsd), runs: estimate.runsPerDay.toLocaleString(locale()), each: formatCost(estimate.reviewUsd ?? 0), audits: (estimate.auditsPerDay ?? 0).toLocaleString(locale()) })
    : t('catalog.judging.costNoReview', { runs: estimate.runsPerDay.toLocaleString(locale()) });
  // the runs their receipts decide cost nothing (ADR 0130); a saved estimate from before it has no count
  const free = estimate && (estimate.receiptsPerDay ?? 0) > 0 ? t('catalog.judging.receipts', { runs: estimate.receiptsPerDay.toLocaleString(locale()) }) : '';
  return <section className="judging-switch" data-on={on} data-testid="judging-switch">
    <div className="judging-text">
      <span className="judging-title"><label htmlFor="judging-on">{t('catalog.judging.title')}</label>
        <HelpTip title={t('explain.judge.title')} testid="judging-help"><p>{t('explain.judge.p1')}</p><p>{t('explain.judge.p2')}</p><p>{t('explain.judge.p3')}</p></HelpTip></span>
      <p className="judging-desc">{t(on ? 'catalog.judging.onDesc' : 'catalog.judging.offDesc')}</p>
      {!on && <p className="judging-off" role="status" data-testid="judging-off">{offSince !== null
        ? t('catalog.judging.offSince', { day: new Date(offSince).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' }) }) : t('catalog.judging.offNoDay')}</p>}
      <p className="judging-cost" data-testid="judging-cost">{cost}{free && ` ${free}`}</p>
    </div>
    <button id="judging-on" type="button" role="switch" aria-checked={on} disabled={busy} className={`judging-toggle${on ? ' on' : ''}`} onClick={flip} data-testid="judging-on"><span className="judging-knob" aria-hidden="true" /></button>
  </section>;
}
