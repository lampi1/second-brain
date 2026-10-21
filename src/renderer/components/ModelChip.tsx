// The model a column runs on, always in sight (ADR 0107; owner, 2026-10-21: «sia nel lampo che nell'orchestrator vorrei si
// capisse chiaramente il modello che stanno usando come per le strisce. E poter scegliere un modello diverso per
// orchestrator e uno diverso per lampo»): the engine's mark, the model and effort, like a strip's facts line. A click lists
// the models of that engine (the catalog's, the ones a card may hold): the choice goes to the agent's card (Orchestrator
// or Flash), so it stays after a restart, and to the open chat at once. Used by OrchestratorTile and LampoTile.
import { useRef, useState } from 'react';
import type { ChatSummary } from '@shared/contract';
import { modelWithEffort } from '../lib/format';
import { agentDraftOf } from '../lib/agent-drafts';
import { engineName } from '../lib/engines';
import { saveAgent, useAgents } from '../store/agents';
import { setChat } from '../store/store';
import { HarnessMark } from './Icons';
import { MenuItem, MenuLabel, Popover } from './ui';
import { t } from '../i18n';
import '../styles/model-chip.css';

export function ModelChip({ chat, profileId, testid }: { chat: ChatSummary; profileId: string; testid: string }) {
  const { catalog } = useAgents();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profile = catalog?.profiles.find(p => p.id === profileId) ?? null;
  const choice = catalog?.models.find(m => m.engine === chat.harness) ?? null;
  const can = !!profile && !!choice?.modelSelectable && choice.models.length > 0;
  // the card's model when the card is on this engine; the tier's model (null) otherwise
  const cardModel = profile && profile.engine === chat.harness ? profile.model : null;
  const pick = (model: string | null) => async () => {
    setOpen(false); setError(null);
    if (!profile) return;
    try {
      await saveAgent({ ...agentDraftOf(profile), engine: chat.harness, model }, profile.id);
      // the open chat changes now; the card's tier model (null) reaches Flash with its next question
      if (model) await setChat(chat.id, { model });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const label = modelWithEffort(chat);
  return <span className="model-chip-wrap">
    <button ref={anchor} type="button" className="model-chip" disabled={!can} aria-haspopup="menu" aria-expanded={open}
      title={t('modelChip.tip', { engine: engineName(chat.harness), model: label })} onClick={() => setOpen(o => !o)} data-testid={testid}>
      <HarnessMark harness={chat.harness} size={13} /><span className="model-chip-text">{label}</span>{can && <span className="model-chip-caret" aria-hidden="true">▾</span>}
    </button>
    {error && <span className="model-chip-error" role="alert">{error}</span>}
    <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} testid={`${testid}-pop`} width={260}>
      <MenuLabel>{t('modelChip.label', { name: profile?.name ?? '' })}</MenuLabel>
      <MenuItem checked={cardModel === null} onSelect={() => void pick(null)()} testid={`${testid}-tier`}>{t('modelChip.tier')}</MenuItem>
      {(choice?.models ?? []).map(m => <MenuItem key={m.id} checked={cardModel === m.id} onSelect={() => void pick(m.id)()} testid={`${testid}-${m.id}`}>{m.name}</MenuItem>)}
    </Popover>
  </span>;
}
