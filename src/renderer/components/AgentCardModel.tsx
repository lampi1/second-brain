// The «Modello» block on the back of an agent card (owner, 2026-10-31: «nel retro della card degli agenti si possa
// scegliere già lì le info principali, cioè modello, effort e context window», ADR 0211): engine, model and effort in the
// shared picker (ModelPicker.tsx, the same one the Orchestrator and the strips use; «Salva nel ruolo» saves the card,
// agents:save, a new version like every model change), the context window in its own list, saved at once and stopping at
// the model's window; the line under them says what a run really gets when the model lacks the effort asked
// (shared/agents.ts effortOn: the same rule the launch applies). Used by AgentCatalogCard. Styles:
// styles/agent-catalog.css (.catalog-model). With «Balanced mode» on the button reads «Balanced» (ADR 0218).
import { useRef, useState } from 'react';
import { MAX_CONTEXT_RANGE, effortOn, type AgentProfile } from '@shared/agents';
import { isWorkRole } from '@shared/roles';
import { agentDraftOf } from '../lib/agent-drafts';
import { saveAgent, useAgents } from '../store/agents';
import { useApp } from '../store/store';
import { Select } from './Select';
import { HarnessMark } from './Icons';
import { ModelPicker } from './ModelPicker';
import { kTokens } from '../lib/model-catalog';
import { t } from '../i18n';

/** The context sizes offered (tokens): the app's range, in round steps. */
const CONTEXTS = [200_000, 400_000, 600_000, 800_000, 1_000_000].filter(n => n >= MAX_CONTEXT_RANGE.min && n <= MAX_CONTEXT_RANGE.max);

export function AgentCardModel({ profile }: { profile: AgentProfile }) {
  const { catalog } = useAgents();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choice = catalog?.models.find(m => m.engine === profile.engine);
  const model = profile.model ? choice?.models.find(m => m.id === profile.model) : undefined;
  const anchor = useRef<HTMLButtonElement>(null);
  const [picker, setPicker] = useState(false);
  const real = effortOn(profile.effort, model?.efforts);
  const window = model?.contextWindow ?? MAX_CONTEXT_RANGE.max;
  const save = async (change: Partial<Pick<AgentProfile, 'maxContext'>>) => {
    setBusy(true); setError(null);
    try { await saveAgent({ ...agentDraftOf(profile), ...change }, profile.id); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const id = profile.id;
  // «Balanced mode» on (ADR 0218): the delegating agent picks; the card's own choice is kept for when it goes off. Only
  // work roles: the Orchestrator and Flash always run on their card
  const balanced = useApp(s => s.settings?.balancedMode === true) && isWorkRole(profile.id);
  return <section className="catalog-model" aria-label={t('studio.model')} data-testid={`catalog-model-${id}`}>
    <h4>{t('agentCard.modelTitle')}</h4>
    {/* engine, model and effort in the shared picker (ModelPicker.tsx): the default of the role's new chats */}
    <div className="catalog-model-row"><span>{t('studio.model')}</span>
      <button ref={anchor} type="button" className="ui-select catalog-model-button" aria-haspopup="dialog" aria-expanded={picker}
        onClick={() => setPicker(o => !o)} data-testid={`catalog-model-pick-${id}`}>
        {!balanced && <HarnessMark harness={profile.engine} size={13} />}
        <span className="catalog-model-button-text" data-balanced={balanced || undefined}>{balanced ? t('mp.balanced.card') : t('mp.cardButton', { engine: choice?.label ?? profile.engine,
          model: [model?.name ?? profile.model ?? t('agentCard.tierModel', { tier: t(`roles.tier.${profile.tier}`) }), profile.effort].filter(Boolean).join(' · ') })}</span>
        <span aria-hidden="true">▾</span>
      </button></div>
    {balanced && <small className="catalog-model-note" data-testid={`catalog-balanced-${id}`}>{t('mp.balanced.cardNote')}</small>}
    <ModelPicker scope={{ kind: 'role', profile }} anchor={anchor} open={picker} onClose={() => setPicker(false)} testid={`catalog-picker-${id}`} />
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
