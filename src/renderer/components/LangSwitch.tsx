// The language switch in the top bar (ADR 0120): one place for "my language", the UI's and the AI's. It shows the
// language in force as a compact code (IT / EN / DE, with a globe; only the code at the last fit step) and opens a menu
// with the same options as Settings → Aspetto → Lingua (system, it, en, de): both write the one setting `language`, so
// they are always in sync. A change re-mounts the UI (i18n/LangRoot.tsx), and main rewrites the profile's `Language:`
// line and tells new and open chats (main/index.ts settings:set, main/chats/reply-lang.ts).
// Used by TopBar.tsx, in its end group (never leaves the screen, also in a narrow window).
import { useRef, useState } from 'react';
import { LANGS, type LanguageMode } from '@shared/contract';
import { lang, resolveLang, t } from '../i18n';
import { setSetting, useApp } from '../store/store';
import { IconGlobe } from './Icons';
import { MenuItem, MenuLabel, Popover } from './ui';

const MODES: readonly LanguageMode[] = ['system', ...LANGS];

export function LangSwitch() {
  const mode = useApp(s => s.settings?.language ?? 'system');
  const system = useApp(s => s.info?.systemLang);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const now = resolveLang(mode, system ?? lang());
  const name = (m: LanguageMode) => m === 'system' ? t('langSwitch.system', { name: t(`settings.language.${system ?? lang()}`) }) : t(`settings.language.${m}`);
  const tip = t('langSwitch.tip', { name: name(mode) });
  const pick = (m: LanguageMode) => { setOpen(false); if (m !== mode) void setSetting({ language: m }); };
  return (
    <>
      <button ref={ref} type="button" className="lang-btn" onClick={() => setOpen(o => !o)} aria-label={tip} data-tip={tip}
        aria-expanded={open} aria-haspopup="menu" data-mode={mode} data-testid="topbar-lang">
        <IconGlobe size={14} /><span className="lang-code">{now.toUpperCase()}</span>
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} testid="topbar-lang-pop" width={260} label={t('langSwitch.heading')}>
        <MenuLabel>{t('langSwitch.heading')}</MenuLabel>
        {MODES.map(m => <MenuItem key={m} checked={m === mode} onSelect={() => pick(m)} testid={`topbar-lang-${m}`}>{name(m)}</MenuItem>)}
        <p className="menu-note">{t('langSwitch.note')}</p>
      </Popover>
    </>
  );
}
