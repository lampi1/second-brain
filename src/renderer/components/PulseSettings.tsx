// Settings → Notifiche, the Battito's three settings (ADR 0102: they existed only in the schema, so it spent with no
// switch in sight): on / off, its times (one to three HH:MM; the Dashboard line is written in the day's first call)
// and its daily budget, with what it spent today beside them (pulse:status). Writes go through settings:set like every
// other row of the page (the user's own click). Mounted by SettingsPage.tsx.
import { useEffect, useState } from 'react';
import type { PulseStatus } from '@shared/pulse';
import { setSetting, useApp } from '../store/store';
import { locale, t } from '../i18n';
import { parseSlots } from '../lib/pulse-context';

const usd = (v: number) => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(v);

function usePulseStatus(): PulseStatus | null {
  const [st, setSt] = useState<PulseStatus | null>(null);
  useEffect(() => {
    // the bridge read here, not at import: the settings page also renders in node tests (no window there)
    const sb = window.sb;
    let live = true;
    const read = () => { void sb.invoke('pulse:status', undefined).then(v => { if (live) setSt(v); }, () => {}); };
    read();
    const off = sb.on('pulse:changed', read);
    return () => { live = false; off(); };
  }, []);
  return st;
}

export function PulseSettings() {
  const pulse = useApp(s => s.settings?.pulse);
  const status = usePulseStatus();
  const [slots, setSlots] = useState(''), [budget, setBudget] = useState(''), [bad, setBad] = useState<'slots' | 'budget' | null>(null);
  useEffect(() => { if (pulse) { setSlots(pulse.slots.join(', ')); setBudget(String(pulse.dailyUsd)); } }, [pulse?.slots.join(','), pulse?.dailyUsd]);
  if (!pulse) return null;
  const saveSlots = () => { const v = parseSlots(slots); if (!v) { setBad('slots'); return; } setBad(null); if (v.join(',') !== pulse.slots.join(',')) void setSetting({ pulse: { slots: v } }); };
  const saveBudget = () => {
    const v = Math.round(Number(budget.replace(',', '.')) * 100) / 100;
    if (!(v >= 0.01 && v <= 2)) { setBad('budget'); return; }
    setBad(null); if (v !== pulse.dailyUsd) void setSetting({ pulse: { dailyUsd: v } });
  };
  const today = status?.today;
  return <>
    <div className="st-row" data-testid="st-pulse">
      <div className="st-text"><label className="st-title" htmlFor="st-pulse-on">{t('alive.pulse.title')}</label>
        <p className="st-desc">{t('alive.pulse.hint')}</p>
        {today && <p className="st-desc" data-testid="st-pulse-today">{t('alive.pulse.today', { usd: usd(today.usd), limit: usd(today.limitUsd), runs: today.runs })}{today.basis === 'unknown' ? ` · ${t('alive.pulse.unknownCost')}` : ''}</p>}
      </div>
      <div className="st-ctl"><button id="st-pulse-on" type="button" role="switch" aria-checked={pulse.on} aria-label={t('alive.pulse.title')} className={`st-switch ${pulse.on ? 'on' : ''}`} onClick={() => void setSetting({ pulse: { on: !pulse.on } })} data-testid="st-pulse-on"><span className="st-knob" aria-hidden="true" /></button></div>
    </div>
    <div className="st-row">
      <div className="st-text"><label className="st-title" htmlFor="st-pulse-slots">{t('alive.pulse.slots')}</label><p className="st-desc">{bad === 'slots' ? t('alive.pulse.slotsBad') : t('alive.pulse.slotsHint')}</p></div>
      <div className="st-ctl"><input id="st-pulse-slots" className="st-input" value={slots} disabled={!pulse.on} spellCheck={false} aria-invalid={bad === 'slots' || undefined} data-testid="st-pulse-slots"
        onChange={e => setSlots(e.target.value)} onBlur={saveSlots} onKeyDown={e => { if (e.key === 'Enter') saveSlots(); }} /></div>
    </div>
    <div className="st-row">
      <div className="st-text"><label className="st-title" htmlFor="st-pulse-budget">{t('alive.pulse.budget')}</label><p className="st-desc">{t('alive.pulse.budgetHint')}</p></div>
      <div className="st-ctl"><input id="st-pulse-budget" className="st-input" inputMode="decimal" value={budget} disabled={!pulse.on} aria-invalid={bad === 'budget' || undefined} data-testid="st-pulse-budget"
        onChange={e => setBudget(e.target.value)} onBlur={saveBudget} onKeyDown={e => { if (e.key === 'Enter') saveBudget(); }} /></div>
    </div>
  </>;
}
