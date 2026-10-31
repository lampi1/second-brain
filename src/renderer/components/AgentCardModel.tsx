// The «Modello» block on the back of an agent card (owner, 2026-10-31: «nel retro della card degli agenti si possa
// scegliere già lì le info principali, cioè modello, effort e context window», ADR 0211): three pickers saved straight
// to the role's card (agents:save, a new version like every model change). The effort list is the chosen model's own,
// by its real names (low, medium, high, xhigh, max: the registry's), and the line under it says what a run really gets
// (shared/agents.ts effortOn: the same rule the launch applies). The context list stops at the model's window. Used by
// AgentCatalogCard. Styles: styles/agent-catalog.css (.catalog-model).
import { useState } from 'react';
import type { Effort } from '@shared/contract';
import { MAX_CONTEXT_RANGE, effortOn, type AgentProfile } from '@shared/agents';
import { EFFORTS } from '../lib/format';
import { agentDraftOf } from '../lib/agent-drafts';
import { saveAgent, useAgents } from '../store/agents';
import { Select } from './Select';
import { t } from '../i18n';

/** The context sizes offered (tokens): the app's range, in round steps. */
const CONTEXTS = [200_000, 400_000, 600_000, 800_000, 1_000_000].filter(n => n >= MAX_CONTEXT_RANGE.min && n <= MAX_CONTEXT_RANGE.max);
const kTokens = (n: number) => n >= 1_000_000 ? `${n / 1_000_000}M` : `${Math.round(n / 1000)}k`;

export function AgentCardModel({ profile }: { profile: AgentProfile }) {
  const { catalog } = useAgents();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choice = catalog?.models.find(m => m.engine === profile.engine);
  const model = profile.model ? choice?.models.find(m => m.id === profile.model) : undefined;
  // the model's own levels; the tier's model is resolved at launch, so every level is offered and clamped there
  const efforts: readonly Effort[] = model?.efforts ?? EFFORTS;
  const real = effortOn(profile.effort, model?.efforts);
  const window = model?.contextWindow ?? MAX_CONTEXT_RANGE.max;
  const save = async (change: Partial<Pick<AgentProfile, 'model' | 'effort' | 'maxContext'>>) => {
    setBusy(true); setError(null);
    try { await saveAgent({ ...agentDraftOf(profile), ...change }, profile.id); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const id = profile.id;
  return <section className="catalog-model" aria-label={t('studio.model')} data-testid={`catalog-model-${id}`}>
    <h4>{t('agentCard.modelTitle')}</h4>
    <label className="catalog-model-row"><span>{t('studio.model')}</span>
      <Select value={profile.model ?? ''} disabled={busy || !choice?.modelSelectable} data-testid={`catalog-model-pick-${id}`}
        onChange={e => void save({ model: e.target.value || null })}>
        <option value="">{t('agentCard.tierModel', { tier: t(`roles.tier.${profile.tier}`) })}</option>
        {(choice?.models ?? []).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
      </Select></label>
    {choice?.effort && <label className="catalog-model-row"><span>{t('studio.effort')}</span>
      <Select value={profile.effort ?? ''} disabled={busy || (model?.efforts !== undefined && !model.efforts.length)} data-testid={`catalog-effort-pick-${id}`}
        onChange={e => void save({ effort: EFFORTS.find(x => x === e.target.value) })}>
        <option value="">{model?.defaultEffort ? t('agentCard.effortDefaultIs', { effort: model.defaultEffort }) : t('agentCard.effortDefault')}</option>
        {efforts.map(x => <option key={x} value={x}>{x}</option>)}
      </Select></label>}
    {profile.effort && real !== profile.effort && <small className="catalog-model-note" data-testid={`catalog-effort-real-${id}`}>
      {real ? t('agentCard.effortClamped', { asked: profile.effort, real }) : t('agentCard.effortNone')}</small>}
    {choice?.maxContext && <label className="catalog-model-row"><span>{t('agentCard.context')}</span>
      <Select value={profile.maxContext ? String(profile.maxContext) : ''} disabled={busy} data-testid={`catalog-context-pick-${id}`}
        onChange={e => void save({ maxContext: e.target.value ? Number(e.target.value) : null })}>
        <option value="">{t('agentCard.contextDefault', { max: kTokens(window) })}</option>
        {CONTEXTS.filter(n => n <= window).map(n => <option key={n} value={String(n)}>{kTokens(n)}</option>)}
        {profile.maxContext && !CONTEXTS.includes(profile.maxContext) && <option value={String(profile.maxContext)}>{kTokens(profile.maxContext)}</option>}
      </Select></label>}
    {error && <p role="alert" className="catalog-model-note">{error}</p>}
  </section>;
}
