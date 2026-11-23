// Impostazioni → Ruoli e deleghe (ADR 0083): the limits of delegation between role chats (how deep a chain of children
// may go, how many children of one parent work at once, after how many quiet minutes a child counts as stalled;
// stallMin is read by agents/delegation.ts stalledMin). The independent reviews are one switch on the Agenti page
// (JudgingSwitch, 2026-10-22). Models, presets, effort and Code Mode are chosen on each role's card since 2026-11-23
// (the owner: «solo ed esclusivamente dalle card degli agenti oppure che lo setti l'orchestrator, non dalle
// impostazioni»). Each change saves at once through settings:set (the main side checks the range; agents cannot
// change these keys). Mounted by SettingsPage.tsx.
import { DELEGATION_RANGE, type DelegationSettings as Limits } from '@shared/roles';
import { useApp, setSetting } from '../store/store';
import { t } from '../i18n';
import { Select } from './Select';
import { HelpTip } from './HelpTip';

const KEYS = ['maxDepth', 'maxParallel', 'stallMin'] as const satisfies readonly (keyof Limits)[];
const range = (k: keyof Limits): number[] => { const r = DELEGATION_RANGE[k]; return Array.from({ length: r.max - r.min + 1 }, (_, i) => r.min + i); };

export function DelegationSettings() {
  const limits = useApp(s => s.settings?.delegation);
  if (!limits) return null;
  return <>
    {KEYS.map(k => <div className="st-row" key={k}>
      <div className="st-text"><span className="st-title-line"><label className="st-title" htmlFor={`st-delegation-${k}`}>{t(`delegation.${k}`)}</label>{k === 'stallMin' && <HelpTip title={t('explain.stall.title')} testid="st-stall-help"><p>{t('explain.stall.p1')}</p><p>{t('explain.stall.p2')}</p></HelpTip>}</span><p className="st-desc">{t(`delegation.${k}.hint`)}</p></div>
      <div className="st-ctl"><Select id={`st-delegation-${k}`} data-testid={`st-delegation-${k}`} value={limits[k]} onChange={e => void setSetting({ delegation: { [k]: Number(e.target.value) } })}>
        {range(k).map(n => <option key={n} value={n}>{n}</option>)}
      </Select></div>
    </div>)}
    <p className="st-desc" data-testid="st-models-on-cards">{t('delegation.modelsOnCards')}</p>
  </>;
}
