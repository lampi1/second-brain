// The first step of the first-run setup wizard (FirstInterview.tsx, issue #164, ADR 0119): one big button per UI language
// (Italiano, English, Deutsch), each written in its own language, the current one (the system language on a fresh
// install) preselected. A click asks the wizard to switch at once (it saves the draft first, then the setting
// `language`: the tree re-mounts in the new language and the wizard resumes on this step with its answers). The same
// value becomes the chat language in me.md and the new brain's language on confirm.
import type { Lang } from '@shared/contract';
import { LANGS } from '@shared/contract';
import { t } from '../i18n';
import { LANG_NATIVE } from '../lib/setup-wizard';
import { IconCheck } from './Icons';

export function SetupLanguage({ current, system, busy, onPick }: { current: Lang; system: Lang | undefined; busy: boolean; onPick: (lang: Lang) => void }) {
  return <div className="sw-stack" data-testid="setup-language">
    <div className="sw-langs" role="radiogroup" aria-label={t('setup.lang.group')}>{LANGS.map(l => {
      const on = l === current;
      return <button key={l} type="button" role="radio" aria-checked={on} lang={l} className={`sw-lang${on ? ' is-on' : ''}`} disabled={busy} onClick={() => onPick(l)} data-testid={`setup-lang-${l}`}>
        <span className="sw-lang-code" aria-hidden="true">{l.toUpperCase()}</span>
        <span className="sw-lang-text"><b>{LANG_NATIVE[l].name}</b>{l === system ? <small lang={current}>{t('setup.lang.system')}</small> : <small>{LANG_NATIVE[l].region}</small>}</span>
        <span className="sw-lang-check" aria-hidden="true">{on && <IconCheck size={14}/>}</span>
      </button>;
    })}</div>
    <p className="sw-hint">{t('setup.lang.note')}</p>
  </div>;
}
