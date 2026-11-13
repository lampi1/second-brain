// «Modalità notte» (ADR 0191; the owner, 2026-10-29: «una modalità in cui non faccia domande e prosegua tutta la notte»):
// the moon on the Orchestrator's head turns it on and off (the setting awayMode, settings:set like any row of Settings),
// and while it is on a line under the head says so with «Sono qui» to turn it off. What it does lives in main
// (chats/manager.ts awayAnswered, chats/away-log.ts). Used by OrchestratorTile.tsx and SettingsPage.tsx (AwaySettings).
import '../styles/away.css';
import { setSetting, useApp } from '../store/store';
import { t } from '../i18n';
import { IconButton } from './ui';
import { IconMoon } from './Icons';

export function AwayButton() {
  const on = useApp(s => s.settings?.awayMode === true);
  return <IconButton label={on ? t('away.turnOff') : t('away.turnOn')} aria-pressed={on} className={on ? 'away-on' : ''}
    onClick={() => void setSetting({ awayMode: !on })} testid="orchestrator-away"><IconMoon size={14} /></IconButton>;
}

export function AwayLine() {
  const on = useApp(s => s.settings?.awayMode === true);
  if (!on) return null;
  return <div className="away-line" role="status" data-testid="away-line">
    <IconMoon size={14} aria-hidden="true" /><span>{t('away.lineShort')}</span>
    <button type="button" className="btn btn-subtle btn-s" onClick={() => void setSetting({ awayMode: false })} data-testid="away-off">{t('away.off')}</button>
  </div>;
}

/** Settings → Generali: the same switch, with what it does. */
export function AwaySettings() {
  const on = useApp(s => s.settings?.awayMode === true);
  return <div className="st-row" data-testid="st-away">
    <div className="st-text"><label className="st-title" htmlFor="st-away-on">{t('away.title')}</label><p className="st-desc">{t('away.hint')}</p></div>
    <div className="st-ctl"><button id="st-away-on" type="button" role="switch" aria-checked={on} aria-label={t('away.title')} className={`st-switch ${on ? 'on' : ''}`} onClick={() => void setSetting({ awayMode: !on })} data-testid="st-away-on"><span className="st-knob" aria-hidden="true" /></button></div>
  </div>;
}
