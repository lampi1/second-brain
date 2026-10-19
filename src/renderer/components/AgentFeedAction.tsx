// Human-click actions for role feed entries (Annulla on an applied change, the way to Da approvare); typed IPC only,
// never agent mail as approval. Used by the feed cards.
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
      await sb.invoke('agents:undo', action.undo);
      await refreshAgents();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  return <><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void click()}>{action.kind === 'agent-proposals' ? 'Esamina proposta' : 'Annulla modifica'}</button>{error && <span role="alert">{error}</span>}</>;
}
