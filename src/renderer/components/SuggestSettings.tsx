// Settings → Scrittura, the chat composer's inline suggestion (issue #167, ADR 0118): on / off. The suggestions are the
// zero-token local ones only (renderer/lib/composer-suggest.ts; the model part was removed, ADR 0201). The write goes
// through settings:set like every other row of the page (the user's own click). Mounted by SettingsPage.tsx.
import { setSetting, useApp } from '../store/store';
import { t } from '../i18n';

export function SuggestSettings() {
  const settings = useApp(s => s.settings);
  if (!settings) return null;
  const on = settings.suggestOn !== false;
  return <div className="st-row" data-testid="st-suggest">
    <div className="st-text"><label className="st-title" htmlFor="st-suggest-on">{t('suggest.title')}</label><p className="st-desc">{t('suggest.hint')}</p></div>
    <div className="st-ctl"><button id="st-suggest-on" type="button" role="switch" aria-checked={on} aria-label={t('suggest.title')} className={`st-switch ${on ? 'on' : ''}`} onClick={() => void setSetting({ suggestOn: !on })} data-testid="st-suggest-on"><span className="st-knob" aria-hidden="true" /></button></div>
  </div>;
}
