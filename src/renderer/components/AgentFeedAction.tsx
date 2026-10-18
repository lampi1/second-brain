// Human-click actions for agent feed entries; calls typed IPC and never treats agent mail as approval.
import { useState } from 'react';
import type { FeedAction } from '@shared/contract';
import { sb } from '../sb';
import { go } from '../actions';
import { refreshAgents } from '../store/agents';

export function AgentFeedAction({ action }: { action?: FeedAction }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!action) return null;
  const click = async () => {
    if (busy) return;
    if (action.kind === 'agent-proposals') { go({ page: 'agenti', arg: 'studio' }); return; }
    setBusy(true); setError('');
    try {
      if (action.kind === 'agent-restore') await sb.invoke('agents:restore', { id: action.agentId });
      else await sb.invoke('agents:undo', action.undo);
      await refreshAgents();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  return <><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void click()}>{action.kind === 'agent-proposals' ? 'Esamina proposta' : action.kind === 'agent-restore' ? 'Ripristina' : 'Annulla modifica'}</button>{error && <span role="alert">{error}</span>}</>;
}
