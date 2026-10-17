// Inline packaged appearance preview. Draft choices are scoped to the preview until an explicit atomic apply/reset.
import {useState}from'react';
import {defaultAppearance,type AppearancePreference}from'@shared/appearance';
import {ui,setPrefs,savePrefs}from'../store/ui';
import {t}from'../i18n';
import '../styles/appearance.css';
export function AppearancePreview(){
  const applied=ui.use(s=>s.prefs.appearance),[draft,setDraft]=useState<AppearancePreference>(applied);
  const apply=(value:AppearancePreference)=>{setPrefs({appearance:value});savePrefs();setDraft(value);};
  return <details className="appearance-picker" onToggle={event=>{if(event.currentTarget.open)setDraft(applied);}}>
    <summary>{t('product.appearance')}</summary>
    <div className="appearance-controls">
      <fieldset><legend>{t('product.style')}</legend>{(['standard','calm'] as const).map(id=><label key={id}><input type="radio" name="appearance-preset" checked={draft.preset===id} onChange={()=>setDraft({...draft,preset:id})}/>{t(`product.${id}`)}</label>)}</fieldset>
      <fieldset><legend>{t('product.catalog')}</legend>{(['grid','list'] as const).map(id=><label key={id}><input type="radio" name="appearance-template" checked={draft.templates.agents===id} onChange={()=>setDraft({...draft,templates:{agents:id}})}/>{t(`product.${id}`)}</label>)}</fieldset>
      <div className="appearance-sample" data-appearance={draft.preset} data-template={draft.templates.agents} aria-label={t('product.preview')} data-testid="appearance-preview"><b>{t('product.preview')}</b><div><article><strong>{t('product.research')}</strong><span>{t('product.researchPurpose')}</span></article><article><strong>{t('product.organization')}</strong><span>{t('product.organizationPurpose')}</span></article></div></div>
      <div className="appearance-actions"><button type="button" className="btn btn-primary" onClick={()=>apply(draft)} data-testid="appearance-apply">{t('product.apply')}</button><button type="button" className="btn btn-ghost" onClick={()=>apply(defaultAppearance())}>{t('product.reset')}</button></div>
    </div>
  </details>;
}
