// The model a column runs on, always in sight (ADR 0107; owner, 2026-10-21: «sia nel lampo che nell'orchestrator vorrei si
// capisse chiaramente il modello che stanno usando come per le strisce. E poter scegliere un modello diverso per
// orchestrator e uno diverso per lampo»): the engine's mark, the model and effort, like a strip's facts line. A click opens
// the shared picker (ModelPicker.tsx, owner 2026-10-31: one selector everywhere) on this chat with the agent's card:
// «Solo questa chat» and the card's default are two separate actions, nothing is saved by a mere pick. Used by
// OrchestratorTile and LampoTile.
import { useRef, useState } from 'react';
import type { ChatSummary } from '@shared/contract';
import { modelWithEffort } from '../lib/format';
import { engineName } from '../lib/engines';
import { useAgents } from '../store/agents';
import { HarnessMark } from './Icons';
import { ModelPicker } from './ModelPicker';
import { t } from '../i18n';
import '../styles/model-chip.css';

export function ModelChip({ chat, profileId, testid }: { chat: ChatSummary; profileId: string; testid: string }) {
  const { catalog } = useAgents();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const profile = catalog?.profiles.find(p => p.id === profileId) ?? null;
  const label = modelWithEffort(chat);
  return <span className="model-chip-wrap">
    <button ref={anchor} type="button" className="model-chip" aria-haspopup="dialog" aria-expanded={open}
      title={t('modelChip.tip', { engine: engineName(chat.harness), model: label })} onClick={() => setOpen(o => !o)} data-testid={testid}>
      <HarnessMark harness={chat.harness} size={13} /><span className="model-chip-text">{label}</span><span className="model-chip-caret" aria-hidden="true">▾</span>
    </button>
    <ModelPicker scope={{ kind: 'chat', chat, card: profile }} anchor={anchor} open={open} onClose={() => setOpen(false)} testid={testid} />
  </span>;
}
