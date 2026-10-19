// Impostazioni → Ruoli e deleghe (ADR 0083): the limits of delegation between role chats (how deep a chain of children
// may go, how many children of one parent work at once, after how many quiet minutes a child counts as stalled, how
// many finished runs the Judge reviews a day) and the model each tier (leggero / medio / alto) runs on per engine.
// Each change saves at once through settings:set (the main side checks the range; agents cannot change these keys).
// Mounted by SettingsPage.tsx.
import { useEffect, useState } from 'react';
import { DELEGATION_RANGE, MODEL_TIERS, type DelegationSettings as Limits, type ModelTier } from '@shared/roles';
import { useApp, setSetting } from '../store/store';
import { useEngines } from '../lib/engines';
import { t } from '../i18n';
import { Select } from './Select';
import { HelpTip } from './HelpTip';

const KEYS = ['maxDepth', 'maxParallel', 'stallMin', 'judgeDaily'] as const satisfies readonly (keyof Limits)[];
const range = (k: keyof Limits): number[] => { const r = DELEGATION_RANGE[k]; return Array.from({ length: r.max - r.min + 1 }, (_, i) => r.min + i); };

export function DelegationSettings() {
  const limits = useApp(s => s.settings?.delegation);
  const tiers = useApp(s => s.settings?.modelTiers);
  const engines = useEngines().filter(e => e.kind !== 'api');
  if (!limits) return null;
  return <>
    {KEYS.map(k => <div className="st-row" key={k}>
      <div className="st-text"><span className="st-title-line"><label className="st-title" htmlFor={`st-delegation-${k}`}>{t(`delegation.${k}`)}</label>{k === 'judgeDaily' && <HelpTip title={t('explain.judge.title')} testid="st-judge-help"><p>{t('explain.judge.p1')}</p><p>{t('explain.judge.p2')}</p></HelpTip>}</span><p className="st-desc">{t(`delegation.${k}.hint`)}</p></div>
      <div className="st-ctl"><Select id={`st-delegation-${k}`} data-testid={`st-delegation-${k}`} value={limits[k]} onChange={e => void setSetting({ delegation: { [k]: Number(e.target.value) } })}>
        {range(k).map(n => <option key={n} value={n}>{k === 'judgeDaily' && n === 0 ? t('delegation.off') : n}</option>)}
      </Select></div>
    </div>)}
    <div className="st-row st-row-block">
      <div className="st-text"><b className="st-title">{t('delegation.tiers')}<HelpTip title={t('explain.tiers.title')} testid="st-tiers-help"><p>{t('explain.tiers.p1')}</p><p>{t('explain.tiers.p2')}</p></HelpTip></b><p className="st-desc">{t('delegation.tiers.hint')}</p></div>
      <div className="st-tiers" role="table" aria-label={t('delegation.tiers')}>
        <div className="st-tiers-row st-tiers-head" role="row"><span role="columnheader" />{MODEL_TIERS.map(tier => <span role="columnheader" key={tier}>{t(`delegation.tier.${tier}`)}</span>)}</div>
        {engines.map(e => <div className="st-tiers-row" role="row" key={e.id}><span role="rowheader" className="st-tiers-engine">{e.name}</span>
          {MODEL_TIERS.map(tier => <TierModel key={tier} engine={e.id} tier={tier} value={tiers?.[e.id]?.[tier] ?? ''} />)}
        </div>)}
      </div>
    </div>
  </>;
}

/** One tier's model on one engine: a text field saved when it loses focus (empty = the brain's model registry). */
function TierModel({ engine, tier, value }: { engine: string; tier: ModelTier; value: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const save = () => { const v = draft.trim(); if (v !== value) void setSetting({ modelTiers: { [engine]: { [tier]: v } } }); };
  return <span role="cell"><input className="st-input st-tier-input" value={draft} placeholder={t('delegation.tier.auto')} spellCheck={false} aria-label={`${engine} · ${t(`delegation.tier.${tier}`)}`}
    data-testid={`st-tier-${engine}-${tier}`} onChange={e => setDraft(e.target.value)} onBlur={save} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /></span>;
}
