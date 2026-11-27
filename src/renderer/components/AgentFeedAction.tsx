// Human-click actions for role feed entries (Annulla on an applied change, the way to Memoria → Proposte, Annulla on a
// maintenance pass the app ran by itself: brainmodel:rollback of each of its changes, newest first, ADR 0102; Annulla on
// a connector change the Orchestrator made: mcpservers:undo, and «Attiva» of a server it added or re-pointed,
// mcpservers:activate, shown with exactly what it starts, ADR 0207; «Accedi» on a connector marked needs-login,
// mcpservers:login, ADR 0370); typed IPC
// only, never agent mail as approval. Used by the feed cards (NotificationCenter.tsx) and the morning block.
import { useState } from 'react';
import type { FeedAction } from '@shared/contract';
import { sb } from '../sb';
import { go } from '../actions';
import { refreshAgents, saveAgent } from '../store/agents';
import { agentDraftOf } from '../lib/agent-drafts';
import { t } from '../i18n';

/** Undoes a maintenance pass: newest change first; stops at the first one that cannot be undone any more. */
export async function undoChanges(ids: readonly string[]): Promise<void> {
  for (const id of ids) await sb.invoke('brainmodel:rollback', { id });
}

/** «Attiva» on the news card of a server the Orchestrator added or re-pointed: the user's click, naming what it runs. */
function FeedActivate({ server, runs }: { server: string; runs: string }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false);
  const click = async () => {
    setBusy(true); setError('');
    try { await sb.invoke('mcpservers:activate', { id: server, runs }); setDone(true); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  return <><button type="button" className="btn btn-primary" disabled={busy || done} onClick={() => void click()} data-testid="feed-action-connector-activate">{t(done ? 'mcpadd.activated' : 'mcpadd.activate')}</button>{error && <span role="alert">{error}</span>}</>;
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
      else if (action.kind === 'connector-login') { await sb.invoke('mcpservers:login', { id: action.server }); setDone(true); return; }
      else if (action.kind === 'levels-undo') {
        // the role's lists back as they were (#468), unless the card changed since: then the user looks at it first
        const p = (await sb.invoke('agents:list', undefined)).profiles.find(x => x.id === action.agentId);
        if (!p) throw new Error(t('appText.feedAction.levelsGone'));
        if (p.updatedAt !== action.expectedRevision) throw new Error(t('appText.feedAction.levelsChanged'));
        await saveAgent({ ...agentDraftOf(p), levels: action.levels }, p.id); setDone(true);
      }
      else await sb.invoke('agents:undo', action.undo);
      await refreshAgents();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  if (action.kind === 'connector-login') return <><button type="button" className="btn btn-primary" disabled={busy || done} onClick={() => void click()} data-testid="feed-action-connector-login">{t(done ? 'hub.loginDone' : busy ? 'hub.logging' : 'hub.login')}</button>{error && <span role="alert">{error}</span>}</>;
  const label = t(action.kind === 'agent-proposals' ? 'appText.feedAction.review' : done ? 'appText.feedAction.undone' : action.kind === 'brain-undo' || action.kind === 'connector-undo' || action.kind === 'levels-undo' ? 'appText.feedAction.undo' : 'appText.feedAction.undoChange');
  if (action.kind === 'connector-undo' && action.activate) {
    const act = action.activate;
    return <><code className="mcp-runs" data-testid="feed-connector-runs">{act.runs}</code>
      <FeedActivate server={act.server} runs={act.runs} />
      <button type="button" className="btn btn-ghost" disabled={busy || done} onClick={() => void click()} data-testid={`feed-action-${action.kind}`}>{label}</button>{error && <span role="alert">{error}</span>}</>;
  }
  return <><button type="button" className="btn btn-ghost" disabled={busy || done} onClick={() => void click()} data-testid={`feed-action-${action.kind}`}>{label}</button>{error && <span role="alert">{error}</span>}</>;
}
