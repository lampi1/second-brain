// Settings → Scrittura, the chat composer's inline suggestion (issue #167, ADR 0118): on / off, its model part on /
// off, and the model part's daily budget with what it spent today beside it ('suggest:state'). Writes go through
// settings:set like every other row of the page (the user's own click). Mounted by SettingsPage.tsx.
import { useEffect, useState } from 'react';
import { SUGGEST_DEFAULT_DAILY_USD } from '@shared/composer-suggest';
import { setSetting, useApp } from '../store/store';
import { formatCost } from '../lib/format';
import { t } from '../i18n';
import { useSuggestState } from '../lib/suggest-state';

export function SuggestSettings() {
  const settings = useApp(s => s.settings);
  const status = useSuggestState(`${settings?.suggestOn}|${settings?.suggestModel}|${settings?.suggestDailyUsd}`);
  const daily = settings?.suggestDailyUsd ?? SUGGEST_DEFAULT_DAILY_USD;
  const [budget, setBudget] = useState(String(daily)), [bad, setBad] = useState(false);
  useEffect(() => { setBudget(String(daily)); }, [daily]);
  if (!settings) return null;
  const on = settings.suggestOn !== false, model = settings.suggestModel !== false;
  const saveBudget = () => {
    const v = Math.round(Number(budget.replace(',', '.')) * 100) / 100;
    if (!(v >= 0.01 && v <= 1)) { setBad(true); return; }
    setBad(false); if (v !== daily) void setSetting({ suggestDailyUsd: v });
  };
  return <>
    <div className="st-row" data-testid="st-suggest">
      <div className="st-text"><label className="st-title" htmlFor="st-suggest-on">{t('suggest.title')}</label><p className="st-desc">{t('suggest.hint')}</p></div>
      <div className="st-ctl"><button id="st-suggest-on" type="button" role="switch" aria-checked={on} aria-label={t('suggest.title')} className={`st-switch ${on ? 'on' : ''}`} onClick={() => void setSetting({ suggestOn: !on })} data-testid="st-suggest-on"><span className="st-knob" aria-hidden="true" /></button></div>
    </div>
    <div className="st-row">
      <div className="st-text"><label className="st-title" htmlFor="st-suggest-model">{t('suggest.model')}</label><p className="st-desc">{t('suggest.modelHint')}</p>
        {status && <p className="st-desc" data-testid="st-suggest-today">{t('suggest.today', { usd: formatCost(status.usd), limit: formatCost(status.budgetUsd), calls: status.calls, hits: status.cacheHits })}</p>}
      </div>
      <div className="st-ctl"><button id="st-suggest-model" type="button" role="switch" aria-checked={on && model} aria-label={t('suggest.model')} disabled={!on} className={`st-switch ${on && model ? 'on' : ''}`} onClick={() => void setSetting({ suggestModel: !model })} data-testid="st-suggest-model"><span className="st-knob" aria-hidden="true" /></button></div>
    </div>
    <div className="st-row">
      <div className="st-text"><label className="st-title" htmlFor="st-suggest-budget">{t('suggest.budget')}</label><p className="st-desc">{bad ? t('suggest.budgetBad') : t('suggest.budgetHint')}</p></div>
      <div className="st-ctl"><input id="st-suggest-budget" className="st-input" inputMode="decimal" value={budget} disabled={!on || !model} aria-invalid={bad || undefined} data-testid="st-suggest-budget"
        onChange={e => setBudget(e.target.value)} onBlur={saveBudget} onKeyDown={e => { if (e.key === 'Enter') saveBudget(); }} /></div>
    </div>
  </>;
}
