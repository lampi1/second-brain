// Human-click actions for role feed entries (Annulla on an applied change, the way to Memoria → Proposte, Annulla on a
// maintenance pass the app ran by itself: brainmodel:rollback of each of its changes, newest first, ADR 0102; Annulla on
// a connector change the Orchestrator made: mcpservers:undo, ADR 0207); typed IPC
// only, never agent mail as approval. Used by the feed cards (NotificationCenter.tsx) and the morning block.
import { useState } from 'react';
import type { FeedAction } from '@shared/contract';
import { sb } from '../sb';
import { go } from '../actions';
import { refreshAgents } from '../store/agents';
import { t } from '../i18n';

/** Undoes a maintenance pass: newest change first; stops at the first one that cannot be undone any more. */
export async function undoChanges(ids: readonly string[]): Promise<void> {
  for (const id of ids) await sb.invoke('brainmodel:rollback', { id });
}

export function AgentFeedAction({ action }: { action?: FeedAction }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false);
  if (!action) return null;
  const click = async () => {
    if (busy || done) return;
    if (action.kind === 'agent-proposals') { go({ page: 'memoria', arg: 'proposte' }); return; }
    setBusy(true); setError('');
    try {
      if (action.kind === 'brain-undo') { await undoChanges(action.ids); setDone(true); }
      else if (action.kind === 'connector-undo') { await sb.invoke('mcpservers:undo', { undo: action.undo }); setDone(true); }
      else await sb.invoke('agents:undo', action.undo);
      await refreshAgents();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  const label = t(action.kind === 'agent-proposals' ? 'appText.feedAction.review' : done ? 'appText.feedAction.undone' : action.kind === 'brain-undo' || action.kind === 'connector-undo' ? 'appText.feedAction.undo' : 'appText.feedAction.undoChange');
  return <><button type="button" className="btn btn-ghost" disabled={busy || done} onClick={() => void click()} data-testid={`feed-action-${action.kind}`}>{label}</button>{error && <span role="alert">{error}</span>}</>;
}
