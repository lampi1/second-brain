// A role's «Modelli per compito» (ADR 0336) on its own page, Agenti → a role (AgentStudio.tsx; the owner, 2026-11-23:
// the preset is chosen «solo ed esclusivamente dalle card degli agenti oppure che lo setti l'orchestrator, non dalle
// impostazioni»): its engine, then the rows Minimo / Base / Massimo with a model and an effort each. Base is the card's
// own model and effort; Minimo and Massimo empty = the same as Base. Each change saves the card at once (agents:save,
// the main side checks the models and the order by price and its error is shown under the role), with Annulla after
// it; the Orchestrator shows only Base. A delegation picks one of the three (agent_delegate / agent_assign_task /
// app_create_chat preset). Styles: styles/settings.css (.st-presets).
import { useState } from 'react';
import type { AgentDraft, AgentProfile } from '@shared/agents';
import { PRESET_IDS, cardPresets, type PresetId, type RolePresets as Presets } from '@shared/model-presets';
import { agentDraftOf } from '../lib/agent-drafts';
import { EFFORTS, effortLabel } from '../lib/format';
import { saveAgent, useAgents } from '../store/agents';
import { toast } from '../store/ui';
import { Select } from './Select';
import { t } from '../i18n';
import '../styles/settings.css';

const LABEL = { min: 'delegation.preset.min', base: 'delegation.preset.base', max: 'delegation.preset.max' } as const satisfies Record<PresetId, string>;

/** The change a pick makes on the card: Base is the card's model and effort, Minimo and Massimo its presets (empty =
 *  dropped, the same as Base; `{}` clears the last one; Base's effort null = the engine default). */
export function presetChange(profile: AgentProfile, id: PresetId, model: string, effort: string): Partial<AgentDraft> {
  const e = EFFORTS.find(x => x === effort);
  // Base's «Predefinito» is null, never undefined: a save drops undefined fields and would keep the old effort
  if (id === 'base') return { model: model || null, effort: e ?? null };
  const next: Presets = { ...(profile.presets ?? {}) };
  if (model) next[id] = { model, ...(e ? { effort: e } : {}) }; else delete next[id];
  return { presets: next };
}

/** The draft that puts back a card's model, effort and presets as they were before a pick (Annulla on the role's page):
 *  null and {} rather than undefined, since a save keeps the fields a draft leaves out. */
export function presetUndo(before: AgentProfile): AgentDraft {
  return { ...agentDraftOf(before), model: before.model ?? null, effort: before.effort ?? null, presets: before.presets ?? {} };
}

/** Saves one pick on the card (agents:save); `undoable`: then a toast with Annulla that puts the card back as it was. */
export async function savePreset(profile: AgentProfile, id: PresetId, model: string, effort: string, undoable: boolean): Promise<void> {
  await saveAgent({ ...agentDraftOf(profile), ...presetChange(profile, id, model, effort) }, profile.id);
  if (undoable) toast(t('agentDetail.presets.saved', { preset: t(LABEL[id]) }), 'ok', { label: t('agentDetail.presets.undo'), run: () => {
    saveAgent(presetUndo(profile), profile.id).catch((e: unknown) => toast(e instanceof Error ? e.message : String(e), 'err'));
  } });
}

/** One role's engine and its rows: all three for a work role, `ids` to show fewer (the Orchestrator: Base only);
 *  `undoable` offers Annulla after each save (the role's page). */
export function RolePresetRows({ profile, ids = PRESET_IDS, undoable = false }: { profile: AgentProfile; ids?: readonly PresetId[]; undoable?: boolean }) {
  const { catalog } = useAgents();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const engine = catalog?.models.find(m => m.engine === profile.engine);
  const all = cardPresets(profile, null);
  const own = (id: PresetId) => id === 'base' ? { model: profile.model ?? null, effort: profile.effort } : profile.presets?.[id] ?? { model: null, effort: undefined };
  const save = async (id: PresetId, model: string, effort: string) => {
    setBusy(true); setError(null);
    try { await savePreset(profile, id, model, effort, undoable); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const fixed = !engine?.modelSelectable;
  return <section className="st-presets-role" aria-label={profile.name} data-testid={`st-presets-${profile.id}`}>
    <div className="st-presets-head"><b>{profile.name}</b><span className="st-presets-engine" data-testid={`st-presets-engine-${profile.id}`}>{engine?.label ?? profile.engine}</span></div>
    {fixed && <p className="st-desc">{t('delegation.presets.fixed')}</p>}
    <div role="table" aria-label={`${profile.name} · ${t('delegation.presets')}`}>
      {ids.map(id => {
        const set = own(id), model = set.model ?? '', shown = all[id];
        const efforts = engine?.models.find(m => m.id === (shown.model ?? ''))?.efforts;
        const models = engine?.models ?? [];
        return <div className="st-presets-row" role="row" key={id} data-testid={`st-preset-${profile.id}-${id}`}>
          <span role="rowheader" className="st-presets-name">{t(LABEL[id])}</span>
          <span role="cell"><Select value={model} disabled={busy || fixed} aria-label={`${profile.name} · ${t(LABEL[id])} · ${t('studio.model')}`} data-testid={`st-preset-model-${profile.id}-${id}`}
            onChange={e => void save(id, e.target.value, e.target.value ? set.effort ?? '' : '')}>
            <option value="">{id === 'base' ? t('studio.defaultModel') : t('delegation.preset.asBase')}</option>
            {model && !models.some(m => m.id === model) && <option value={model}>{model}</option>}
            {models.map(m => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
          </Select></span>
          <span role="cell"><Select value={set.effort ?? ''} disabled={busy || fixed || !engine?.effort || (id !== 'base' && !model)} aria-label={`${profile.name} · ${t(LABEL[id])} · ${t('studio.effort')}`} data-testid={`st-preset-effort-${profile.id}-${id}`}
            onChange={e => void save(id, model, e.target.value)}>
            <option value="">{id !== 'base' && !model && shown.effort ? effortLabel(shown.effort) ?? shown.effort : t('studio.defaultModel')}</option>
            {EFFORTS.filter(x => !efforts || efforts.includes(x)).map(x => <option key={x} value={x}>{effortLabel(x) ?? x}</option>)}
          </Select></span>
        </div>;
      })}
    </div>
    {error && <p className="st-presets-error" role="alert" data-testid={`st-presets-error-${profile.id}`}>{error}</p>}
  </section>;
}
